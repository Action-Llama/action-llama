import { existsSync, readFileSync, statSync } from "fs";
import { resolve } from "path";
import { EventEmitter } from "events";
import type { GlobalConfig, AgentConfig } from "../shared/config.js";
import type { Logger } from "../shared/logger.js";
import type { StatusTracker } from "../tui/status-tracker.js";
import { logsDir } from "../shared/paths.js";

export interface FeedbackTriggerEvent {
  agentName: string;
  error: string;
  context: string[];
  timestamp: Date;
}

export class FeedbackMonitor extends EventEmitter {
  private globalConfig: GlobalConfig;
  private logger: Logger;
  private statusTracker?: StatusTracker;
  private watchedAgents = new Map<string, { lastPosition: number; lastSize: number }>();
  private intervalId?: NodeJS.Timeout;
  private readonly pollInterval = 5000; // 5 seconds

  constructor(globalConfig: GlobalConfig, logger: Logger, statusTracker?: StatusTracker) {
    super();
    this.globalConfig = globalConfig;
    this.logger = logger;
    this.statusTracker = statusTracker;
  }

  /**
   * Start monitoring all agents' log files for errors
   */
  start(projectPath: string): void {
    if (this.intervalId) {
      this.logger.warn("FeedbackMonitor is already running");
      return;
    }

    this.logger.info("Starting feedback monitor");
    this.intervalId = setInterval(() => {
      this.pollLogFiles(projectPath);
    }, this.pollInterval);
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
      this.logger.info("Stopped feedback monitor");
    }
  }

  /**
   * Watch a specific agent's logs for errors
   */
  watchAgent(agentName: string): void {
    if (!this.watchedAgents.has(agentName)) {
      this.watchedAgents.set(agentName, { lastPosition: 0, lastSize: 0 });
      this.logger.debug(`Now watching agent: ${agentName}`);
    }
  }

  /**
   * Stop watching a specific agent
   */
  unwatchAgent(agentName: string): void {
    if (this.watchedAgents.delete(agentName)) {
      this.logger.debug(`Stopped watching agent: ${agentName}`);
    }
  }

  /**
   * Check if feedback is enabled for the given agent
   */
  private isFeedbackEnabled(agentConfig: AgentConfig): boolean {
    // Check global feedback setting
    if (!this.globalConfig.feedback?.enabled) {
      return false;
    }

    // Check per-agent override
    if (agentConfig.feedback?.enabled !== undefined) {
      return agentConfig.feedback.enabled;
    }

    // Default to enabled if global feedback is enabled and no agent override
    return true;
  }

  /**
   * Get the error patterns to search for
   */
  private getErrorPatterns(): string[] {
    return this.globalConfig.feedback?.errorPatterns || ["error", "fail"];
  }

  /**
   * Get the number of context lines to include
   */
  private getContextLines(): number {
    return this.globalConfig.feedback?.contextLines || 2;
  }

  /**
   * Poll log files for new content and check for errors
   */
  private pollLogFiles(projectPath: string): void {
    const today = new Date().toISOString().slice(0, 10);
    const logsDirPath = logsDir(projectPath);

    for (const [agentName, watchState] of this.watchedAgents) {
      const logFile = resolve(logsDirPath, `${agentName}-${today}.log`);
      
      if (!existsSync(logFile)) {
        continue;
      }

      try {
        const stats = statSync(logFile);
        const currentSize = stats.size;
        
        // Only process if file has grown
        if (currentSize <= watchState.lastSize) {
          continue;
        }

        // Read new content
        const content = readFileSync(logFile, "utf-8");
        const lines = content.split("\n");
        
        // Find starting line based on last position
        let startLine = 0;
        if (watchState.lastPosition > 0) {
          // Find the line that contains data after our last position
          let bytesRead = 0;
          for (let i = 0; i < lines.length; i++) {
            bytesRead += Buffer.byteLength(lines[i] + "\n", "utf-8");
            if (bytesRead > watchState.lastPosition) {
              startLine = i;
              break;
            }
          }
        }

        // Process new lines for errors
        this.processLogLines(agentName, lines, startLine, projectPath);

        // Update tracking state
        watchState.lastPosition = currentSize;
        watchState.lastSize = currentSize;
        
      } catch (err) {
        this.logger.error({ err, agentName, logFile }, "Error reading log file for feedback monitoring");
      }
    }
  }

  /**
   * Process log lines looking for error patterns
   */
  private processLogLines(agentName: string, lines: string[], startLine: number, projectPath: string): void {
    const errorPatterns = this.getErrorPatterns();
    const contextLines = this.getContextLines();

    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];
      
      if (!line.trim()) continue;

      // Check if line matches any error pattern
      const matchesError = errorPatterns.some(pattern => {
        try {
          const regex = new RegExp(pattern, "i");
          return regex.test(line);
        } catch (err) {
          this.logger.warn({ pattern, err }, "Invalid error pattern regex");
          return line.toLowerCase().includes(pattern.toLowerCase());
        }
      });

      if (matchesError) {
        // Extract context lines around the error
        const startContext = Math.max(0, i - contextLines);
        const endContext = Math.min(lines.length - 1, i + contextLines);
        const context = lines.slice(startContext, endContext + 1);

        // Check if feedback is enabled for this agent
        try {
          // This is a simplified check - in a real implementation we'd need
          // to load the agent config to check per-agent settings
          this.logger.info({ agentName, error: line.substring(0, 200) }, "Error detected, triggering feedback");
          
          const event: FeedbackTriggerEvent = {
            agentName,
            error: line,
            context,
            timestamp: new Date(),
          };

          this.emit("feedback-trigger", event);
          
        } catch (err) {
          this.logger.error({ err, agentName }, "Error checking feedback configuration");
        }
      }
    }
  }
}