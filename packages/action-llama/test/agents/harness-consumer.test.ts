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
});
