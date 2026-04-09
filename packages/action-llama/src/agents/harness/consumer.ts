import type { TokenUsage } from "../../shared/usage.js";
import { isUnrecoverableError, UNRECOVERABLE_THRESHOLD } from "../../shared/errors.js";
import type { AgentHarness, HarnessEvent } from "./types.js";

export interface ConsumeHarnessOpts {
  log: (level: string, msg: string, data?: Record<string, any>) => void;
  onUnrecoverableAbort?: () => void;
}

export interface ConsumeResult {
  outputText: string;
  usage?: TokenUsage;
  unrecoverableErrors: number;
  aborted: boolean;
  allModelsExhausted: boolean;
  errorMessage?: string;
  /** Final context window usage as a percentage (0-100). */
  contextPercent?: number;
  /** The stop_reason from the final message_end event (e.g. "end_turn", "max_tokens"). */
  lastStopReason?: string;
  /** The last few tool calls with their error status, for terminal-state diagnostics. */
  lastToolResults: Array<{ tool: string; cmd?: string; isError: boolean }>;
  /** Tool calls that started but never completed — session ended mid-execution. */
  orphanedToolCalls: Array<{ tool: string; cmd?: string }>;
}

function extractToolErrorText(result: string): string {
  try {
    const parsed = JSON.parse(result);
    if (parsed?.content?.[0]?.text) {
      return String(parsed.content[0].text);
    }
  } catch {
    // Fall back to raw result.
  }
  return result;
}

function toSerializable(value: unknown): unknown {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function logUsage(log: ConsumeHarnessOpts["log"], usage: TokenUsage): void {
  log("info", "token-usage", {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    totalTokens: usage.totalTokens,
    cost: usage.cost,
    turnCount: usage.turnCount,
  });
}

export async function consumeHarness(
  harness: AgentHarness,
  events: AsyncIterable<HarnessEvent>,
  opts: ConsumeHarnessOpts,
): Promise<ConsumeResult> {
  const pendingCmds = new Map<string, string>();
  const { log, onUnrecoverableAbort } = opts;

  let outputText = "";
  let currentTurnText = "";
  let usage: TokenUsage | undefined;
  let unrecoverableErrors = 0;
  let aborted = false;
  let allModelsExhausted = false;
  let errorMessage: string | undefined;
  let lastStopReason: string | undefined;
  let lastContextPercent: number | undefined;
  const lastToolResults: Array<{ tool: string; cmd?: string; isError: boolean }> = [];
  const activeToolCalls = new Map<string, { tool: string; cmd?: string }>();

  try {
    for await (const event of events) {
      switch (event.type) {
        case "log":
          const eventData = event.data;
          const eventType = eventData?.eventType ?? eventData?.type;
          const isConversationEvent = event.message === "conversation.event" || event.message === "event";
          if (isConversationEvent && eventType === "message_end") {
            if (eventData?.stopReason) {
              lastStopReason = String(eventData.stopReason);
            }
            if (currentTurnText.trim()) {
              log("info", "conversation.message", {
                kind: "conversation",
                role: eventData?.role || "assistant",
                stopReason: eventData?.stopReason,
                text: currentTurnText.trim(),
                raw: toSerializable(eventData?.raw),
              });
            }
            currentTurnText = "";
          }
          if (isConversationEvent && eventType === "turn_end" && typeof eventData?.errorMessage === "string") {
            errorMessage = eventData.errorMessage;
          }
          if (event.message === "context-usage" && event.data?.contextPercent != null) {
            lastContextPercent = event.data.contextPercent as number;
          }
          log(event.level, event.message, event.data);
          break;

        case "text_delta":
          outputText += event.delta;
          currentTurnText += event.delta;
          break;

        case "tool_start":
          if (event.command) {
            pendingCmds.set(event.toolCallId, event.command);
          }
          activeToolCalls.set(event.toolCallId, { tool: event.toolName, cmd: event.command });
          log("info", "conversation.tool_call", {
            kind: "conversation",
            tool: event.toolName,
            toolCallId: event.toolCallId,
            cmd: event.command,
            raw: toSerializable(event.raw),
          });
          break;

        case "tool_end": {
          const originCmd = pendingCmds.get(event.toolCallId);
          pendingCmds.delete(event.toolCallId);
          const resultText = extractToolErrorText(event.result);

          log(event.isError ? "error" : "info", "conversation.tool_result", {
            kind: "conversation",
            tool: event.toolName,
            toolCallId: event.toolCallId,
            cmd: originCmd,
            result: event.result,
            resultText,
            isError: event.isError,
            raw: toSerializable(event.raw),
          });

          activeToolCalls.delete(event.toolCallId);
          lastToolResults.push({ tool: event.toolName, cmd: originCmd, isError: event.isError });
          if (lastToolResults.length > 3) lastToolResults.shift();

          if (event.isError) {
            if (isUnrecoverableError(resultText)) {
              unrecoverableErrors++;
              if (unrecoverableErrors >= UNRECOVERABLE_THRESHOLD && !aborted) {
                log("error", "Aborting: repeated auth/permission failures — check credentials");
                aborted = true;
                onUnrecoverableAbort?.();
                harness.dispose();
              }
            }
          }
          break;
        }

        case "usage":
          usage = event.usage;
          logUsage(log, event.usage);
          break;

        case "exit":
          aborted = aborted || event.aborted;
          allModelsExhausted = event.allModelsExhausted;
          break;
      }
    }
  } finally {
    harness.dispose();
  }

  if (currentTurnText.trim()) {
    log("info", "conversation.message", {
      kind: "conversation",
      role: "assistant",
      text: currentTurnText.trim(),
    });
  }

  return {
    outputText,
    usage,
    unrecoverableErrors,
    aborted,
    allModelsExhausted,
    errorMessage,
    contextPercent: lastContextPercent,
    lastStopReason,
    lastToolResults,
    orphanedToolCalls: Array.from(activeToolCalls.values()),
  };
}
