import {
  DefaultResourceLoader,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";
import { readFileSync, existsSync, mkdtempSync, rmSync } from "fs";
import { randomBytes } from "crypto";
import { resolve, join } from "path";
import { tmpdir } from "os";
import type { AgentConfig } from "../shared/config.js";
import type { Logger } from "../shared/logger.js";
import { loadCredentialField, parseCredentialRef, resolveAgentCredentials } from "../shared/credentials.js";
import { agentDir } from "../shared/paths.js";
import type { StatusTracker } from "../tui/status-tracker.js";
import { getExitCodeMessage } from "../shared/exit-codes.js";
import { AgentError, isUnrecoverableError, UNRECOVERABLE_THRESHOLD } from "../shared/errors.js";
import { installSignalCommands, readSignals } from "./signals.js";
import { runHooks } from "../hooks/runner.js";
import { withSpan, getTelemetry } from "../telemetry/index.js";
import { SpanKind } from "@opentelemetry/api";
import type { TokenUsage } from "../shared/usage.js";
import { sessionStatsToUsage } from "../shared/usage.js";
import { circuitBreaker, selectAvailableModels, isRateLimitError } from "./model-fallback.js";
import { createSessionForModel } from "./session-factory.js";

export type RunResult = "completed" | "rerun" | "error";

export interface TriggerRequest {
  agent: string;
  context: string;
}

export interface RunOutcome {
  result: RunResult;
  triggers: TriggerRequest[];
  returnValue?: string;
  exitCode?: number;
  exitReason?: string;
  usage?: TokenUsage;
  preHookMs?: number;
  postHookMs?: number;
}


export class AgentRunner {
  private running = false;
  private agentConfig: AgentConfig;
  private baseLogger: Logger;
  private logger: Logger;
  private projectPath: string;
  private statusTracker?: StatusTracker;
  public instanceId: string;
  private abortController: AbortController;

  constructor(agentConfig: AgentConfig, logger: Logger, projectPath: string, statusTracker?: StatusTracker) {
    this.agentConfig = agentConfig;
    this.baseLogger = logger;
    this.logger = logger;
    this.projectPath = projectPath;
    this.statusTracker = statusTracker;
    this.instanceId = agentConfig.name;
    this.abortController = new AbortController();
  }

  get isRunning(): boolean {
    return this.running;
  }

  abort(): void {
    this.logger.info("Agent runner abort requested");
    this.abortController.abort();
  }

  async run(prompt: string, triggerInfo?: { type: 'schedule' | 'webhook' | 'agent'; source?: string }): Promise<RunOutcome> {
    if (this.running) {
      this.logger.warn(`${this.agentConfig.name} is already running, skipping`);
      return { result: "error", triggers: [] };
    }

    this.running = true;

    // Generate a unique instance ID for this run
    const runId = randomBytes(4).toString("hex");
    this.instanceId = `${this.agentConfig.name}-${runId}`;
    this.logger = this.baseLogger.child({ instance: this.instanceId });

    const runReason = triggerInfo
      ? (triggerInfo.source
        ? (triggerInfo.type === 'agent' ? `triggered by ${triggerInfo.source}` : `${triggerInfo.type} (${triggerInfo.source})`)
        : triggerInfo.type)
      : undefined;
    this.statusTracker?.startRun(this.agentConfig.name, runReason);
    this.statusTracker?.registerInstance({
      id: this.instanceId,
      agentName: this.agentConfig.name,
      status: "running",
      startedAt: new Date(),
      trigger: triggerInfo?.source ? `${triggerInfo.type}:${triggerInfo.source}` : (triggerInfo?.type ?? "manual"),
    });

    return await withSpan(
      "agent.run",
      async (span) => {
        span.setAttributes({
          "agent.name": this.agentConfig.name,
          "agent.run_id": this.instanceId,
          "agent.trigger_type": triggerInfo?.type || "manual",
          "agent.trigger_source": triggerInfo?.source || "",
          "agent.model_provider": this.agentConfig.models[0]?.provider,
          "agent.model_name": this.agentConfig.models[0]?.model,
          "execution.environment": "host",
        });

        return this._runInternal(prompt, triggerInfo, span);
      },
      {},
      SpanKind.INTERNAL
    );
  }

  private async _runInternal(prompt: string, triggerInfo?: { type: 'schedule' | 'webhook' | 'agent'; source?: string }, parentSpan?: any): Promise<RunOutcome> {

    if (triggerInfo) {
      const triggerDetails = triggerInfo.type === 'agent' && triggerInfo.source 
        ? `${triggerInfo.type} (${triggerInfo.source})` 
        : triggerInfo.type;
      this.logger.info(`Starting ${this.agentConfig.name} run (triggered by ${triggerDetails})`);
      this.statusTracker?.addLogLine(this.agentConfig.name, `${this.instanceId} started (${triggerDetails})`);
    } else {
      this.logger.info(`Starting ${this.agentConfig.name} run`);
      this.statusTracker?.addLogLine(this.agentConfig.name, `${this.instanceId} started (manual)`);
    }
    const runStartTime = Date.now();
    let runError: string | undefined;
    let usage: TokenUsage | undefined;
    let preHookMs: number | undefined;
    let postHookMs: number | undefined;

    // Declared outside try so the finally block can restore them.
    const GIT_ENV_KEYS = [
      "GIT_AUTHOR_NAME",
      "GIT_COMMITTER_NAME",
      "GIT_AUTHOR_EMAIL",
      "GIT_COMMITTER_EMAIL",
    ] as const;
    const savedGitEnv: Record<string, string | undefined> = {};
    for (const key of GIT_ENV_KEYS) {
      savedGitEnv[key] = process.env[key];
    }

    // Set up file-based signal IPC
    const signalTmpDir = mkdtempSync(join(tmpdir(), "al-signals-"));
    const signalDir = join(signalTmpDir, "signals");
    const signalBinDir = join(signalTmpDir, "bin");
    installSignalCommands(signalBinDir, signalDir);
    const savedPath = process.env.PATH;
    process.env.PATH = `${signalBinDir}:${process.env.PATH || ""}`;
    process.env.AL_SIGNAL_DIR = signalDir;

    try {
      const cwd = agentDir(this.projectPath, this.agentConfig.name);
      const agentsFile = resolve(cwd, "SKILL.md");

      // Set git author identity from git_ssh credential (scoped to this run)
      const resolvedCreds = resolveAgentCredentials(this.agentConfig.credentials);
      const gitSshCred = resolvedCreds.find((c) => c.type === "git_ssh");
      if (gitSshCred) {
        const gitName = await loadCredentialField("git_ssh", gitSshCred.instance, "username");
        if (gitName) {
          process.env.GIT_AUTHOR_NAME = gitName;
          process.env.GIT_COMMITTER_NAME = gitName;
        }
        const gitEmail = await loadCredentialField("git_ssh", gitSshCred.instance, "email");
        if (gitEmail) {
          process.env.GIT_AUTHOR_EMAIL = gitEmail;
          process.env.GIT_COMMITTER_EMAIL = gitEmail;
        }
      }

      // Run pre hooks (data staging before LLM session)
      if (this.agentConfig.hooks?.pre && this.agentConfig.hooks.pre.length > 0) {
        const hookCtx = {
          env: { ...process.env } as Record<string, string>,
          logger: (level: string, msg: string, data?: Record<string, any>) => {
            if (level === "error") this.logger.error(data ?? {}, msg);
            else if (level === "warn") this.logger.warn(data ?? {}, msg);
            else this.logger.info(data ?? {}, msg);
          },
        };
        const preResult = await runHooks(this.agentConfig.hooks.pre, "pre", hookCtx);
        preHookMs = preResult.durationMs;
      }

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

      // Model fallback loop: try each available model, backoff only when all exhausted
      const MAX_PASSES = 3;
      const DEFAULT_BACKOFF_MS = 30_000;
      const MAX_BACKOFF_MS = 300_000;
      const pendingCmds = new Map<string, string>();
      let outputText = "";
      let currentTurnText = "";
      let unrecoverableErrors = 0;

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
            this.logger.debug({ sessionStats, provider: modelConfig.provider }, "raw session stats");
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

        // All models exhausted — backoff before next pass
        if (pass < MAX_PASSES) {
          const delayMs = Math.min(DEFAULT_BACKOFF_MS * Math.pow(2, pass), MAX_BACKOFF_MS);
          this.logger.warn({ pass: pass + 1, delayMs }, "all models exhausted, backing off");
          this.statusTracker?.addLogLine(this.agentConfig.name, `All models exhausted, retrying in ${Math.round(delayMs / 1000)}s...`);
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }

      // Run post hooks (cleanup, notifications after LLM session)
      if (this.agentConfig.hooks?.post && this.agentConfig.hooks.post.length > 0) {
        const hookCtx = {
          env: { ...process.env } as Record<string, string>,
          logger: (level: string, msg: string, data?: Record<string, any>) => {
            if (level === "error") this.logger.error(data ?? {}, msg);
            else if (level === "warn") this.logger.warn(data ?? {}, msg);
            else this.logger.info(data ?? {}, msg);
          },
        };
        const postResult = await runHooks(this.agentConfig.hooks.post, "post", hookCtx);
        postHookMs = postResult.durationMs;
      }

      // Read signal files written by al-rerun, al-status, al-return, al-exit
      const signals = readSignals(signalDir);

      let result: RunResult;
      if (signals.exitCode !== undefined) {
        const reason = getExitCodeMessage(signals.exitCode);
        this.logger.error({ exitCode: signals.exitCode, reason }, "agent terminated with exit signal");
        this.statusTracker?.setAgentError(this.agentConfig.name, `Exit ${signals.exitCode}: ${reason}`);
        result = "error";
      } else if (signals.rerun) {
        this.logger.info({ outputLength: outputText.length }, "run completed, rerun requested");
        result = "rerun";
      } else {
        this.logger.info({ outputLength: outputText.length }, "run completed");
        result = "completed";
      }

      const elapsed = ((Date.now() - runStartTime) / 1000).toFixed(1);
      this.statusTracker?.addLogLine(this.agentConfig.name, `${this.instanceId} ${elapsed}s`);

      // Add telemetry attributes for the execution result
      if (parentSpan) {
        parentSpan.setAttributes({
          "execution.result": result,
          "execution.output_length": outputText.length,
          "execution.exit_code": signals.exitCode,
          "execution.has_return_value": !!signals.returnValue,
          "execution.unrecoverable_errors": unrecoverableErrors,
          // OTel span attributes for token usage (following OpenTelemetry GenAI semantic conventions)
          "llm.token.input": usage?.inputTokens ?? 0,
          "llm.token.output": usage?.outputTokens ?? 0,
          "llm.token.cache_read": usage?.cacheReadTokens ?? 0,
          "llm.token.cache_write": usage?.cacheWriteTokens ?? 0,
          "llm.token.total": usage?.totalTokens ?? 0,
          "llm.cost.total": usage?.cost ?? 0,
          "llm.turns": usage?.turnCount ?? 0,
        });

        if (result === "error") {
          parentSpan.recordException(new Error(`Agent execution failed: ${runError || "Unknown error"}`));
        }
      }

      return {
        result,
        triggers: [],
        returnValue: signals.returnValue,
        usage,
        preHookMs,
        postHookMs,
        ...(signals.exitCode !== undefined && {
          exitCode: signals.exitCode,
          exitReason: getExitCodeMessage(signals.exitCode)
        })
      };
    } catch (err: any) {
      this.logger.error({ err }, `${this.agentConfig.name} run failed`);
      runError = String(err?.message || err).slice(0, 200);

      return { result: "error", triggers: [], usage: undefined };
    } finally {
      // Restore the git env vars we may have overwritten so other
      // agents running in the same process get a clean slate.
      for (const key of GIT_ENV_KEYS) {
        if (savedGitEnv[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = savedGitEnv[key];
        }
      }

      // Restore PATH and clean up signal dir
      if (savedPath !== undefined) {
        process.env.PATH = savedPath;
      }
      delete process.env.AL_SIGNAL_DIR;
      try { rmSync(signalTmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }

      const elapsed = Date.now() - runStartTime;
      const instanceStatus = runError ? "error" as const : "completed" as const;
      this.statusTracker?.completeInstance(this.instanceId, instanceStatus);
      this.statusTracker?.endRun(this.agentConfig.name, elapsed, runError, usage);
      this.running = false;
    }
  }
}
