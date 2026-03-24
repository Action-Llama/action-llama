/**
 * Message validation and rate limiting for the chat protocol.
 */

import type { ChatInbound, ChatOutbound } from "./types.js";

const MAX_MESSAGE_SIZE = 64 * 1024; // 64KB

const INBOUND_TYPES = new Set(["user_message", "cancel", "shutdown"]);
const OUTBOUND_TYPES = new Set(["assistant_message", "tool_start", "tool_result", "error", "heartbeat"]);

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate an inbound chat message.
 */
export function validateInbound(raw: string): ValidationResult {
  if (raw.length > MAX_MESSAGE_SIZE) {
    return { valid: false, error: `Message exceeds ${MAX_MESSAGE_SIZE} byte limit` };
  }

  let msg: ChatInbound;
  try {
    msg = JSON.parse(raw);
  } catch {
    return { valid: false, error: "Invalid JSON" };
  }

  if (!msg || typeof msg !== "object" || !INBOUND_TYPES.has(msg.type)) {
    return { valid: false, error: `Invalid message type: ${(msg as any)?.type}` };
  }

  if (msg.type === "user_message") {
    if (typeof msg.text !== "string" || msg.text.length === 0) {
      return { valid: false, error: "user_message requires non-empty text" };
    }
  }

  return { valid: true };
}

/**
 * Validate an outbound chat message.
 */
export function validateOutbound(raw: string): ValidationResult {
  if (raw.length > MAX_MESSAGE_SIZE) {
    return { valid: false, error: `Message exceeds ${MAX_MESSAGE_SIZE} byte limit` };
  }

  let msg: ChatOutbound;
  try {
    msg = JSON.parse(raw);
  } catch {
    return { valid: false, error: "Invalid JSON" };
  }

  if (!msg || typeof msg !== "object" || !OUTBOUND_TYPES.has(msg.type)) {
    return { valid: false, error: `Invalid message type: ${(msg as any)?.type}` };
  }

  return { valid: true };
}

/**
 * Token bucket rate limiter for chat messages.
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number;

  constructor(maxTokens = 10, refillRatePerSecond = 10) {
    this.maxTokens = maxTokens;
    this.tokens = maxTokens;
    this.refillRate = refillRatePerSecond;
    this.lastRefill = Date.now();
  }

  /**
   * Try to consume a token. Returns true if allowed, false if rate-limited.
   */
  consume(): boolean {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}
