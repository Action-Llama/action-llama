import {
  DefaultResourceLoader,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";
import { readFileSync, existsSync, mkdtempSync, rmSync } from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";
import type { AgentConfig } from "../shared/config.js";
import type { Logger } from "../shared/logger.js";
import { loadCredentialField } from "../shared/credentials.js";
import type { StatusTracker } from "../tui/status-tracker.js";
import { AgentError, isUnrecoverableError, UNRECOVERABLE_THRESHOLD } from "../shared/errors.js";
import { installSignalCommands, readSignals } from "./signals.js";
import type { TokenUsage } from "../shared/usage.js";
import { sessionStatsToUsage } from "../shared/usage.js";
import { circuitBreaker, selectAvailableModels, isRateLimitError } from "./model-fallback.js";
import { createSessionForModel } from "./session-factory.js";

export type RunResult = "completed" | "rerun" | "error";

export interface ExecutionResult {
  result: RunResult;
  outputText: string;
  unrecoverableErrors: number;
  usage?: TokenUsage;  // NEW
}

export class ExecutionEngine {
  private agentConfig: AgentConfig;
  private logger: Logger;
  private statusTracker?: StatusTracker;

  constructor(agentConfig: AgentConfig, logger: Logger, statusTracker?: StatusTracker) {
    this.agentConfig = agentConfig;
    this.logger = logger;
    this.statusTracker = statusTracker;
  }

  async execute(prompt: string, cwd: string): Promise<ExecutionResult> {
    // Set up file-based signal IPC
    const signalTmpDir = mkdtempSync(join(tmpdir(), "al-signals-"));
    const signalDir = join(signalTmpDir, "signals");
    const signalBinDir = join(signalTmpDir, "bin");
    installSignalCommands(signalBinDir, signalDir);
    const savedPath = process.env.PATH;
    process.env.PATH = `${signalBinDir}:${process.env.PATH || ""}`;
    process.env.AL_SIGNAL_DIR = signalDir;

    const agentsFile = resolve(cwd, "SKILL.md");

    // SKILL.md must exist on disk (written during al new)
    if (!existsSync(agentsFile)) {
      throw new AgentError(
        `SKILL.md not found at ${agentsFile}. Run 'al new' to create it.`
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

    // Model fallback loop
    const MAX_PASSES = 3;
    const DEFAULT_BACKOFF_MS = 30_000;
    const MAX_BACKOFF_MS = 300_000;
    const pendingCmds = new Map<string, string>();
    let outputText = "";
    let currentTurnText = "";
    let unrecoverableErrors = 0;
    let usage: TokenUsage | undefined;

    for (let pass = 0; pass <= MAX_PASSES; pass++) {
      const availableModels = selectAvailableModels(this.agentConfig.models, circuitBreaker);
      let modelSucceeded = false;

      for (const modelConfig of availableModels) {
        this.logger.info({ provider: modelConfig.provider, model: modelConfig.model }, "trying model");
        const { session } = await createSessionForModel(modelConfig, {
          cwd,
          resourceLoader,
          settingsManager,
          loadCredential: loadCredentialField,
        });

        // Subscribe to events for logging
        session.subscribe((event) => {
          if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
            const delta = event.assistantMessageEvent.delta;
            outputText += delta;
            currentTurnText += delta;
          }
          if (event.type === "message_end") {
            if (currentTurnText.trim()) {
              this.logger.info({ text: currentTurnText.trim() }, "assistant");
            }
            currentTurnText = "";
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
            const originCmd = pendingCmds.get(event.toolCallId);
            pendingCmds.delete(event.toolCallId);

            if (event.isError) {
              this.logger.error(
                { tool: event.toolName, result: resultStr.slice(0, 1000) },
                "tool error"
              );
              let errorMsg = resultStr;
              try {
                const parsed = JSON.parse(resultStr);
                if (parsed?.content?.[0]?.text) {
                  errorMsg = parsed.content[0].text;
                }
              } catch { /* use raw string */ }
              const cmdPrefix = originCmd ? `$ ${originCmd.slice(0, 80)} — ` : "";
              const detail = `${cmdPrefix}${errorMsg.slice(0, 200)}`;
              this.statusTracker?.setAgentError(this.agentConfig.name, detail);
              this.statusTracker?.addLogLine(this.agentConfig.name, `ERROR: ${detail}`);
              if (isUnrecoverableError(errorMsg)) {
                unrecoverableErrors++;
                if (unrecoverableErrors >= UNRECOVERABLE_THRESHOLD) {
                  this.logger.error("Aborting: repeated auth/permission failures — check credentials");
                  this.statusTracker?.addLogLine(this.agentConfig.name, "ABORT: repeated auth/permission failures — check credentials");
                  session.dispose();
                }
              }
            } else {
              this.logger.debug({ tool: event.toolName, resultLength: resultStr.length }, "tool done");
            }
          }
        });

        try {
          await session.prompt(prompt);
          circuitBreaker.recordSuccess(modelConfig.provider, modelConfig.model);
          const sessionStats = session.getSessionStats();
          usage = sessionStatsToUsage(sessionStats);
          session.dispose();
          modelSucceeded = true;
          break;
        } catch (promptErr: any) {
          const msg = String(promptErr?.message || promptErr || "");
          if (isRateLimitError(msg)) {
            circuitBreaker.recordFailure(modelConfig.provider, modelConfig.model);
            this.logger.warn(
              { provider: modelConfig.provider, model: modelConfig.model },
              "rate limited, trying next model"
            );
            this.statusTracker?.addLogLine(this.agentConfig.name, `Rate limited on ${modelConfig.model}, trying fallback...`);
            session.dispose();
            continue;
          }
          session.dispose();
          throw promptErr;
        }
      }

      if (modelSucceeded) break;

      if (pass < MAX_PASSES) {
        const delayMs = Math.min(DEFAULT_BACKOFF_MS * Math.pow(2, pass), MAX_BACKOFF_MS);
        this.logger.warn({ pass: pass + 1, delayMs }, "all models exhausted, backing off");
        this.statusTracker?.addLogLine(this.agentConfig.name, `All models exhausted, retrying in ${Math.round(delayMs / 1000)}s...`);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    // Read signal files
    const signals = readSignals(signalDir);

    // Clean up signal dir and restore PATH
    if (savedPath !== undefined) {
      process.env.PATH = savedPath;
    }
    delete process.env.AL_SIGNAL_DIR;
    try { rmSync(signalTmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }

    let result: RunResult;
    if (signals.rerun) {
      this.logger.info({ outputLength: outputText.length }, "run completed, rerun requested");
      result = "rerun";
    } else {
      this.logger.info({ outputLength: outputText.length }, "run completed");
      result = "completed";
    }

    return { result, outputText, unrecoverableErrors, usage };
  }
}