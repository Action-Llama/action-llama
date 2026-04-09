import { describe, it, expect, vi } from "vitest";
import { consumeHarness } from "../../src/agents/harness/consumer.js";
import type { AgentHarness, HarnessEvent } from "../../src/agents/harness/types.js";

function makeHarness(events: HarnessEvent[]): AgentHarness {
  return {
    async *run() {
      for (const event of events) yield event;
    },
    dispose: vi.fn(),
  };
}

describe("consumeHarness", () => {
  it("preserves turn_end provider errors from event logs", async () => {
    const harness = makeHarness([
      {
        type: "log",
        level: "debug",
        message: "event",
        data: {
          type: "turn_end",
          errorMessage: "OpenAI provider error: model overloaded",
          turnResult: "{\"type\":\"turn_end\",\"errorMessage\":\"OpenAI provider error: model overloaded\"}",
        },
      },
      { type: "exit", aborted: false, allModelsExhausted: false },
    ]);

    const result = await consumeHarness(harness, harness.run("prompt", { cwd: "/tmp" }), {
      log: vi.fn(),
    });

    expect(result.errorMessage).toBe("OpenAI provider error: model overloaded");
  });

  it("logs conversation messages and tool events with raw payloads", async () => {
    const log = vi.fn();
    const rawToolStart = { type: "tool_execution_start", toolName: "bash" };
    const rawToolEnd = { type: "tool_execution_end", toolName: "bash" };
    const harness = makeHarness([
      { type: "text_delta", delta: "hello " },
      { type: "text_delta", delta: "world" },
      {
        type: "log",
        level: "debug",
        message: "conversation.event",
        data: { eventType: "message_end", role: "assistant", stopReason: "end_turn", raw: { type: "message_end" } },
      },
      {
        type: "tool_start",
        toolName: "bash",
        toolCallId: "call-1",
        command: "rg test",
        raw: rawToolStart,
      },
      {
        type: "tool_end",
        toolName: "bash",
        toolCallId: "call-1",
        result: JSON.stringify({ content: [{ text: "match-1" }] }),
        isError: false,
        raw: rawToolEnd,
      },
      { type: "exit", aborted: false, allModelsExhausted: false },
    ]);

    await consumeHarness(harness, harness.run("prompt", { cwd: "/tmp" }), { log });

    expect(log).toHaveBeenCalledWith(
      "info",
      "conversation.message",
      expect.objectContaining({ text: "hello world", role: "assistant", raw: { type: "message_end" } }),
    );
    expect(log).toHaveBeenCalledWith(
      "info",
      "conversation.tool_call",
      expect.objectContaining({ tool: "bash", cmd: "rg test", raw: rawToolStart }),
    );
    expect(log).toHaveBeenCalledWith(
      "info",
      "conversation.tool_result",
      expect.objectContaining({ tool: "bash", resultText: "match-1", raw: rawToolEnd }),
    );
  });

  it("aborts after repeated unrecoverable tool errors and records the last tool results", async () => {
    const log = vi.fn();
    const onUnrecoverableAbort = vi.fn();
    const circularRaw: Record<string, unknown> = {};
    circularRaw.self = circularRaw;
    const harness = makeHarness([
      {
        type: "tool_start",
        toolName: "git",
        toolCallId: "call-1",
        command: "git fetch",
        raw: circularRaw,
      },
      {
        type: "tool_end",
        toolName: "git",
        toolCallId: "call-1",
        result: "permission denied",
        isError: true,
      },
      {
        type: "tool_start",
        toolName: "git",
        toolCallId: "call-2",
        command: "git push",
      },
      {
        type: "tool_end",
        toolName: "git",
        toolCallId: "call-2",
        result: "authentication failed",
        isError: true,
      },
      {
        type: "tool_start",
        toolName: "github",
        toolCallId: "call-3",
        command: "gh issue create",
      },
      {
        type: "tool_end",
        toolName: "github",
        toolCallId: "call-3",
        result: JSON.stringify({ content: [{ text: "resource not accessible by personal access token" }] }),
        isError: true,
      },
      { type: "exit", aborted: false, allModelsExhausted: true },
    ]);

    const result = await consumeHarness(harness, harness.run("prompt", { cwd: "/tmp" }), {
      log,
      onUnrecoverableAbort,
    });

    expect(result).toEqual({
      outputText: "",
      usage: undefined,
      unrecoverableErrors: 3,
      aborted: true,
      allModelsExhausted: true,
      errorMessage: undefined,
      lastStopReason: undefined,
      lastToolResults: [
        { tool: "git", cmd: "git fetch", isError: true },
        { tool: "git", cmd: "git push", isError: true },
        { tool: "github", cmd: "gh issue create", isError: true },
      ],
      orphanedToolCalls: [],
    });
    expect(onUnrecoverableAbort).toHaveBeenCalledTimes(1);
    expect(harness.dispose).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith(
      "info",
      "conversation.tool_call",
      expect.objectContaining({ tool: "git", cmd: "git fetch", raw: "[object Object]" }),
    );
    expect(log).toHaveBeenCalledWith(
      "error",
      "Aborting: repeated auth/permission failures — check credentials",
    );
  });

  it("flushes trailing assistant text, logs usage, and reports orphaned tool calls", async () => {
    const log = vi.fn();
    const harness = makeHarness([
      { type: "text_delta", delta: "partial " },
      { type: "text_delta", delta: "answer" },
      {
        type: "tool_start",
        toolName: "bash",
        toolCallId: "call-9",
        command: "ls -la",
      },
      {
        type: "usage",
        usage: {
          inputTokens: 4,
          outputTokens: 5,
          cacheReadTokens: 6,
          cacheWriteTokens: 7,
          totalTokens: 9,
          cost: 1.25,
          turnCount: 2,
        },
      },
      { type: "exit", aborted: false, allModelsExhausted: false },
    ]);

    const result = await consumeHarness(harness, harness.run("prompt", { cwd: "/tmp" }), { log });

    expect(result).toEqual({
      outputText: "partial answer",
      usage: {
        inputTokens: 4,
        outputTokens: 5,
        cacheReadTokens: 6,
        cacheWriteTokens: 7,
        totalTokens: 9,
        cost: 1.25,
        turnCount: 2,
      },
      unrecoverableErrors: 0,
      aborted: false,
      allModelsExhausted: false,
      errorMessage: undefined,
      lastStopReason: undefined,
      lastToolResults: [],
      orphanedToolCalls: [{ tool: "bash", cmd: "ls -la" }],
    });
    expect(log).toHaveBeenCalledWith("info", "token-usage", {
      inputTokens: 4,
      outputTokens: 5,
      cacheReadTokens: 6,
      cacheWriteTokens: 7,
      totalTokens: 9,
      cost: 1.25,
      turnCount: 2,
    });
    expect(log).toHaveBeenCalledWith("info", "conversation.message", {
      kind: "conversation",
      role: "assistant",
      text: "partial answer",
    });
  });
});
