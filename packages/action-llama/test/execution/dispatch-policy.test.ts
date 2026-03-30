import { describe, it, expect, vi } from "vitest";
import { dispatchOrQueue } from "../../src/execution/dispatch-policy.js";
import { RunnerPool } from "../../src/execution/runner-pool.js";
import { MemoryWorkQueue } from "../../src/events/event-queue.js";
import type { PoolRunner } from "../../src/execution/runner-pool.js";

type TestItem = { id: string };

function makeRunner(overrides: Partial<PoolRunner> = {}): PoolRunner {
  return {
    instanceId: overrides.instanceId ?? "test-runner",
    isRunning: overrides.isRunning ?? false,
    run: overrides.run ?? vi.fn().mockResolvedValue({ result: "completed", triggers: [] }),
  };
}

function makePool(availableRunner?: PoolRunner, size = 1): RunnerPool {
  return {
    size,
    runningJobCount: availableRunner ? 0 : 1,
    getAvailableRunner: vi.fn().mockReturnValue(availableRunner ?? null),
    getAllAvailableRunners: vi.fn().mockReturnValue(availableRunner ? [availableRunner] : []),
    killInstance: vi.fn(),
    killAll: vi.fn(),
  } as unknown as RunnerPool;
}

describe("dispatchOrQueue", () => {
  it("dispatches when a runner is available", () => {
    const runner = makeRunner();
    const pool = makePool(runner);
    const workQueue = new MemoryWorkQueue<TestItem>(10);

    const result = dispatchOrQueue("agent-a", { id: "1" }, { pool, workQueue });

    expect(result.action).toBe("dispatched");
    if (result.action === "dispatched") {
      expect(result.runner).toBe(runner);
    }
    expect(workQueue.size("agent-a")).toBe(0);
  });

  it("queues when all runners are busy and queueWhenBusy is true (default)", () => {
    const pool = makePool(undefined); // no available runner
    const workQueue = new MemoryWorkQueue<TestItem>(10);

    const result = dispatchOrQueue("agent-a", { id: "1" }, { pool, workQueue });

    expect(result.action).toBe("queued");
    if (result.action === "queued") {
      expect(result.dropped).toBe(false);
      expect(result.cause).toBe("all-busy");
    }
    expect(workQueue.size("agent-a")).toBe(1);
  });

  it("rejects when all runners are busy and queueWhenBusy is false", () => {
    const pool = makePool(undefined); // no available runner
    const workQueue = new MemoryWorkQueue<TestItem>(10);

    const result = dispatchOrQueue("agent-a", { id: "1" }, { pool, workQueue }, { queueWhenBusy: false });

    expect(result.action).toBe("rejected");
    if (result.action === "rejected") {
      expect(result.reason).toBe("no available runners (all busy)");
    }
    expect(workQueue.size("agent-a")).toBe(0);
  });

  it("rejects when isPaused returns true", () => {
    const runner = makeRunner();
    const pool = makePool(runner);
    const workQueue = new MemoryWorkQueue<TestItem>(10);
    const isPaused = vi.fn().mockReturnValue(true);

    const result = dispatchOrQueue("agent-a", { id: "1" }, { pool, workQueue, isPaused });

    expect(result.action).toBe("rejected");
    if (result.action === "rejected") {
      expect(result.reason).toBe("scheduler is paused");
    }
    expect(workQueue.size("agent-a")).toBe(0);
  });

  it("does not reject when isPaused returns false", () => {
    const runner = makeRunner();
    const pool = makePool(runner);
    const workQueue = new MemoryWorkQueue<TestItem>(10);
    const isPaused = vi.fn().mockReturnValue(false);

    const result = dispatchOrQueue("agent-a", { id: "1" }, { pool, workQueue, isPaused });

    expect(result.action).toBe("dispatched");
  });

  it("queues when isAgentEnabled returns false", () => {
    const runner = makeRunner();
    const pool = makePool(runner);
    const workQueue = new MemoryWorkQueue<TestItem>(10);
    const isAgentEnabled = vi.fn().mockReturnValue(false);

    const result = dispatchOrQueue("agent-a", { id: "1" }, { pool, workQueue, isAgentEnabled });

    expect(result.action).toBe("queued");
    if (result.action === "queued") {
      expect(result.dropped).toBe(false);
      expect(result.cause).toBe("agent-disabled");
    }
    expect(workQueue.size("agent-a")).toBe(1);
  });

  it("dispatches when isAgentEnabled returns true", () => {
    const runner = makeRunner();
    const pool = makePool(runner);
    const workQueue = new MemoryWorkQueue<TestItem>(10);
    const isAgentEnabled = vi.fn().mockReturnValue(true);

    const result = dispatchOrQueue("agent-a", { id: "1" }, { pool, workQueue, isAgentEnabled });

    expect(result.action).toBe("dispatched");
  });

  it("queues when pool is null and queueWhenBusy is true", () => {
    const workQueue = new MemoryWorkQueue<TestItem>(10);

    const result = dispatchOrQueue("agent-a", { id: "1" }, { pool: null, workQueue });

    expect(result.action).toBe("queued");
    if (result.action === "queued") {
      expect(result.cause).toBe("pool-unavailable");
    }
    expect(workQueue.size("agent-a")).toBe(1);
  });

  it("rejects when pool is null and queueWhenBusy is false", () => {
    const workQueue = new MemoryWorkQueue<TestItem>(10);

    const result = dispatchOrQueue("agent-a", { id: "1" }, { pool: null, workQueue }, { queueWhenBusy: false });

    expect(result.action).toBe("rejected");
    if (result.action === "rejected") {
      expect(result.reason).toBe("runner pool not available");
    }
    expect(workQueue.size("agent-a")).toBe(0);
  });

  it("queues when pool is undefined and queueWhenBusy is true", () => {
    const workQueue = new MemoryWorkQueue<TestItem>(10);

    const result = dispatchOrQueue("agent-a", { id: "1" }, { pool: undefined, workQueue });

    expect(result.action).toBe("queued");
    if (result.action === "queued") {
      expect(result.cause).toBe("pool-unavailable");
    }
    expect(workQueue.size("agent-a")).toBe(1);
  });

  it("rejects when pool.size is 0 (scale=0 / disabled)", () => {
    const pool = makePool(undefined, 0);
    const workQueue = new MemoryWorkQueue<TestItem>(10);

    const result = dispatchOrQueue("agent-a", { id: "1" }, { pool, workQueue });

    expect(result.action).toBe("rejected");
    if (result.action === "rejected") {
      expect(result.reason).toBe("agent is disabled (scale=0)");
    }
    expect(workQueue.size("agent-a")).toBe(0);
  });

  it("returns dropped=true when queue is full", () => {
    const pool = makePool(undefined); // no available runner
    // Queue with capacity 1 — fill it first
    const workQueue = new MemoryWorkQueue<TestItem>(1);
    workQueue.enqueue("agent-a", { id: "existing" });

    const result = dispatchOrQueue("agent-a", { id: "new" }, { pool, workQueue });

    expect(result.action).toBe("queued");
    if (result.action === "queued") {
      expect(result.dropped).toBe(true);
      expect(result.cause).toBe("all-busy");
    }
  });

  it("defaults queueWhenBusy to true", () => {
    const pool = makePool(undefined); // no available runner
    const workQueue = new MemoryWorkQueue<TestItem>(10);

    // No opts passed — should queue by default
    const result = dispatchOrQueue("agent-a", { id: "1" }, { pool, workQueue });

    expect(result.action).toBe("queued");
    expect(workQueue.size("agent-a")).toBe(1);
  });

  it("isPaused check takes priority over isAgentEnabled", () => {
    const runner = makeRunner();
    const pool = makePool(runner);
    const workQueue = new MemoryWorkQueue<TestItem>(10);
    const isPaused = vi.fn().mockReturnValue(true);
    const isAgentEnabled = vi.fn().mockReturnValue(false);

    const result = dispatchOrQueue("agent-a", { id: "1" }, { pool, workQueue, isPaused, isAgentEnabled });

    expect(result.action).toBe("rejected");
    if (result.action === "rejected") {
      expect(result.reason).toBe("scheduler is paused");
    }
    // isAgentEnabled should not even be called since isPaused short-circuits
    expect(isAgentEnabled).not.toHaveBeenCalled();
  });
});
