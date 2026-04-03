/**
 * Integration tests: execution/dispatch-policy.ts — no Docker required.
 *
 * dispatchOrQueue() is a pure decision function that centralises the
 * "check paused → check pool → check runner → queue or execute" logic.
 * It was introduced to consolidate duplicated dispatch code across multiple
 * call sites (scheduler/watcher.ts, execution/execution.ts, etc.).
 *
 * The function has 7 distinct code paths based on:
 *   1. isPaused() → rejected ("scheduler is paused")
 *   2. isAgentEnabled() returns false → queued (cause: "agent-disabled")
 *   3. pool undefined + queueWhenBusy=true → queued (cause: "pool-unavailable")
 *   4. pool undefined + queueWhenBusy=false → rejected ("runner pool not available")
 *   5. pool.size === 0 → rejected ("agent is disabled (scale=0)")
 *   6. runner available → dispatched
 *   7. all runners busy + queueWhenBusy=true → queued (cause: "all-busy")
 *   8. all runners busy + queueWhenBusy=false → rejected ("no available runners")
 *
 * None of these paths require Docker, a real RunnerPool, or a real WorkQueue.
 * We use minimal in-memory mock objects that satisfy the interfaces.
 *
 * Covers:
 *   - execution/dispatch-policy.ts: all 7 branches of dispatchOrQueue()
 *   - isPaused guard (line 55-57)
 *   - isAgentEnabled guard (line 60-63)
 *   - pool undefined + queueWhenBusy=true (line 66-69)
 *   - pool undefined + queueWhenBusy=false (line 70-71)
 *   - pool.size === 0 rejection (line 74-76)
 *   - runner available dispatch (line 79-81)
 *   - all-busy + queueWhenBusy=true (line 84-86)
 *   - all-busy + queueWhenBusy=false (line 88-90)
 */

import { describe, it, expect } from "vitest";

const { dispatchOrQueue } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/execution/dispatch-policy.js"
);

/**
 * Minimal WorkQueue mock — tracks enqueued items and optional drop simulation.
 */
function makeWorkQueue(opts: { dropped?: boolean } = {}) {
  const items: unknown[] = [];
  return {
    items,
    enqueue(_agent: string, item: unknown): { dropped: boolean; id?: string } {
      items.push(item);
      return { dropped: !!opts.dropped, id: "fake-id" };
    },
    dequeue() { return undefined; },
    peek() { return []; },
    size() { return items.length; },
    close() {},
  };
}

/**
 * Minimal RunnerPool mock.
 */
function makePool(opts: { size?: number; hasAvailableRunner?: boolean } = {}) {
  const fakeRunner = { id: "fake-runner", busy: false };
  return {
    size: opts.size ?? 1,
    getAvailableRunner() {
      return opts.hasAvailableRunner !== false ? fakeRunner : null;
    },
  };
}

