import { PassThrough } from "stream";
import { describe, expect, it, vi } from "vitest";
import { ClaudeCliHarness } from "../../src/agents/harness/claude-cli-harness.js";
import { makeModel } from "../helpers.js";

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

    const eventsPromise = (async () => {
      const events = [first.value];
      while (true) {
        const next = await iterator.next();
        if (next.done) break;
        events.push(next.value);
      }
      return events;
    })();

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
          BASH_ENV: "/app/bin/al-bash-init.sh",
        }),
      }),
    );
    expect(events).toContainEqual(expect.objectContaining({ type: "usage" }));
    expect(events).toContainEqual({ type: "exit", aborted: false, allModelsExhausted: false });
  });
});
