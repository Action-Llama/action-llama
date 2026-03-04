import { getModel } from "@mariozechner/pi-ai";
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  createCodingTools,
} from "@mariozechner/pi-coding-agent";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import type { AgentConfig } from "../shared/config.js";
import type { Logger } from "../shared/logger.js";
import { loadCredential } from "../shared/credentials.js";
import { agentDir } from "../shared/paths.js";
import type { StatusTracker } from "../tui/status-tracker.js";

export class AgentRunner {
  private running = false;
  private agentConfig: AgentConfig;
  private logger: Logger;
  private projectPath: string;
  private statusTracker?: StatusTracker;

  constructor(agentConfig: AgentConfig, logger: Logger, projectPath: string, statusTracker?: StatusTracker) {
    this.agentConfig = agentConfig;
    this.logger = logger;
    this.projectPath = projectPath;
    this.statusTracker = statusTracker;
  }

  get isRunning(): boolean {
    return this.running;
  }

  async run(prompt: string): Promise<void> {
    if (this.running) {
      this.logger.warn(`${this.agentConfig.name} is already running, skipping`);
      return;
    }

    this.running = true;
    this.statusTracker?.setAgentState(this.agentConfig.name, "running");
    this.logger.info(`Starting ${this.agentConfig.name} run`);
    const runStartTime = Date.now();

    try {
      const cwd = agentDir(this.projectPath, this.agentConfig.name);
      const agentsFile = resolve(cwd, "AGENTS.md");

      const { model } = this.agentConfig;
      const llmModel = getModel(
        model.provider as "anthropic",
        model.model as any
      );

      const authStorage = AuthStorage.create();
      if (model.authType !== "pi_auth") {
        const credential = loadCredential("anthropic-key");
        if (credential) {
          authStorage.setRuntimeApiKey("anthropic", credential);
        }
      }

      // AGENTS.md must exist on disk (written during al init)
      if (!existsSync(agentsFile)) {
        throw new Error(
          `AGENTS.md not found at ${agentsFile}. Run 'al init' to create it.`
        );
      }
      const agentsContent = readFileSync(agentsFile, "utf-8");

      const resourceLoader = new DefaultResourceLoader({
        noExtensions: true,
        agentsFilesOverride: () => ({
          agentsFiles: [
            { path: agentsFile, content: agentsContent },
          ],
        }),
      });
      await resourceLoader.reload();

      const settingsManager = SettingsManager.inMemory({
        compaction: { enabled: true },
        retry: { enabled: true, maxRetries: 2 },
      });

      const { session } = await createAgentSession({
        cwd,
        model: llmModel,
        thinkingLevel: model.thinkingLevel,
        authStorage,
        resourceLoader,
        tools: createCodingTools(cwd),
        sessionManager: SessionManager.inMemory(),
        settingsManager,
      });

      // Subscribe to events for logging
      // Track bash commands by toolCallId so we can correlate start→end
      const pendingCmds = new Map<string, string>();
      let outputText = "";
      session.subscribe((event) => {
        if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
          outputText += event.assistantMessageEvent.delta;
          // Detect [STATUS: <text>] pattern
          const statusMatch = outputText.match(/\[STATUS:\s*([^\]]+)\]/);
          if (statusMatch) {
            this.statusTracker?.setAgentStatusText(this.agentConfig.name, statusMatch[1].trim());
          }
        }
        if (event.type === "tool_execution_start") {
          const cmd = String(event.args?.command || "");
          if (event.toolName === "bash") {
            pendingCmds.set(event.toolCallId, cmd);
            this.logger.info({ cmd: cmd.slice(0, 200) }, "bash");
          } else {
            this.logger.debug({ tool: event.toolName }, "tool start");
          }
        }
        if (event.type === "tool_execution_end") {
          const resultStr = typeof event.result === "string"
            ? event.result
            : JSON.stringify(event.result);
          pendingCmds.delete(event.toolCallId);

          if (event.isError) {
            this.logger.error(
              { tool: event.toolName, result: resultStr.slice(0, 1000) },
              "tool error"
            );
          } else {
            this.logger.debug({ tool: event.toolName, resultLength: resultStr.length }, "tool done");
          }
        }
      });

      // Prompt is now built by the scheduler (includes <agent-config> and optional <webhook-trigger>)
      // Retry on rate limit errors with exponential backoff
      const MAX_PROMPT_RETRIES = 5;
      const DEFAULT_BACKOFF_MS = 30_000;
      const MAX_BACKOFF_MS = 300_000;

      for (let attempt = 0; attempt <= MAX_PROMPT_RETRIES; attempt++) {
        try {
          await session.prompt(prompt);
          break;
        } catch (promptErr: any) {
          const msg = String(promptErr?.message || promptErr || "");
          const isRateLimit = msg.includes("rate_limit") || msg.includes("429") || msg.includes("529") || msg.includes("overloaded");
          if (!isRateLimit || attempt === MAX_PROMPT_RETRIES) {
            throw promptErr;
          }
          const delayMs = Math.min(DEFAULT_BACKOFF_MS * Math.pow(2, attempt), MAX_BACKOFF_MS);
          this.logger.warn(
            { attempt: attempt + 1, delayMs },
            "rate limited, retrying prompt"
          );
          this.statusTracker?.addLogLine(this.agentConfig.name, `Rate limited, retrying in ${Math.round(delayMs / 1000)}s...`);
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }

      if (outputText.includes("[SILENT]")) {
        this.logger.info("no work to do");
        this.statusTracker?.addLogLine(this.agentConfig.name, "no work to do");
      } else {
        this.logger.info({ outputLength: outputText.length }, "run completed");
      }

      session.dispose();
    } catch (err: any) {
      this.logger.error({ err }, `${this.agentConfig.name} run failed`);
    } finally {
      const elapsed = Date.now() - runStartTime;
      this.statusTracker?.completeRun(this.agentConfig.name, elapsed);
      this.running = false;
    }
  }
}
