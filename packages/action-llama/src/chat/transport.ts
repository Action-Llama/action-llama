/**
 * ChatTransport abstraction — shared interface for local and remote chat.
 */

import type { ChatInbound, ChatOutbound } from "./types.js";

export interface ChatTransport {
  /** Send an inbound message to the agent. */
  send(msg: ChatInbound): void;

  /** Subscribe to outbound messages from the agent. Returns an unsubscribe function. */
  onMessage(handler: (msg: ChatOutbound) => void): () => void;

  /** Close the transport and clean up resources. */
  close(): Promise<void>;

  /** Whether the transport is currently connected. */
  readonly connected: boolean;
}
