/**
 * Maps PI agent events to ChatOutbound messages.
 *
 * Pure function — reused by LocalTransport and chat container entrypoint.
 */

import type { ChatOutbound } from "./types.js";

/**
 * PI agent event (subset of fields we care about).
 * Using a loose type to avoid tight coupling to pi-coding-agent internals.
 */
export interface AgentEvent {
  type: string;
  assistantMessageEvent?: {
    type: string;
    delta?: string;
  };
  toolCallId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  isError?: boolean;
}

/**
 * Map a single PI AgentEvent to zero or more ChatOutbound messages.
 */
export function mapAgentEvent(event: AgentEvent): ChatOutbound[] {
  const out: ChatOutbound[] = [];

  switch (event.type) {
    case "message_update":
      if (event.assistantMessageEvent?.type === "text_delta" && event.assistantMessageEvent.delta) {
        out.push({
          type: "assistant_message",
          text: event.assistantMessageEvent.delta,
          done: false,
        });
      }
      break;

    case "agent_end":
    case "turn_end":
      out.push({
        type: "assistant_message",
        text: "",
        done: true,
      });
      break;

    case "tool_execution_start":
      if (event.toolCallId && event.toolName) {
        out.push({
          type: "tool_start",
          toolCallId: event.toolCallId,
          tool: event.toolName,
          input: event.args ? JSON.stringify(event.args) : "",
        });
      }
      break;

    case "tool_execution_end":
      if (event.toolCallId && event.toolName) {
        const resultStr = typeof event.result === "string"
          ? event.result
          : JSON.stringify(event.result ?? "");
        out.push({
          type: "tool_result",
          toolCallId: event.toolCallId,
          tool: event.toolName,
          output: resultStr,
          error: event.isError || undefined,
        });
      }
      break;
  }

  return out;
}
