/**
 * Integration tests: chat pure functions — no Docker required.
 *
 * Tests pure utility functions in the chat module that have no existing
 * direct test coverage:
 *
 *   1. chat/event-mapper.ts — mapAgentEvent()
 *      Maps PI agent events to ChatOutbound messages. Has zero existing
 *      test coverage. Exercises all 5 event types:
 *        - message_update with text_delta → assistant_message (done:false)
 *        - message_update without text_delta → empty array
 *        - agent_end → assistant_message (done:true)
 *        - turn_end → assistant_message (done:true)
 *        - tool_execution_start → tool_start
 *        - tool_execution_end → tool_result (with string/object result)
 *        - tool_execution_end with isError=true → tool_result with error
 *        - unknown event type → empty array
 *
 *   2. chat/validation.ts — validateInbound(), validateOutbound(), RateLimiter
 *      validateInbound/validateOutbound are tested via Docker-based WS tests
 *      but the pure functions are NOT tested directly. RateLimiter has zero
 *      coverage. Direct tests:
 *        - validateInbound: valid types (user_message/cancel/shutdown)
 *        - validateInbound: invalid JSON → error
 *        - validateInbound: oversized message → error
 *        - validateInbound: invalid type → error
 *        - validateInbound: user_message without text → error
 *        - validateOutbound: valid types
 *        - validateOutbound: invalid JSON/type → error
 *        - RateLimiter: consume() allows up to maxTokens, then rate-limits
 *
 * Covers:
 *   - chat/event-mapper.ts: mapAgentEvent() all branches
 *   - chat/validation.ts: validateInbound() all branches
 *   - chat/validation.ts: validateOutbound() all branches
 *   - chat/validation.ts: RateLimiter constructor + consume()
 */

import { describe, it, expect } from "vitest";

const { mapAgentEvent } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/chat/event-mapper.js"
);

const { validateInbound, validateOutbound, RateLimiter } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/chat/validation.js"
);

// ──────────────────────────────────────────────────────────────────────────────

