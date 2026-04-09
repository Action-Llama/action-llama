import { PassThrough } from "stream";
import { describe, expect, it, vi } from "vitest";
import { ClaudeCliHarness } from "../../src/agents/harness/claude-cli-harness.js";
import { makeModel } from "../helpers.js";

async function collectEvents<T>(iterator: AsyncIterator<T>, firstValue?: T): Promise<T[]> {
  const events: T[] = [];
  if (firstValue !== undefined) events.push(firstValue);

  while (true) {
    const next = await iterator.next();
    if (next.done) break;
    events.push(next.value);
  }

  return events;
}

function createMockChild() {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let closeHandler: ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined;
  let errorHandler: ((error: Error) => void) | undefined;

  return {
    stdout,
    stderr,
    child: {
      stdout,
      stderr,
      killed: false,
      kill: vi.fn(),
      on: vi.fn((event: string, handler: (...args: any[]) => void) => {
        if (event === "close") closeHandler = handler as (code: number | null, signal: NodeJS.Signals | null) => void;
        if (event === "error") errorHandler = handler as (error: Error) => void;
        return undefined;
      }),
    },
    close(code = 0, signal: NodeJS.Signals | null = null) {
      closeHandler?.(code, signal);
    },
    fail(error: Error) {
      errorHandler?.(error);
    },
  };
}

