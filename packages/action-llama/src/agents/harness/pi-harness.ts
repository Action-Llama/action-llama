/**
 * Pi agent harness — wraps @mariozechner/pi-coding-agent into the
 * AgentHarness interface with model-fallback and circuit breaker.
 */
import { getModel } from "@mariozechner/pi-ai";
import {
  AuthStorage,
  createAgentSession,
  SessionManager,
  createCodingTools,
} from "@mariozechner/pi-coding-agent";
import type { ModelConfig } from "../../shared/config.js";
import type { TokenUsage } from "../../shared/usage.js";
import { sessionStatsToUsage } from "../../shared/usage.js";
import { ModelCircuitBreaker, selectAvailableModels, isRateLimitError } from "../model-fallback.js";
import type { AgentHarness, HarnessEvent, HarnessRunOpts } from "./types.js";
import { extractTurnEndError } from "../turn-end-error.js";

export interface PiHarnessOpts {
  models: ModelConfig[];
  circuitBreaker: ModelCircuitBreaker;
  resourceLoader: any;
  settingsManager: any;
  providerKeys?: Map<string, string>;
}

const MAX_PASSES = 3;
const DEFAULT_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 300_000;

export class PiHarness implements AgentHarness {
  private session: any = null;

  constructor(private opts: PiHarnessOpts) {}

