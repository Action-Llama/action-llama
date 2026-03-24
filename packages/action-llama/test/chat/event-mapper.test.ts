import { describe, it, expect } from "vitest";
import { mapAgentEvent } from "../../src/chat/event-mapper.js";

describe("mapAgentEvent", () => {
  it("maps text_delta to assistant_message with done=false", () => {
    const out = mapAgentEvent({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Hello" },
    });
    expect(out).toEqual([
      { type: "assistant_message", text: "Hello", done: false },
    ]);
  });

  it("ignores message_update without text_delta", () => {
    const out = mapAgentEvent({
      type: "message_update",
      assistantMessageEvent: { type: "content_block_start" },
    });
    expect(out).toEqual([]);
  });

  it("ignores text_delta with empty string", () => {
    const out = mapAgentEvent({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "" },
    });
    expect(out).toEqual([]);
  });

  it("maps agent_end to assistant_message with done=true", () => {
    const out = mapAgentEvent({ type: "agent_end" });
    expect(out).toEqual([
      { type: "assistant_message", text: "", done: true },
    ]);
  });

  it("maps turn_end to assistant_message with done=true", () => {
    const out = mapAgentEvent({ type: "turn_end" });
    expect(out).toEqual([
      { type: "assistant_message", text: "", done: true },
    ]);
  });

  it("maps tool_execution_start to tool_start", () => {
    const out = mapAgentEvent({
      type: "tool_execution_start",
      toolCallId: "tc-1",
      toolName: "bash",
      args: { command: "ls -la" },
    });
    expect(out).toEqual([
      {
        type: "tool_start",
        toolCallId: "tc-1",
        tool: "bash",
        input: '{"command":"ls -la"}',
      },
    ]);
  });

  it("maps tool_execution_start with no args", () => {
    const out = mapAgentEvent({
      type: "tool_execution_start",
      toolCallId: "tc-2",
      toolName: "read",
    });
    expect(out).toEqual([
      { type: "tool_start", toolCallId: "tc-2", tool: "read", input: "" },
    ]);
  });

  it("skips tool_execution_start without toolCallId", () => {
    const out = mapAgentEvent({
      type: "tool_execution_start",
      toolName: "bash",
    });
    expect(out).toEqual([]);
  });

  it("maps tool_execution_end to tool_result", () => {
    const out = mapAgentEvent({
      type: "tool_execution_end",
      toolCallId: "tc-1",
      toolName: "bash",
      result: "file1.ts\nfile2.ts",
      isError: false,
    });
    expect(out).toEqual([
      {
        type: "tool_result",
        toolCallId: "tc-1",
        tool: "bash",
        output: "file1.ts\nfile2.ts",
        error: undefined,
      },
    ]);
  });

  it("maps tool_execution_end with error", () => {
    const out = mapAgentEvent({
      type: "tool_execution_end",
      toolCallId: "tc-3",
      toolName: "bash",
      result: "command not found",
      isError: true,
    });
    expect(out).toEqual([
      {
        type: "tool_result",
        toolCallId: "tc-3",
        tool: "bash",
        output: "command not found",
        error: true,
      },
    ]);
  });

  it("maps tool_execution_end with object result", () => {
    const out = mapAgentEvent({
      type: "tool_execution_end",
      toolCallId: "tc-4",
      toolName: "read",
      result: { content: [{ text: "file contents" }] },
    });
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("tool_result");
    expect(JSON.parse((out[0] as any).output)).toEqual({
      content: [{ text: "file contents" }],
    });
  });

  it("returns empty array for unknown event types", () => {
    expect(mapAgentEvent({ type: "message_start" })).toEqual([]);
    expect(mapAgentEvent({ type: "message_end" })).toEqual([]);
    expect(mapAgentEvent({ type: "unknown_type" })).toEqual([]);
  });
});
