/**
 * Chat protocol types for bidirectional real-time agent communication.
 *
 * Used by both browser WebSocket connections and container-side chat entries.
 */

// --- Inbound messages (browser/CLI → agent) ---

export interface UserMessage {
  type: "user_message";
  text: string;
}

export interface CancelMessage {
  type: "cancel";
}

export interface ShutdownMessage {
  type: "shutdown";
}

export type ChatInbound = UserMessage | CancelMessage | ShutdownMessage;

// --- Outbound messages (agent → browser/CLI) ---

export interface AssistantMessage {
  type: "assistant_message";
  text: string;
  done: boolean;
}

export interface ToolStart {
  type: "tool_start";
  toolCallId: string;
  tool: string;
  input: string;
}

export interface ToolResult {
  type: "tool_result";
  toolCallId: string;
  tool: string;
  output: string;
  error?: boolean;
}

export interface ChatError {
  type: "error";
  message: string;
}

export interface Heartbeat {
  type: "heartbeat";
}

export type ChatOutbound =
  | AssistantMessage
  | ToolStart
  | ToolResult
  | ChatError
  | Heartbeat;

// --- Session tracking ---

export interface ChatSession {
  sessionId: string;
  agentName: string;
  containerName?: string;
  createdAt: Date;
  lastActivityAt: Date;
}