describe("integration: mapAgentEvent (no Docker required)", () => {

  it("message_update with text_delta returns assistant_message (done:false)", () => {
    const result = mapAgentEvent({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Hello" },
    });
    expect(result.length).toBe(1);
    expect(result[0].type).toBe("assistant_message");
    expect(result[0].text).toBe("Hello");
    expect(result[0].done).toBe(false);
  });

  it("message_update without delta returns empty array", () => {
    const result = mapAgentEvent({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "" }, // empty delta
    });
    expect(result.length).toBe(0);
  });

  it("message_update without assistantMessageEvent returns empty array", () => {
    const result = mapAgentEvent({ type: "message_update" });
    expect(result.length).toBe(0);
  });

  it("message_update with non-text_delta event type returns empty array", () => {
    const result = mapAgentEvent({
      type: "message_update",
      assistantMessageEvent: { type: "something_else", delta: "test" },
    });
    expect(result.length).toBe(0);
  });

  it("agent_end returns assistant_message (done:true)", () => {
    const result = mapAgentEvent({ type: "agent_end" });
    expect(result.length).toBe(1);
    expect(result[0].type).toBe("assistant_message");
    expect(result[0].done).toBe(true);
    expect(result[0].text).toBe("");
  });

  it("turn_end returns assistant_message (done:true)", () => {
    const result = mapAgentEvent({ type: "turn_end" });
    expect(result.length).toBe(1);
    expect(result[0].type).toBe("assistant_message");
    expect(result[0].done).toBe(true);
  });

  it("tool_execution_start returns tool_start with toolCallId, tool, input", () => {
    const result = mapAgentEvent({
      type: "tool_execution_start",
      toolCallId: "call-abc",
      toolName: "my_tool",
      args: { param1: "value1", param2: 42 },
    });
    expect(result.length).toBe(1);
    expect(result[0].type).toBe("tool_start");
    expect(result[0].toolCallId).toBe("call-abc");
    expect(result[0].tool).toBe("my_tool");
    expect(result[0].input).toBe(JSON.stringify({ param1: "value1", param2: 42 }));
  });

  it("tool_execution_start without args sets input to empty string", () => {
    const result = mapAgentEvent({
      type: "tool_execution_start",
      toolCallId: "call-no-args",
      toolName: "simple_tool",
    });
    expect(result[0].input).toBe("");
  });

  it("tool_execution_start without toolCallId returns empty array", () => {
    const result = mapAgentEvent({
      type: "tool_execution_start",
      toolName: "tool-without-id",
    });
    expect(result.length).toBe(0);
  });

  it("tool_execution_end with string result returns tool_result", () => {
    const result = mapAgentEvent({
      type: "tool_execution_end",
      toolCallId: "call-xyz",
      toolName: "my_tool",
      result: "tool output string",
    });
    expect(result.length).toBe(1);
    expect(result[0].type).toBe("tool_result");
    expect(result[0].toolCallId).toBe("call-xyz");
    expect(result[0].output).toBe("tool output string");
    expect(result[0].error).toBeUndefined();
  });

  it("tool_execution_end with object result JSON-stringifies it", () => {
    const result = mapAgentEvent({
      type: "tool_execution_end",
      toolCallId: "call-obj",
      toolName: "my_tool",
      result: { key: "value", count: 3 },
    });
    expect(result[0].output).toBe(JSON.stringify({ key: "value", count: 3 }));
  });

  it("tool_execution_end with isError=true sets error field", () => {
    const result = mapAgentEvent({
      type: "tool_execution_end",
      toolCallId: "call-err",
      toolName: "failing_tool",
      result: "error message",
      isError: true,
    });
    expect(result[0].error).toBe(true);
  });

  it("tool_execution_end with null result outputs empty string (null ?? '' fallback)", () => {
    // The implementation uses `event.result ?? ""`, so null falls back to "" and
    // JSON.stringify("") is '""'
    const result = mapAgentEvent({
      type: "tool_execution_end",
      toolCallId: "call-null",
      toolName: "my_tool",
      result: null,
    });
    // null ?? "" → "" → JSON.stringify("") → '""'
    expect(result[0].output).toBe(JSON.stringify(""));
  });

  it("unknown event type returns empty array", () => {
    const result = mapAgentEvent({ type: "some_unknown_event_type" });
    expect(result.length).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────

describe("integration: validateInbound (no Docker required)", () => {

  it("accepts valid user_message with non-empty text", () => {
    const result = validateInbound(JSON.stringify({ type: "user_message", text: "Hello!" }));
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("accepts 'cancel' message type", () => {
    const result = validateInbound(JSON.stringify({ type: "cancel" }));
    expect(result.valid).toBe(true);
  });

  it("accepts 'shutdown' message type", () => {
    const result = validateInbound(JSON.stringify({ type: "shutdown" }));
    expect(result.valid).toBe(true);
  });

  it("rejects invalid JSON", () => {
    const result = validateInbound("not json at all {{{");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid JSON");
  });

  it("rejects oversized message (> 64KB)", () => {
    const big = JSON.stringify({ type: "user_message", text: "x".repeat(64 * 1024 + 1) });
    const result = validateInbound(big);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("exceeds");
  });

  it("rejects unknown type", () => {
    const result = validateInbound(JSON.stringify({ type: "bogus_type" }));
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid message type");
  });

  it("rejects user_message with empty text", () => {
    const result = validateInbound(JSON.stringify({ type: "user_message", text: "" }));
    expect(result.valid).toBe(false);
    expect(result.error).toContain("non-empty text");
  });

  it("rejects user_message with missing text field", () => {
    const result = validateInbound(JSON.stringify({ type: "user_message" }));
    expect(result.valid).toBe(false);
    expect(result.error).toContain("non-empty text");
  });

  it("rejects null input", () => {
    const result = validateInbound("null");
    expect(result.valid).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────

describe("integration: validateOutbound (no Docker required)", () => {

  it("accepts valid assistant_message", () => {
    const result = validateOutbound(JSON.stringify({ type: "assistant_message", text: "Hi", done: false }));
    expect(result.valid).toBe(true);
  });

  it("accepts 'tool_start' type", () => {
    const result = validateOutbound(JSON.stringify({ type: "tool_start", toolCallId: "id", tool: "t", input: "" }));
    expect(result.valid).toBe(true);
  });

  it("accepts 'tool_result' type", () => {
    const result = validateOutbound(JSON.stringify({ type: "tool_result", toolCallId: "id", tool: "t", output: "out" }));
    expect(result.valid).toBe(true);
  });

  it("accepts 'error' type", () => {
    const result = validateOutbound(JSON.stringify({ type: "error", message: "something failed" }));
    expect(result.valid).toBe(true);
  });

  it("accepts 'heartbeat' type", () => {
    const result = validateOutbound(JSON.stringify({ type: "heartbeat" }));
    expect(result.valid).toBe(true);
  });

  it("rejects invalid JSON", () => {
    const result = validateOutbound("{not valid json");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid JSON");
  });

  it("rejects unknown type", () => {
    const result = validateOutbound(JSON.stringify({ type: "unknown_outbound" }));
    expect(result.valid).toBe(false);
  });

  it("rejects oversized message", () => {
    const big = JSON.stringify({ type: "assistant_message", text: "x".repeat(64 * 1024 + 1), done: false });
    const result = validateOutbound(big);
    expect(result.valid).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────

describe("integration: RateLimiter (no Docker required)", () => {

  it("allows messages up to maxTokens bucket capacity", () => {
    const limiter = new RateLimiter(3, 0); // 3 tokens, no refill
    expect(limiter.consume()).toBe(true);
    expect(limiter.consume()).toBe(true);
    expect(limiter.consume()).toBe(true);
    expect(limiter.consume()).toBe(false); // exhausted
  });

  it("refills tokens over time", async () => {
    // 1 token max, 100 tokens/second refill rate
    const limiter = new RateLimiter(1, 100);
    limiter.consume(); // exhaust
    expect(limiter.consume()).toBe(false);
    // Wait 20ms = should refill 2 tokens (100 * 0.02 = 2), but max is 1
    await new Promise<void>(r => setTimeout(r, 20));
    expect(limiter.consume()).toBe(true); // refilled
  }, 5000);

  it("default constructor allows 10 messages initially", () => {
    const limiter = new RateLimiter(); // defaults: maxTokens=10, refillRate=10
    let allowed = 0;
    for (let i = 0; i < 15; i++) {
      if (limiter.consume()) allowed++;
    }
    expect(allowed).toBe(10); // exactly 10 tokens consumed before rate limit
  });
});
