import { describe, it, expect, vi, beforeEach } from "vitest";
import { tryRunOrEnqueue } from "../../../src/scheduler/policies/try-run-or-enqueue.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  } as any;
}

function makeRunner(id = "runner-01") {
  return { isRunning: false, instanceId: id, run: vi.fn() } as any;
}

function makePool(availableRunner: any | null = null, size = 1, runningJobCount = 0) {
  return {
    getAvailableRunner: vi.fn().mockReturnValue(availableRunner),
    size,
    runningJobCount,
  } as any;
}

function makeQueue<T>(options: { dropped?: any } = {}) {
  const enqueue = vi.fn().mockReturnValue({ accepted: true, dropped: options.dropped });
  return { enqueue, size: vi.fn().mockReturnValue(1) } as any;
}

describe("tryRunOrEnqueue", () => {
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
  });

  it("returns runner when pool has an available runner", () => {
    const runner = makeRunner();
    const pool = makePool(runner);
    const queue = makeQueue();

    const result = tryRunOrEnqueue(pool, queue, "agent-a", { type: "schedule" }, logger);

    expect(result.runner).toBe(runner);
    expect(result.enqueued).toBeUndefined();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it("enqueues work item when all runners are busy (null from getAvailableRunner)", () => {
    const pool = makePool(null, 2, 2);
    const enqueueResult = { accepted: true };
    const queue = { enqueue: vi.fn().mockReturnValue(enqueueResult), size: vi.fn().mockReturnValue(1) } as any;

    const result = tryRunOrEnqueue(pool, queue, "agent-a", { type: "schedule" }, logger);

    expect(result.runner).toBeUndefined();
    expect(result.enqueued).toBe(enqueueResult);
    expect(queue.enqueue).toHaveBeenCalledWith("agent-a", { type: "schedule" });
  });

  it("enqueues immediately when pool is undefined (agents still building)", () => {
    const enqueueResult = { accepted: true };
    const queue = { enqueue: vi.fn().mockReturnValue(enqueueResult), size: vi.fn().mockReturnValue(1) } as any;

    const result = tryRunOrEnqueue(undefined, queue, "agent-a", { type: "schedule" }, logger);

    expect(result.runner).toBeUndefined();
    expect(result.enqueued).toBe(enqueueResult);
    expect(queue.enqueue).toHaveBeenCalledWith("agent-a", { type: "schedule" });
  });

  it("logs info when work is queued because runners are busy", () => {
    const pool = makePool(null, 3, 3);
    const queue = makeQueue();

    tryRunOrEnqueue(pool, queue, "agent-a", { type: "schedule" }, logger);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "agent-a" }),
      expect.stringContaining("all runners busy"),
    );
  });

  it("logs warn when queue drops the oldest item (runners busy)", () => {
    const pool = makePool(null, 1, 1);
    const droppedItem = { context: { type: "schedule" }, receivedAt: new Date() };
    const queue = makeQueue({ dropped: droppedItem });

    tryRunOrEnqueue(pool, queue, "agent-a", { type: "schedule" }, logger);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "agent-a" }),
      expect.stringContaining("queue full"),
    );
  });

  it("logs warn when queue drops the oldest item (pool undefined)", () => {
    const droppedItem = { context: { type: "schedule" }, receivedAt: new Date() };
    const queue = makeQueue({ dropped: droppedItem });

    tryRunOrEnqueue(undefined, queue, "agent-a", { type: "schedule" }, logger);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "agent-a" }),
      expect.stringContaining("queue full"),
    );
  });

  it("does not log drop warning when nothing was dropped", () => {
    const pool = makePool(null, 1, 1);
    const queue = makeQueue(); // dropped is undefined

    tryRunOrEnqueue(pool, queue, "agent-a", { type: "schedule" }, logger);

    const warnCalls = logger.warn.mock.calls;
    expect(warnCalls).toHaveLength(0);
  });

  it("passes logContext fields into log messages", () => {
    const pool = makePool(null, 1, 1);
    const queue = makeQueue();

    tryRunOrEnqueue(
      pool, queue, "agent-a", { type: "webhook", context: {} as any }, logger,
      { event: "push" },
    );

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "agent-a", event: "push" }),
      expect.any(String),
    );
  });

  it("does not log info when returning runner (no enqueue happened)", () => {
    const runner = makeRunner();
    const pool = makePool(runner);
    const queue = makeQueue();

    tryRunOrEnqueue(pool, queue, "agent-a", { type: "schedule" }, logger);

    expect(logger.info).not.toHaveBeenCalled();
  });
});
