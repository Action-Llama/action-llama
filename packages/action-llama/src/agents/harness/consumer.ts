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

  try {
    for await (const event of events) {
      switch (event.type) {
        case "log":
          if (event.message === "message_end") {
            if (currentTurnText.trim()) {
              log("info", "assistant", { text: currentTurnText.trim() });
            }
            currentTurnText = "";
            break;
          }
          if (event.message === "event" && event.data?.type === "turn_end" && typeof event.data.errorMessage === "string") {
            errorMessage = event.data.errorMessage;
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
          if (event.toolName === "bash" && event.command) {
            log("info", "bash", { cmd: event.command.slice(0, 200) });
          } else {
            log("debug", "tool start", { tool: event.toolName });
          }
          break;

        case "tool_end": {
          const originCmd = pendingCmds.get(event.toolCallId);
          pendingCmds.delete(event.toolCallId);

          if (event.isError) {
            log("error", "tool error", {
              tool: event.toolName,
              cmd: originCmd?.slice(0, 200),
              result: event.result.slice(0, 1000),
            });

            const errorText = extractToolErrorText(event.result);
            if (isUnrecoverableError(errorText)) {
              unrecoverableErrors++;
              if (unrecoverableErrors >= UNRECOVERABLE_THRESHOLD && !aborted) {
                log("error", "Aborting: repeated auth/permission failures — check credentials");
                aborted = true;
                onUnrecoverableAbort?.();
                harness.dispose();
              }
            }
          } else {
            log("debug", "tool done", {
              tool: event.toolName,
              resultLength: event.result.length,
            });
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
    log("info", "assistant", { text: currentTurnText.trim() });
  }

  return {
    outputText,
    usage,
    unrecoverableErrors,
    aborted,
    allModelsExhausted,
    errorMessage,
  };
}
