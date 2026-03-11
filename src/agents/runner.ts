import type { AgentConfig } from "../shared/config.js";
import type { Logger } from "../shared/logger.js";
import { agentDir } from "../shared/paths.js";
import type { StatusTracker } from "../tui/status-tracker.js";
import { ExecutionEngine, type RunResult } from "./execution-engine.js";
import { GitEnvironment } from "./git-environment.js";
import { AgentStatusReporter } from "./status-reporter.js";
import { parseTriggers, type TriggerRequest } from "./trigger-parser.js";

export type { RunResult, TriggerRequest };

export interface RunOutcome {
  result: RunResult;
  triggers: TriggerRequest[];
}

export class AgentRunner {
  private running = false;
  private agentConfig: AgentConfig;
  private logger: Logger;
  private projectPath: string;
  private executionEngine: ExecutionEngine;
  private gitEnvironment: GitEnvironment;
  private statusReporter: AgentStatusReporter;

  constructor(agentConfig: AgentConfig, logger: Logger, projectPath: string, statusTracker?: StatusTracker) {
    this.agentConfig = agentConfig;
    this.logger = logger;
    this.projectPath = projectPath;
    this.executionEngine = new ExecutionEngine(agentConfig, logger, statusTracker);
    this.gitEnvironment = new GitEnvironment(logger);
    this.statusReporter = new AgentStatusReporter(statusTracker);
  }

  get isRunning(): boolean {
    return this.running;
  }

  async run(prompt: string, triggerInfo?: { type: 'schedule' | 'webhook' | 'agent'; source?: string }): Promise<RunOutcome> {
    if (this.running) {
      this.logger.warn(`${this.agentConfig.name} is already running, skipping`);
      return { result: "error", triggers: [] };
    }

    this.running = true;
    const runReason = triggerInfo
      ? (triggerInfo.source
        ? (triggerInfo.type === 'agent' ? `triggered by ${triggerInfo.source}` : `${triggerInfo.type} (${triggerInfo.source})`)
        : triggerInfo.type)
      : undefined;
    this.statusReporter.startRun(this.agentConfig.name, runReason);

    if (triggerInfo) {
      const triggerDetails = triggerInfo.type === 'agent' && triggerInfo.source 
        ? `${triggerInfo.type} (${triggerInfo.source})` 
        : triggerInfo.type;
      this.logger.info(`Starting ${this.agentConfig.name} run (triggered by ${triggerDetails})`);
    } else {
      this.logger.info(`Starting ${this.agentConfig.name} run`);
    }
    const runStartTime = Date.now();
    let runError: string | undefined;

    // Setup git environment and save previous state
    const savedGitEnv = await this.gitEnvironment.setup(this.agentConfig.credentials);

    try {
      const cwd = agentDir(this.projectPath, this.agentConfig.name);
      
      // Execute the agent using the execution engine
      const { result, outputText } = await this.executionEngine.execute(prompt, cwd);
      
      // Parse triggers from output
      const triggers = parseTriggers(outputText);
      
      return { result, triggers };
    } catch (err: any) {
      this.logger.error({ err }, `${this.agentConfig.name} run failed`);
      runError = String(err?.message || err).slice(0, 200);
      return { result: "error", triggers: [] };
    } finally {
      // Restore git environment
      this.gitEnvironment.restore(savedGitEnv);

      const elapsed = Date.now() - runStartTime;
      this.statusReporter.endRun(this.agentConfig.name, elapsed, runError);
      this.running = false;
    }
  }
}
