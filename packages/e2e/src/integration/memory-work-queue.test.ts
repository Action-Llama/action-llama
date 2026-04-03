/**
 * Integration tests: MemoryWorkQueue without Docker.
 *
 * Tests the in-memory work queue implementation (events/event-queue.ts
 * MemoryWorkQueue class) in isolation. All operations are pure in-process
 * with no network, Docker, or scheduler dependencies.
 *
 * Covers:
 *   - enqueue: basic, returns accepted:true, receivedAt preserved
 *   - enqueue overflow: drops oldest when at maxSize, returns dropped item
 *   - dequeue: FIFO order, returns undefined on empty queue
 *   - peek: non-destructive, respects limit
 *   - size: accurate before/after enqueue/dequeue
 *   - clear: clears named queue only
 *   - clearAll: clears all queues
 *   - close: frees all queues
 *   - setAgentMaxSize: per-agent cap overrides global maxSize
 *   - createWorkQueue memory variant: returns a MemoryWorkQueue
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const {
  MemoryWorkQueue,
  createWorkQueue,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/events/event-queue.js"
);

describe("integration: MemoryWorkQueue (no Docker required)", () => {
  it("enqueue returns accepted:true", () => {
    const q = new MemoryWorkQueue(10);
    const result = q.enqueue("agent-a", { value: 1 });
    expect(result.accepted).toBe(true);
    expect(result.dropped).toBeUndefined();
  });

  it("enqueue/dequeue is FIFO", () => {
    const q = new MemoryWorkQueue(10);
    q.enqueue("agent-a", { value: 1 });
    q.enqueue("agent-a", { value: 2 });
    q.enqueue("agent-a", { value: 3 });

    const first = q.dequeue("agent-a");
    const second = q.dequeue("agent-a");
    const third = q.dequeue("agent-a");

    expect(first?.context).toEqual({ value: 1 });
    expect(second?.context).toEqual({ value: 2 });
    expect(third?.context).toEqual({ value: 3 });
  });

  it("dequeue returns undefined when queue is empty", () => {
    const q = new MemoryWorkQueue(10);
    expect(q.dequeue("nonexistent")).toBeUndefined();
  });

  it("size reflects the number of enqueued items", () => {
    const q = new MemoryWorkQueue(10);
    expect(q.size("agent-a")).toBe(0);
    q.enqueue("agent-a", { value: 1 });
    q.enqueue("agent-a", { value: 2 });
    expect(q.size("agent-a")).toBe(2);
    q.dequeue("agent-a");
    expect(q.size("agent-a")).toBe(1);
  });

  it("peek returns items without removing them", () => {
    const q = new MemoryWorkQueue(10);
    q.enqueue("agent-a", { value: 1 });
    q.enqueue("agent-a", { value: 2 });

    const peeked = q.peek("agent-a");
    expect(peeked).toHaveLength(2);
    // Items still in queue
    expect(q.size("agent-a")).toBe(2);
  });

  it("peek respects limit parameter", () => {
    const q = new MemoryWorkQueue(10);
    for (let i = 0; i < 5; i++) q.enqueue("agent-a", { value: i });

    const peeked = q.peek("agent-a", 3);
    expect(peeked).toHaveLength(3);
    expect(peeked[0].context).toEqual({ value: 0 });
    expect(peeked[2].context).toEqual({ value: 2 });
    // Queue unchanged
    expect(q.size("agent-a")).toBe(5);
  });

  it("peek returns empty array for nonexistent queue", () => {
    const q = new MemoryWorkQueue(10);
    expect(q.peek("nonexistent")).toEqual([]);
  });

  it("overflow: drops oldest item when at global maxSize", () => {
    const q = new MemoryWorkQueue(2);
    q.enqueue("agent-a", { value: 1 });
    q.enqueue("agent-a", { value: 2 });

    // Third enqueue should drop the oldest (value: 1)
    const result = q.enqueue("agent-a", { value: 3 });
    expect(result.accepted).toBe(true);
    expect(result.dropped).toBeDefined();
    expect((result.dropped!.context as any).value).toBe(1);

    // Queue should have [2, 3]
    expect(q.size("agent-a")).toBe(2);
    const first = q.dequeue("agent-a");
    expect((first!.context as any).value).toBe(2);
  });

  it("preserves receivedAt when explicitly provided", () => {
    const q = new MemoryWorkQueue(10);
    const date = new Date("2024-01-01T00:00:00Z");
    q.enqueue("agent-a", { value: 1 }, date);
    const item = q.dequeue("agent-a");
    expect(item!.receivedAt).toEqual(date);
  });

  it("enqueue sets receivedAt automatically when not provided", () => {
    const before = new Date();
    const q = new MemoryWorkQueue(10);
    q.enqueue("agent-a", { value: 1 });
    const after = new Date();
    const item = q.dequeue("agent-a");
    expect(item!.receivedAt >= before).toBe(true);
    expect(item!.receivedAt <= after).toBe(true);
  });

  it("clear removes only the named queue", () => {
    const q = new MemoryWorkQueue(10);
    q.enqueue("agent-a", { value: 1 });
    q.enqueue("agent-b", { value: 2 });

    q.clear("agent-a");

    expect(q.size("agent-a")).toBe(0);
    expect(q.size("agent-b")).toBe(1);
  });

  it("clearAll removes all queues", () => {
    const q = new MemoryWorkQueue(10);
    q.enqueue("agent-a", { value: 1 });
    q.enqueue("agent-b", { value: 2 });

    q.clearAll();

    expect(q.size("agent-a")).toBe(0);
    expect(q.size("agent-b")).toBe(0);
  });

  it("close frees all queues (size returns 0 afterwards)", () => {
    const q = new MemoryWorkQueue(10);
    q.enqueue("agent-a", { value: 1 });
    q.enqueue("agent-b", { value: 2 });

    q.close();

    expect(q.size("agent-a")).toBe(0);
    expect(q.size("agent-b")).toBe(0);
  });

  it("setAgentMaxSize: per-agent cap overrides global maxSize", () => {
    const q = new MemoryWorkQueue(100); // Global max = 100
    q.setAgentMaxSize("small-agent", 2);

    q.enqueue("small-agent", { value: 1 });
    q.enqueue("small-agent", { value: 2 });

    // Third should drop first due to per-agent cap of 2
    const result = q.enqueue("small-agent", { value: 3 });
    expect(result.dropped).toBeDefined();
    expect((result.dropped!.context as any).value).toBe(1);
    expect(q.size("small-agent")).toBe(2);
  });

  it("setAgentMaxSize does not affect other agents", () => {
    const q = new MemoryWorkQueue(100);
    q.setAgentMaxSize("small-agent", 1);

    // Other agents still use global max
    for (let i = 0; i < 10; i++) q.enqueue("large-agent", { value: i });
    expect(q.size("large-agent")).toBe(10);
  });

  it("multiple agents have independent queues", () => {
    const q = new MemoryWorkQueue(10);
    q.enqueue("agent-a", { value: "a" });
    q.enqueue("agent-b", { value: "b" });

    expect(q.dequeue("agent-a")?.context).toEqual({ value: "a" });
    expect(q.dequeue("agent-b")?.context).toEqual({ value: "b" });
    expect(q.dequeue("agent-a")).toBeUndefined();
  });

  it("createWorkQueue memory: returns a functional MemoryWorkQueue", async () => {
    const q = await createWorkQueue(5, { type: "memory" });
    q.enqueue("agent-x", { foo: "bar" });
    expect(q.size("agent-x")).toBe(1);
    const item = q.dequeue("agent-x");
    expect(item?.context).toEqual({ foo: "bar" });
    q.close?.();
  });
});