describe("ClaudeCliHarness", () => {
  it("spawns Claude CLI with verbose stream-json output", async () => {
    const mockProc = createMockChild();
    const spawnImpl = vi.fn().mockReturnValue(mockProc.child as any);
    const harness = new ClaudeCliHarness({
      model: makeModel(),
      spawnImpl: spawnImpl as any,
    });

    const iterator = harness.run("Inspect repo", { cwd: "/tmp/project", env: { TEST_ENV: "1" } })[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.done).toBe(false);
    expect(first.value).toMatchObject({ type: "log", message: "creating agent session" });

    const eventsPromise = collectEvents(iterator, first.value);

    mockProc.stdout.write('{"type":"result","usage":{"input_tokens":1,"output_tokens":2}}\n');
    mockProc.stdout.end();
    mockProc.stderr.end();
    mockProc.close(0, null);

    const events = await eventsPromise;

    expect(spawnImpl).toHaveBeenCalledWith(
      "claude",
      expect.arrayContaining(["--verbose", "--output-format", "stream-json"]),
      expect.objectContaining({
        cwd: "/tmp/project",
        env: expect.objectContaining({
          TEST_ENV: "1",
        }),
      }),
    );
    expect(events).toContainEqual({
      type: "usage",
      usage: {
        inputTokens: 1,
        outputTokens: 2,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 3,
        cost: 0,
        turnCount: 1,
      },
    });
    expect(events).toContainEqual({ type: "exit", aborted: false, allModelsExhausted: false });
  });

  describe("run", () => {
    it.each([
      ["off", "low"],
      ["minimal", "low"],
      ["low", "medium"],
      ["medium", "medium"],
      ["high", "high"],
      ["xhigh", "max"],
      ["unexpected", "medium"],
    ] as const)("maps thinking level %s to --effort %s", async (thinkingLevel, effort) => {
      const mockProc = createMockChild();
      const spawnImpl = vi.fn().mockReturnValue(mockProc.child as any);
      const harness = new ClaudeCliHarness({
        model: makeModel({ thinkingLevel: thinkingLevel as any }),
        spawnImpl: spawnImpl as any,
      });

      const iterator = harness.run("Inspect repo", { cwd: "/tmp/project" })[Symbol.asyncIterator]();
      const first = await iterator.next();
      expect(first.value).toMatchObject({
        type: "log",
        data: { thinking: thinkingLevel },
      });

      const eventsPromise = collectEvents(iterator);
      await Promise.resolve();
      mockProc.stdout.end();
      mockProc.stderr.end();
      mockProc.close(0, null);
      await eventsPromise;

      expect(spawnImpl).toHaveBeenCalledWith(
        "claude",
        expect.arrayContaining(["--effort", effort]),
        expect.objectContaining({
          cwd: "/tmp/project",
          stdio: ["ignore", "pipe", "pipe"],
        }),
      );
    });

    it("converts Claude stream-json events into harness events", async () => {
      const mockProc = createMockChild();
      const spawnImpl = vi.fn().mockReturnValue(mockProc.child as any);
      const harness = new ClaudeCliHarness({
        model: makeModel({ thinkingLevel: "xhigh" }),
        spawnImpl: spawnImpl as any,
      });

      const iterator = harness.run("Inspect repo", { cwd: "/tmp/project" })[Symbol.asyncIterator]();
      const first = await iterator.next();
      expect(first.value).toEqual({
        type: "log",
        level: "info",
        message: "creating agent session",
        data: { model: makeModel({ thinkingLevel: "xhigh" }).model, thinking: "xhigh" },
      });

      const eventsPromise = collectEvents(iterator, first.value);

      mockProc.stdout.write('not-json\n');
      mockProc.stdout.write('{"type":"system","subtype":"api_error","error":{"error":{"error":{"message":"quota exceeded"}}}}\n');
      mockProc.stdout.write('{"type":"assistant","message":{"id":"msg-1","content":[{"type":"text","text":"hello"},{"type":"tool_use","id":"tool-1","name":"Bash","input":{"command":"pwd"}}],"role":"assistant","stop_reason":"tool_use"}}\n');
      mockProc.stdout.write('{"type":"assistant","message":{"id":"msg-1","content":[{"type":"text","text":"hello world"}],"role":"assistant","stop_reason":"end_turn"}}\n');
      mockProc.stdout.write('{"type":"assistant","uuid":"msg-2","content":[{"type":"text","text":"reset"}]}\n');
      mockProc.stdout.write('{"type":"user","content":[{"type":"tool_result","tool_use_id":"tool-1","content":"ok","is_error":true},{"type":"tool_result","tool_use_id":"tool-2","content":[{"type":"text","text":"done"}],"is_error":false}]}\n');
      mockProc.stdout.write('{"type":"result","usage":{"input_tokens":1,"output_tokens":2,"cache_read_input_tokens":3,"cache_creation_input_tokens":4}}\n');
      mockProc.stderr.write('\n');
      mockProc.stderr.write('warning from stderr\n');
      mockProc.stdout.end();
      mockProc.stderr.end();
      mockProc.close(null, "SIGTERM");

      const events = await eventsPromise;

      expect(events).toContainEqual({
        type: "log",
        level: "debug",
        message: "event",
        data: { raw: "not-json" },
      });
      expect(events).toContainEqual({
        type: "log",
        level: "error",
        message: "session error",
        data: { error: "quota exceeded" },
      });
      expect(events).toContainEqual({ type: "text_delta", delta: "hello" });
      expect(events).toContainEqual({
        type: "tool_start",
        toolName: "bash",
        toolCallId: "tool-1",
        command: "pwd",
      });
      expect(events).toContainEqual({ type: "text_delta", delta: " world" });
      expect(events).toContainEqual({ type: "text_delta", delta: "reset" });
      expect(events).toContainEqual({
        type: "log",
        level: "debug",
        message: "conversation.event",
        data: {
          eventType: "message_end",
          role: "assistant",
          stopReason: "end_turn",
          raw: {
            type: "assistant",
            message: {
              id: "msg-1",
              content: [{ type: "text", text: "hello world" }],
              role: "assistant",
              stop_reason: "end_turn",
            },
          },
        },
      });
      expect(events).toContainEqual({
        type: "tool_end",
        toolName: "tool",
        toolCallId: "tool-1",
        result: "ok",
        isError: true,
        raw: {
          type: "user",
          content: [
            { type: "tool_result", tool_use_id: "tool-1", content: "ok", is_error: true },
            { type: "tool_result", tool_use_id: "tool-2", content: [{ type: "text", text: "done" }], is_error: false },
          ],
        },
      });

      const objectResultEvent = events.find(
        (event) => event.type === "tool_end" && event.toolCallId === "tool-2",
      );
      expect(objectResultEvent).toMatchObject({
        type: "tool_end",
        toolName: "tool",
        toolCallId: "tool-2",
        isError: false,
      });
      expect(JSON.parse((objectResultEvent as any).result)).toEqual({
        content: [{ type: "text", text: "done" }],
        details: {},
      });

      expect(events).toContainEqual({
        type: "log",
        level: "warn",
        message: "claude stderr",
        data: { text: "warning from stderr" },
      });
      expect(events).toContainEqual({
        type: "usage",
        usage: {
          inputTokens: 1,
          outputTokens: 2,
          cacheReadTokens: 3,
          cacheWriteTokens: 4,
          totalTokens: 3,
          cost: 0,
          turnCount: 1,
        },
      });
      expect(events).toContainEqual({
        type: "log",
        level: "warn",
        message: "claude process terminated",
        data: { signal: "SIGTERM" },
      });
      expect(events).toContainEqual({ type: "exit", aborted: true, allModelsExhausted: false });
    });

    it("throws child process errors and dispose terminates the process", async () => {
      const mockProc = createMockChild();
      const spawnImpl = vi.fn().mockReturnValue(mockProc.child as any);
      const harness = new ClaudeCliHarness({
        model: makeModel(),
        spawnImpl: spawnImpl as any,
      });

      const iterator = harness.run("Inspect repo", { cwd: "/tmp/project" })[Symbol.asyncIterator]();
      const first = await iterator.next();
      expect(first.value).toMatchObject({ type: "log", message: "creating agent session" });

      const error = new Error("spawn failed");
      const nextPromise = iterator.next();
      await Promise.resolve();
      mockProc.fail(error);
      await expect(nextPromise).rejects.toThrow("spawn failed");

      harness.dispose();
      expect(mockProc.child.kill).toHaveBeenCalledWith("SIGTERM");
    });
  });
});
