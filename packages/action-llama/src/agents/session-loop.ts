/**
 * Shared model-fallback + session-creation + event-subscription loop.
 *
 * Used by container-entry.ts and cli/commands/run-agent.ts to avoid
 * duplicating the ~150-line session loop across both entry points.
 */
import { getModel } from "@mariozechner/pi-ai";
import {
  AuthStorage,
  createAgentSession,
  SessionManager,
  createCodingTools,
} from "@mariozechner/pi-coding-agent";
import type { ModelConfig } from "../shared/config.js";
import type { TokenUsage } from "../shared/usage.js";
import { sessionStatsToUsage } from "../shared/usage.js";
import { ModelCircuitBreaker, selectAvailableModels, isRateLimitError } from "./model-fallback.js";
import { isUnrecoverableError, UNRECOVERABLE_THRESHOLD } from "../shared/errors.js";
import { BASH_COMMAND_PREFIX } from "./bash-prefix.js";

export interface SessionLoopOpts {
  models: ModelConfig[];
  circuitBreaker: ModelCircuitBreaker;
  cwd: string;
  resourceLoader: any;
  settingsManager: any;
  /** Provider API key map (used by container / host-user mode) */
  providerKeys?: Map<string, string>;
  log: (level: string, msg: string, data?: Record<string, any>) => void;
  onUnrecoverableAbort?: () => void;
}

export interface SessionLoopResult {
  outputText: string;
  usage?: TokenUsage;
  unrecoverableErrors: number;
  aborted: boolean;
}

const MAX_PASSES = 3;
const DEFAULT_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 300_000;

export async function runSessionLoop(
  prompt: string,
  opts: SessionLoopOpts,
): Promise<SessionLoopResult> {
  const { models, circuitBreaker, cwd, resourceLoader, settingsManager, providerKeys, log, onUnrecoverableAbort } = opts;

  const pendingCmds = new Map<string, string>();
  let outputText = "";
  let currentTurnText = "";
  let eventCount = 0;
  let unrecoverableErrors = 0;
  let aborted = false;
  let usage: TokenUsage | undefined;

  for (let pass = 0; pass <= MAX_PASSES; pass++) {
    const availableModels = selectAvailableModels(models, circuitBreaker);
    let modelSucceeded = false;

    for (const modelConfig of availableModels) {
      const llmModel = getModel(modelConfig.provider as any, modelConfig.model as any);
      const modelThinking = modelConfig.thinkingLevel;

      log("info", "creating agent session", { model: modelConfig.model, thinking: modelThinking });

      const authStorage = AuthStorage.create();
      const providerKey = providerKeys?.get(modelConfig.provider);
      if (providerKey) {
        authStorage.setRuntimeApiKey(modelConfig.provider, providerKey);
      }

      const { session } = await createAgentSession({
        cwd,
        model: llmModel,
        thinkingLevel: modelThinking,
        authStorage,
        resourceLoader,
        tools: createCodingTools(cwd, {
          bash: { commandPrefix: BASH_COMMAND_PREFIX },
        }),
        sessionManager: SessionManager.inMemory(),
        settingsManager,
      });

      session.subscribe((event) => {
        eventCount++;
        if (event.type !== "message_update") {
          const extra: Record<string, any> = { type: event.type, eventCount };
          if (event.type === "message_start" || event.type === "message_end") {
            extra.role = (event as any).role || (event as any).message?.role;
            extra.content = JSON.stringify((event as any).content || (event as any).message?.content || []).slice(0, 500);
            extra.stopReason = (event as any).stopReason || (event as any).stop_reason;
          }
          if (event.type === "turn_end") {
            extra.turnResult = JSON.stringify(event).slice(0, 500);
          }
          log("debug", "event", extra);
        }
        if ((event as any).type === "error") {
          log("error", "session error", { error: String((event as any).error || (event as any).message || JSON.stringify(event)) });
        }
        if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
          const delta = event.assistantMessageEvent.delta;
          outputText += delta;
          currentTurnText += delta;
        }
        if (event.type === "message_end") {
          if (currentTurnText.trim()) {
            log("info", "assistant", { text: currentTurnText.trim() });
          }
          currentTurnText = "";
        }
        if (event.type === "tool_execution_start") {
          const cmd = String(event.args?.command || "");
          if (event.toolName === "bash") {
            pendingCmds.set(event.toolCallId, cmd);
            log("info", "bash", { cmd: cmd.slice(0, 200) });
          } else {
            log("debug", "tool start", { tool: event.toolName });
          }
        }
        if (event.type === "tool_execution_end") {
          const resultStr = typeof event.result === "string"
            ? event.result
            : JSON.stringify(event.result);
          const originCmd = pendingCmds.get(event.toolCallId);
          pendingCmds.delete(event.toolCallId);

          if (event.isError) {
            log("error", "tool error", { tool: event.toolName, cmd: originCmd?.slice(0, 200), result: resultStr.slice(0, 1000) });
            let errorMsg = resultStr;
            try {
              const parsed = JSON.parse(resultStr);
              if (parsed?.content?.[0]?.text) errorMsg = parsed.content[0].text;
            } catch { /* use raw string */ }
            if (isUnrecoverableError(errorMsg)) {
              unrecoverableErrors++;
              if (unrecoverableErrors >= UNRECOVERABLE_THRESHOLD) {
                log("error", "Aborting: repeated auth/permission failures — check credentials");
                aborted = true;
                if (onUnrecoverableAbort) onUnrecoverableAbort();
                session.dispose();
              }
            }
          } else {
            log("debug", "tool done", { tool: event.toolName, resultLength: resultStr.length });
          }
        }
      });

      try {
        await session.prompt(prompt);
        circuitBreaker.recordSuccess(modelConfig.provider, modelConfig.model);

        log("info", "prompt returned", { eventCount, resultType: typeof undefined });

        const sessionStats = session.getSessionStats();
        usage = sessionStatsToUsage(sessionStats);
        log("info", "token-usage", {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: usage.cacheReadTokens,
          cacheWriteTokens: usage.cacheWriteTokens,
          totalTokens: usage.totalTokens,
          cost: usage.cost,
          turnCount: usage.turnCount,
        });

        session.dispose();
        modelSucceeded = true;
        break;
      } catch (promptErr: any) {
        const msg = String(promptErr?.message || promptErr || "");
        if (isRateLimitError(msg)) {
          circuitBreaker.recordFailure(modelConfig.provider, modelConfig.model);
          log("warn", "rate limited, trying next model", { provider: modelConfig.provider, model: modelConfig.model });
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
      log("warn", "all models exhausted, backing off", { pass: pass + 1, delayMs });
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return { outputText, usage, unrecoverableErrors, aborted };
}