describe("integration: dispatchOrQueue (no Docker required)", () => {

  // ── isPaused guard ─────────────────────────────────────────────────────────

  it("returns rejected when isPaused() returns true", () => {
    const queue = makeWorkQueue();
    const result = dispatchOrQueue(
      "my-agent",
      { type: "manual" },
      {
        pool: makePool(),
        workQueue: queue,
        isPaused: () => true,
      },
    );
    expect(result.action).toBe("rejected");
    expect(result.reason).toContain("paused");
    // Nothing should be enqueued
    expect(queue.items.length).toBe(0);
  });

  // ── isAgentEnabled guard ───────────────────────────────────────────────────

  it("returns queued with cause='agent-disabled' when isAgentEnabled returns false", () => {
    const queue = makeWorkQueue();
    const result = dispatchOrQueue(
      "disabled-agent",
      { type: "webhook" },
      {
        pool: makePool(),
        workQueue: queue,
        isAgentEnabled: (_name: string) => false,
      },
    );
    expect(result.action).toBe("queued");
    expect(result.cause).toBe("agent-disabled");
    expect(queue.items.length).toBe(1);
  });

  it("proceeds past isAgentEnabled when it returns true", () => {
    const queue = makeWorkQueue();
    const result = dispatchOrQueue(
      "enabled-agent",
      { type: "manual" },
      {
        pool: makePool({ hasAvailableRunner: true }),
        workQueue: queue,
        isAgentEnabled: (_name: string) => true,
      },
    );
    expect(result.action).toBe("dispatched");
    expect(queue.items.length).toBe(0);
  });

  // ── pool undefined paths ───────────────────────────────────────────────────

  it("returns queued with cause='pool-unavailable' when pool is undefined and queueWhenBusy=true", () => {
    const queue = makeWorkQueue();
    const result = dispatchOrQueue(
      "my-agent",
      { type: "schedule" },
      {
        pool: undefined,
        workQueue: queue,
      },
      { queueWhenBusy: true },
    );
    expect(result.action).toBe("queued");
    expect(result.cause).toBe("pool-unavailable");
    expect(queue.items.length).toBe(1);
  });

  it("returns rejected when pool is null and queueWhenBusy=false", () => {
    const queue = makeWorkQueue();
    const result = dispatchOrQueue(
      "my-agent",
      { type: "manual" },
      {
        pool: null,
        workQueue: queue,
      },
      { queueWhenBusy: false },
    );
    expect(result.action).toBe("rejected");
    expect(result.reason).toContain("runner pool not available");
    expect(queue.items.length).toBe(0);
  });

  // ── pool.size === 0 (scale=0) ─────────────────────────────────────────────

  it("returns rejected with scale=0 message when pool.size === 0", () => {
    const queue = makeWorkQueue();
    const result = dispatchOrQueue(
      "scaled-to-zero",
      { type: "manual" },
      {
        pool: makePool({ size: 0 }),
        workQueue: queue,
      },
    );
    expect(result.action).toBe("rejected");
    expect(result.reason).toContain("scale=0");
    expect(queue.items.length).toBe(0);
  });

  // ── runner available (happy path) ─────────────────────────────────────────

  it("returns dispatched with runner when a runner is available", () => {
    const queue = makeWorkQueue();
    const result = dispatchOrQueue(
      "my-agent",
      { type: "manual" },
      {
        pool: makePool({ size: 2, hasAvailableRunner: true }),
        workQueue: queue,
      },
    );
    expect(result.action).toBe("dispatched");
    expect(result.runner).toBeDefined();
    expect(result.runner.id).toBe("fake-runner");
    expect(queue.items.length).toBe(0);
  });

  // ── all runners busy ──────────────────────────────────────────────────────

  it("returns queued with cause='all-busy' when runners are busy and queueWhenBusy=true", () => {
    const queue = makeWorkQueue();
    const result = dispatchOrQueue(
      "busy-agent",
      { type: "webhook" },
      {
        pool: makePool({ size: 1, hasAvailableRunner: false }),
        workQueue: queue,
      },
      { queueWhenBusy: true },
    );
    expect(result.action).toBe("queued");
    expect(result.cause).toBe("all-busy");
    expect(queue.items.length).toBe(1);
  });

  it("returns rejected when runners are busy and queueWhenBusy=false", () => {
    const queue = makeWorkQueue();
    const result = dispatchOrQueue(
      "busy-agent",
      { type: "manual" },
      {
        pool: makePool({ size: 1, hasAvailableRunner: false }),
        workQueue: queue,
      },
      { queueWhenBusy: false },
    );
    expect(result.action).toBe("rejected");
    expect(result.reason).toContain("no available runners");
    expect(queue.items.length).toBe(0);
  });

  // ── dropped work items ─────────────────────────────────────────────────────

  it("propagates dropped=true from workQueue.enqueue() in queued result", () => {
    // When queue is full, enqueue returns dropped=true
    const queue = makeWorkQueue({ dropped: true });
    const result = dispatchOrQueue(
      "busy-agent",
      { type: "webhook" },
      {
        pool: makePool({ size: 1, hasAvailableRunner: false }),
        workQueue: queue,
      },
      { queueWhenBusy: true },
    );
    expect(result.action).toBe("queued");
    expect(result.dropped).toBe(true);
  });

  it("propagates dropped=false from workQueue.enqueue() in queued result", () => {
    const queue = makeWorkQueue({ dropped: false });
    const result = dispatchOrQueue(
      "busy-agent",
      { type: "webhook" },
      {
        pool: undefined,
        workQueue: queue,
      },
      { queueWhenBusy: true },
    );
    expect(result.action).toBe("queued");
    expect(result.dropped).toBe(false);
  });

  // ── default opts (queueWhenBusy=true) ─────────────────────────────────────

  it("defaults queueWhenBusy to true when opts not provided", () => {
    const queue = makeWorkQueue();
    const result = dispatchOrQueue(
      "my-agent",
      { type: "schedule" },
      {
        pool: undefined,
        workQueue: queue,
      },
      // No opts — should default to queueWhenBusy=true
    );
    expect(result.action).toBe("queued");
    expect(result.cause).toBe("pool-unavailable");
  });

  // ── priority order: isPaused before isAgentEnabled ─────────────────────────

  it("isPaused takes priority over isAgentEnabled", () => {
    const queue = makeWorkQueue();
    const result = dispatchOrQueue(
      "my-agent",
      { type: "manual" },
      {
        pool: makePool(),
        workQueue: queue,
        isPaused: () => true,
        isAgentEnabled: (_name: string) => false, // would queue if isPaused didn't fire first
      },
    );
    // isPaused wins → rejected, nothing enqueued
    expect(result.action).toBe("rejected");
    expect(queue.items.length).toBe(0);
  });
});
