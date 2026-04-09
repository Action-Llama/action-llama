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
import { extractTurnEndError } from "./turn-end-error.js";

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
  allModelsExhausted: boolean;
  /** The stop_reason from the final message_end event (e.g. "end_turn", "max_tokens"). */
  lastStopReason?: string;
  /** The last few tool calls with their error status, for terminal-state diagnostics. */
  lastToolResults: Array<{ tool: string; cmd?: string; isError: boolean }>;
  /** Tool calls that started but never completed — session ended mid-execution. */
  orphanedToolCalls: Array<{ tool: string; cmd?: string }>;
}

const MAX_PASSES = 3;
const DEFAULT_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 300_000;

function extractToolResultText(result: string): string {
  try {
    const parsed = JSON.parse(result);
    if (parsed?.content?.[0]?.text) return String(parsed.content[0].text);
  } catch {
    // Fall back to raw result.
  }
  return result;
}

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
  let anyModelSucceeded = false;
  let usage: TokenUsage | undefined;
  let lastStopReason: string | undefined;
  const lastToolResults: Array<{ tool: string; cmd?: string; isError: boolean }> = [];
  const activeToolCalls = new Map<string, { tool: string; cmd?: string }>();

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
          tools: createCodingTools(cwd, {}),
          sessionManager: SessionManager.inMemory(),
          settingsManager,
        });

      session.subscribe((event) => {
        eventCount++;
        if (event.type !== "message_update") {
          const extra: Record<string, any> = { eventType: event.type, eventCount, raw: event };
          if (event.type === "message_start" || event.type === "message_end") {
            extra.role = (event as any).role || (event as any).message?.role;
            extra.content = JSON.stringify((event as any).content || (event as any).message?.content || []).slice(0, 500);
            extra.stopReason = (event as any).stopReason || (event as any).stop_reason;
          }
          if (event.type === "turn_end") {
            extra.turnResult = JSON.stringify(event).slice(0, 500);
            const errorMessage = extractTurnEndError(event);
            if (errorMessage) extra.errorMessage = errorMessage;
          }
          log("debug", "conversation.event", extra);

          // Emit context-usage at each turn_end using getContextUsage() (most reliable source)
          if (event.type === "turn_end") {
            try {
              const ctx = (session as any).getContextUsage?.();
              if (ctx && ctx.percent != null) {
                log("info", "context-usage", {
                  contextPercent: Math.round(ctx.percent * 10) / 10,
                  contextWindow: ctx.contextWindow,
                  contextTokens: ctx.tokens,
                });
              }
            } catch { /* context usage not available yet */ }
          }
        }
        if ((event as any).type === "error") {
          const err = (event as any).error;
          const errorMsg = err?.errorMessage
            || (typeof err === "string" ? err : null)
            || (event as any).message
            || JSON.stringify(event);
          log("error", "session error", { error: String(errorMsg), stopReason: err?.stopReason });
        }
        if (event.type === "message_update") {
          if (event.assistantMessageEvent?.type === "text_delta") {
            const delta = event.assistantMessageEvent.delta;
            outputText += delta;
            currentTurnText += delta;
          }
        }
        if (event.type === "message_end") {
          const sr = (event as any).stopReason || (event as any).stop_reason;
          if (sr) lastStopReason = String(sr);
          if (currentTurnText.trim()) {
            log("info", "conversation.message", {
              kind: "conversation",
              role: (event as any).role || (event as any).message?.role || "assistant",
              stopReason: sr,
              text: currentTurnText.trim(),
              raw: event,
            });
          }
          currentTurnText = "";

        }
        if (event.type === "tool_execution_start") {
          const cmd = String(event.args?.command || "");
          pendingCmds.set(event.toolCallId, cmd);
          activeToolCalls.set(event.toolCallId, { tool: event.toolName, cmd });
          log("info", "conversation.tool_call", {
            kind: "conversation",
            tool: event.toolName,
            toolCallId: event.toolCallId,
            cmd,
            raw: event,
          });
        }
        if (event.type === "tool_execution_end") {
          const resultStr = typeof event.result === "string"
            ? event.result
            : JSON.stringify(event.result);
          const originCmd = pendingCmds.get(event.toolCallId);
          pendingCmds.delete(event.toolCallId);
          const resultText = extractToolResultText(resultStr);

          log(event.isError ? "error" : "info", "conversation.tool_result", {
            kind: "conversation",
            tool: event.toolName,
            toolCallId: event.toolCallId,
            cmd: originCmd,
            result: resultStr,
            resultText,
            isError: event.isError,
            raw: event,
          });

          activeToolCalls.delete(event.toolCallId);
          lastToolResults.push({ tool: event.toolName, cmd: originCmd, isError: event.isError });
          if (lastToolResults.length > 3) lastToolResults.shift();

          if (event.isError) {
            if (isUnrecoverableError(resultText)) {
              unrecoverableErrors++;
              if (unrecoverableErrors >= UNRECOVERABLE_THRESHOLD) {
                log("error", "Aborting: repeated auth/permission failures — check credentials");
                aborted = true;
                if (onUnrecoverableAbort) onUnrecoverableAbort();
                session.dispose();
              }
            }
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
        anyModelSucceeded = true;
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

  const allModelsExhausted = !anyModelSucceeded && !aborted;
  if (allModelsExhausted) {
    log("error", "all models exhausted across all retry passes — every model was rate-limited or overloaded");
  }

  return { outputText, usage, unrecoverableErrors, aborted, allModelsExhausted, lastStopReason, lastToolResults, orphanedToolCalls: Array.from(activeToolCalls.values()) };
}
