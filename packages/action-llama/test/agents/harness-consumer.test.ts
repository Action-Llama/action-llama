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
});
