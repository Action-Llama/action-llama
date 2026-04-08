/**
 * Integration tests: tryRunOrEnqueue policy without Docker.
 *
 * scheduler/policies/try-run-or-enqueue.ts exports a single pure function
 * that manages the "acquire runner or fall back to queue" backpressure logic.
 * All tests use stub objects for RunnerPool, WorkQueue, and Logger — no Docker,
 * scheduler, or gateway is needed.
 *
 * Covers:
 *   - pool=undefined → immediate enqueue (building phase)
 *   - pool=undefined + queue full → enqueue with drop, warn logged
 *   - pool has available runner → returns runner (no enqueue)
 *   - pool all busy → enqueues with info log
 *   - pool all busy + queue full → enqueue with drop, warn logged
 *   - logContext is forwarded to logger
 */

import { describe, it, expect } from "vitest";

const { tryRunOrEnqueue } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/scheduler/policies/try-run-or-enqueue.js"
);

// ── Stubs ─────────────────────────────────────────────────────────────────────

function makeLogger() {
  const calls: Array<{ level: string; data: any; msg: string }> = [];
  return {
    calls,
    debug: (data: any, msg: string) => calls.push({ level: "debug", data, msg }),
    info:  (data: any, msg: string) => calls.push({ level: "info",  data, msg }),
    warn:  (data: any, msg: string) => calls.push({ level: "warn",  data, msg }),
    error: (data: any, msg: string) => calls.push({ level: "error", data, msg }),
  };
}

function makeQueue(opts: { enqueueResult?: any } = {}) {
  const items: any[] = [];
  return {
    items,
    enqueue: (_agentName: string, context: any) => {
      const result = opts.enqueueResult ?? { accepted: true, dropped: undefined };
      items.push(context);
      return result;
    },
    size: (_agentName: string) => items.length,
    dequeue: () => items.shift(),
    peek: () => [...items],
    clear: () => { items.length = 0; },
    clearAll: () => { items.length = 0; },
    close: () => {},
    setAgentMaxSize: () => {},
  };
}

function makePool(opts: { availableRunner?: any } = {}) {
  const fakeRunner = opts.availableRunner !== undefined ? opts.availableRunner : { id: "runner-1" };
  return {
    getAvailableRunner: () => fakeRunner,
    runningJobCount: 0,
    size: 1,
    hasRunningJobs: false,
    killAll: () => {},
  };
}

function makeBusyPool() {
  return {
    getAvailableRunner: () => undefined, // no runner available
    runningJobCount: 2,
    size: 2,
    hasRunningJobs: true,
    killAll: () => {},
  };
}

// ──────────────────────────────────────────────────────────────────────────────

describe("integration: tryRunOrEnqueue (no Docker required)", () => {
  it("when pool is undefined (building phase), enqueues immediately", () => {
    const queue = makeQueue();
    const logger = makeLogger();

    const result = tryRunOrEnqueue(undefined, queue, "my-agent", { work: 1 }, logger);

    expect(result.runner).toBeUndefined();
    expect(result.enqueued).toBeDefined();
    expect(queue.items).toHaveLength(1);
  });

  it("when pool is undefined and queue is full, warns about dropped item", () => {
    const droppedItem = { work: "old" };
    const queue = makeQueue({
      enqueueResult: { accepted: true, dropped: { context: droppedItem, receivedAt: new Date() } },
    });
    const logger = makeLogger();

    const result = tryRunOrEnqueue(undefined, queue, "my-agent", { work: "new" }, logger);

    const warnCalls = logger.calls.filter((c) => c.level === "warn");
    expect(warnCalls.length).toBeGreaterThan(0);
    expect(warnCalls.some((c) => c.msg.includes("dropped") || c.msg.includes("full"))).toBe(true);
  });

  it("when pool has an available runner, returns the runner without enqueueing", () => {
    const fakeRunner = { id: "runner-1" };
    const pool = makePool({ availableRunner: fakeRunner });
    const queue = makeQueue();
    const logger = makeLogger();

    const result = tryRunOrEnqueue(pool, queue, "my-agent", { work: 1 }, logger);

    expect(result.runner).toBe(fakeRunner);
    expect(result.enqueued).toBeUndefined();
    expect(queue.items).toHaveLength(0); // nothing enqueued
  });

  it("when all runners are busy, enqueues the work item", () => {
    const pool = makeBusyPool();
    const queue = makeQueue();
    const logger = makeLogger();

    const result = tryRunOrEnqueue(pool, queue, "my-agent", { work: 42 }, logger);

    expect(result.runner).toBeUndefined();
    expect(result.enqueued).toBeDefined();
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]).toEqual({ work: 42 });
  });

  it("when all runners are busy, logs an info message", () => {
    const pool = makeBusyPool();
    const queue = makeQueue();
    const logger = makeLogger();

    tryRunOrEnqueue(pool, queue, "my-agent", { work: 42 }, logger);

    const infoCalls = logger.calls.filter((c) => c.level === "info");
    expect(infoCalls.length).toBeGreaterThan(0);
    const hasQueueMsg = infoCalls.some((c) =>
      c.msg.includes("busy") || c.msg.includes("queued")
    );
    expect(hasQueueMsg).toBe(true);
  });

  it("when all runners are busy and queue is full, warns about dropped item", () => {
    const pool = makeBusyPool();
    const dropped = { context: { work: "old" }, receivedAt: new Date() };
    const queue = makeQueue({
      enqueueResult: { accepted: true, dropped },
    });
    const logger = makeLogger();

    tryRunOrEnqueue(pool, queue, "my-agent", { work: "new" }, logger);

    const warnCalls = logger.calls.filter((c) => c.level === "warn");
    expect(warnCalls.length).toBeGreaterThan(0);
  });

  it("logContext fields are included in log data", () => {
    const pool = makeBusyPool();
    const queue = makeQueue();
    const logger = makeLogger();
    const logContext = { requestId: "req-123", source: "webhook" };

    tryRunOrEnqueue(pool, queue, "my-agent", { work: 1 }, logger, logContext);

    const infoCalls = logger.calls.filter((c) => c.level === "info");
    const logDataWithContext = infoCalls.find((c) =>
      c.data?.requestId === "req-123" || c.data?.source === "webhook"
    );
    expect(logDataWithContext).toBeDefined();
  });

  it("logContext defaults to empty object when not provided", () => {
    const pool = makeBusyPool();
    const queue = makeQueue();
    const logger = makeLogger();

    // Should not throw when logContext is undefined
    expect(() =>
      tryRunOrEnqueue(pool, queue, "my-agent", { work: 1 }, logger)
    ).not.toThrow();
  });

  it("agent name is included in enqueue and log data", () => {
    const pool = makeBusyPool();
    const queue = makeQueue();
    const logger = makeLogger();

    tryRunOrEnqueue(pool, queue, "special-agent", { work: 1 }, logger);

    const infoCalls = logger.calls.filter((c) => c.level === "info");
    const hasAgentName = infoCalls.some((c) => c.data?.agent === "special-agent");
    expect(hasAgentName).toBe(true);
  });
});
