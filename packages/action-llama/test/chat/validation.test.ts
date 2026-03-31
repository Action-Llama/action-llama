import { describe, it, expect, beforeEach } from "vitest";
import { validateInbound, validateOutbound, RateLimiter } from "../../src/chat/validation.js";

describe("validateInbound", () => {
  it("accepts valid user_message", () => {
    const result = validateInbound(JSON.stringify({ type: "user_message", text: "hello" }));
    expect(result.valid).toBe(true);
  });

  it("accepts cancel message", () => {
    const result = validateInbound(JSON.stringify({ type: "cancel" }));
    expect(result.valid).toBe(true);
  });

  it("accepts shutdown message", () => {
    const result = validateInbound(JSON.stringify({ type: "shutdown" }));
    expect(result.valid).toBe(true);
  });

  it("rejects invalid JSON", () => {
    const result = validateInbound("not json{");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Invalid JSON");
  });

  it("rejects unknown message type", () => {
    const result = validateInbound(JSON.stringify({ type: "unknown" }));
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid message type");
  });

  it("rejects user_message with empty text", () => {
    const result = validateInbound(JSON.stringify({ type: "user_message", text: "" }));
    expect(result.valid).toBe(false);
    expect(result.error).toContain("non-empty text");
  });

  it("rejects user_message without text", () => {
    const result = validateInbound(JSON.stringify({ type: "user_message" }));
    expect(result.valid).toBe(false);
  });

  it("rejects messages exceeding size limit", () => {
    const large = JSON.stringify({ type: "user_message", text: "x".repeat(65 * 1024) });
    const result = validateInbound(large);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("byte limit");
  });

  it("rejects non-object message", () => {
    const result = validateInbound(JSON.stringify("just a string"));
    expect(result.valid).toBe(false);
  });

  it("rejects null message", () => {
    const result = validateInbound("null");
    expect(result.valid).toBe(false);
  });
});

describe("validateOutbound", () => {
  it("accepts valid assistant_message", () => {
    const result = validateOutbound(JSON.stringify({ type: "assistant_message", text: "hi", done: false }));
    expect(result.valid).toBe(true);
  });

  it("accepts tool_start", () => {
    const result = validateOutbound(
      JSON.stringify({ type: "tool_start", toolCallId: "1", tool: "bash", input: "{}" }),
    );
    expect(result.valid).toBe(true);
  });

  it("accepts tool_result", () => {
    const result = validateOutbound(
      JSON.stringify({ type: "tool_result", toolCallId: "1", tool: "bash", output: "ok" }),
    );
    expect(result.valid).toBe(true);
  });

  it("accepts error message", () => {
    const result = validateOutbound(JSON.stringify({ type: "error", message: "oops" }));
    expect(result.valid).toBe(true);
  });

  it("accepts heartbeat", () => {
    const result = validateOutbound(JSON.stringify({ type: "heartbeat" }));
    expect(result.valid).toBe(true);
  });

  it("rejects invalid outbound type", () => {
    const result = validateOutbound(JSON.stringify({ type: "user_message", text: "hi" }));
    expect(result.valid).toBe(false);
  });

  it("rejects invalid JSON outbound", () => {
    const result = validateOutbound("not valid json{{{");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Invalid JSON");
  });

  it("rejects oversized outbound", () => {
    const large = JSON.stringify({ type: "assistant_message", text: "x".repeat(65 * 1024), done: false });
    const result = validateOutbound(large);
    expect(result.valid).toBe(false);
  });
});

describe("RateLimiter", () => {
  it("allows initial burst up to maxTokens", () => {
    const limiter = new RateLimiter(3, 10);
    expect(limiter.consume()).toBe(true);
    expect(limiter.consume()).toBe(true);
    expect(limiter.consume()).toBe(true);
    expect(limiter.consume()).toBe(false);
  });

  it("refills tokens over time", async () => {
    const limiter = new RateLimiter(2, 100); // 100/s refill = 1 per 10ms
    limiter.consume();
    limiter.consume();
    expect(limiter.consume()).toBe(false);

    // Wait for refill
    await new Promise((r) => setTimeout(r, 30));
    expect(limiter.consume()).toBe(true);
  });

  it("does not exceed maxTokens on refill", async () => {
    const limiter = new RateLimiter(2, 10); // slow refill: 10/s
    // Drain all tokens
    limiter.consume();
    limiter.consume();
    expect(limiter.consume()).toBe(false);

    // Wait long enough to refill past max if uncapped
    await new Promise((r) => setTimeout(r, 500)); // would be 5 tokens at 10/s

    // Should only have 2 (maxTokens), not 5
    expect(limiter.consume()).toBe(true);
    expect(limiter.consume()).toBe(true);
    expect(limiter.consume()).toBe(false);
  });

  it("uses default values when no args provided", () => {
    const limiter = new RateLimiter();
    // Default is 10 tokens
    for (let i = 0; i < 10; i++) {
      expect(limiter.consume()).toBe(true);
    }
    expect(limiter.consume()).toBe(false);
  });
});