  async *run(prompt: string, runOpts: HarnessRunOpts): AsyncIterable<HarnessEvent> {
    const { models, circuitBreaker, resourceLoader, settingsManager, providerKeys } = this.opts;
    const { cwd } = runOpts;

    let anyModelSucceeded = false;

    for (let pass = 0; pass <= MAX_PASSES; pass++) {
      const availableModels = selectAvailableModels(models, circuitBreaker);
      let modelSucceeded = false;

      for (const modelConfig of availableModels) {
        const llmModel = getModel(modelConfig.provider as any, modelConfig.model as any);

        yield {
          type: "log",
          level: "info",
          message: "creating agent session",
          data: { model: modelConfig.model, thinking: modelConfig.thinkingLevel },
        };

        const authStorage = AuthStorage.create();
        const providerKey = providerKeys?.get(modelConfig.provider);
        if (providerKey) {
          authStorage.setRuntimeApiKey(modelConfig.provider, providerKey);
        }

        const { session } = await createAgentSession({
          cwd,
          model: llmModel,
          thinkingLevel: modelConfig.thinkingLevel,
          authStorage,
          resourceLoader,
          tools: createCodingTools(cwd, {}),
          sessionManager: SessionManager.inMemory(),
          settingsManager,
        });

        this.session = session;

        // Collect events via callback into a queue that the async generator drains
        const eventQueue: HarnessEvent[] = [];
        let eventCount = 0;
        const pendingCmds = new Map<string, string>();

        let lastStopReason: string | undefined;
        let pendingToolStarts = 0;

        session.subscribe((event: any) => {
          eventCount++;

          // Non-update events → debug log
          if (event.type !== "message_update") {
            const extra: Record<string, any> = { eventType: event.type, eventCount, raw: event };
            if (event.type === "message_start" || event.type === "message_end") {
              extra.role = event.role || event.message?.role;
              extra.content = JSON.stringify(event.content || event.message?.content || []).slice(0, 500);
              // Pi library doesn't expose stopReason on message_end events directly.
              // Try multiple paths: direct field, nested in message, or from the API response.
              const sr = event.stopReason || event.stop_reason
                || event.message?.stopReason || event.message?.stop_reason
                || event.message?.stop_reason;
              if (sr) {
                extra.stopReason = sr;
                lastStopReason = String(sr);
              }
            }
            // agent_end fires when the entire prompt() call completes.
            // This is our best signal that the model stopped.
            if (event.type === "agent_end") {
              // If we have pending tool starts without matching ends, the session
              // ended with orphaned tool calls — the model returned end_turn mid-execution.
              if (pendingToolStarts > 0) {
                extra.orphanedToolCalls = pendingToolStarts;
              }
              // Infer stop reason: if the pi library doesn't surface it,
              // we can at least distinguish "end_turn" (no pending tools) from
              // "interrupted" (orphaned tools).
              if (!lastStopReason) {
                lastStopReason = pendingToolStarts > 0 ? "end_turn (orphaned tools)" : "end_turn";
              }
              // Emit as a synthetic message_end so the consumer captures lastStopReason
              eventQueue.push({
                type: "log",
                level: "debug",
                message: "conversation.event",
                data: { eventType: "message_end", stopReason: lastStopReason, role: "assistant", inferred: true },
              });
            }
            if (event.type === "turn_end") {
              extra.turnResult = JSON.stringify(event).slice(0, 500);
              const errorMessage = extractTurnEndError(event);
              if (errorMessage) extra.errorMessage = errorMessage;
            }
            eventQueue.push({ type: "log", level: "debug", message: "conversation.event", data: extra });
          }

          // Error events
          if (event.type === "error") {
            eventQueue.push({
              type: "log",
              level: "error",
              message: "session error",
              data: { error: String(event.error || event.message || JSON.stringify(event)) },
            });
          }

          // Text deltas
          if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
            eventQueue.push({ type: "text_delta", delta: event.assistantMessageEvent.delta, raw: event });
          }

          // Tool execution events
          if (event.type === "tool_execution_start") {
            pendingToolStarts++;
            const cmd = String(event.args?.command || "");
            if (event.toolName === "bash") {
              pendingCmds.set(event.toolCallId, cmd);
            }
            eventQueue.push({
              type: "tool_start",
              toolName: event.toolName,
              toolCallId: event.toolCallId,
              command: cmd || undefined,
              raw: event,
            });
          }

          if (event.type === "tool_execution_end") {
            pendingToolStarts = Math.max(0, pendingToolStarts - 1);
            const resultStr = typeof event.result === "string"
              ? event.result
              : JSON.stringify(event.result);
            pendingCmds.delete(event.toolCallId);
            eventQueue.push({
              type: "tool_end",
              toolName: event.toolName,
              toolCallId: event.toolCallId,
              result: resultStr,
              isError: !!event.isError,
              raw: event,
            });
          }
        });

        try {
          const promptPromise = session.prompt(prompt);

          // Drain the event queue while waiting for prompt to complete
          while (true) {
            // Yield any queued events
            while (eventQueue.length > 0) {
              yield eventQueue.shift()!;
            }
            // Check if prompt is done (race with a short delay)
            const done = await Promise.race([
              promptPromise.then(() => true),
              new Promise<false>((r) => setTimeout(() => r(false), 50)),
            ]);
            if (done) {
              // Yield remaining events
              while (eventQueue.length > 0) {
                yield eventQueue.shift()!;
              }
              break;
            }
          }

          circuitBreaker.recordSuccess(modelConfig.provider, modelConfig.model);

          yield {
            type: "log",
            level: "info",
            message: "prompt returned",
            data: { eventCount },
          };

          // Emit usage
          const sessionStats = session.getSessionStats();
          const usage: TokenUsage = sessionStatsToUsage(sessionStats);
          yield { type: "usage", usage };

          session.dispose();
          this.session = null;
          modelSucceeded = true;
          anyModelSucceeded = true;
          break;
        } catch (promptErr: any) {
          const msg = String(promptErr?.message || promptErr || "");
          if (isRateLimitError(msg)) {
            circuitBreaker.recordFailure(modelConfig.provider, modelConfig.model);
            yield {
              type: "log",
              level: "warn",
              message: "rate limited, trying next model",
              data: { provider: modelConfig.provider, model: modelConfig.model },
            };
            session.dispose();
            this.session = null;
            continue;
          }
          session.dispose();
          this.session = null;
          throw promptErr;
        }
      }

      if (modelSucceeded) break;

      if (pass < MAX_PASSES) {
        const delayMs = Math.min(DEFAULT_BACKOFF_MS * Math.pow(2, pass), MAX_BACKOFF_MS);
        yield {
          type: "log",
          level: "warn",
          message: "all models exhausted, backing off",
          data: { pass: pass + 1, delayMs },
        };
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    const allModelsExhausted = !anyModelSucceeded;
    if (allModelsExhausted) {
      yield {
        type: "log",
        level: "error",
        message: "all models exhausted across all retry passes — every model was rate-limited or overloaded",
      };
    }

    yield { type: "exit", aborted: false, allModelsExhausted };
  }

  dispose(): void {
    if (this.session) {
      this.session.dispose();
      this.session = null;
    }
  }
}
