/**
 * Integration tests: shared/queue-memory.ts MemoryQueue — no Docker required.
 *
 * MemoryQueue is a pure in-memory implementation of the Queue interface.
 * It's used in tests and single-process local mode where durability is not needed.
 *
 * Functions tested:
 *   - enqueue(payload) — appends item, returns ID
 *   - dequeue(limit?) — removes and returns up to N items (FIFO)
 *   - peek(limit?) — reads without removing
 *   - size() — returns current queue length
 *   - close() — empties the queue
 *
 * Covers:
 *   - shared/queue-memory.ts: MemoryQueue.enqueue — returns UUID, appends to tail
 *   - shared/queue-memory.ts: MemoryQueue.dequeue — FIFO order, respects limit
 *   - shared/queue-memory.ts: MemoryQueue.peek — non-destructive, respects limit
 *   - shared/queue-memory.ts: MemoryQueue.size — accurate count
 *   - shared/queue-memory.ts: MemoryQueue.close — empties queue
 */

import { describe, it, expect } from "vitest";

const { MemoryQueue } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/shared/queue-memory.js"
);

describe("integration: shared/queue-memory.ts MemoryQueue (no Docker required)", () => {

  it("enqueue returns a unique ID for each item", async () => {
    const q = new MemoryQueue();
    const id1 = await q.enqueue("first");
    const id2 = await q.enqueue("second");
    expect(typeof id1).toBe("string");
    expect(typeof id2).toBe("string");
    expect(id1).not.toBe(id2);
  });

  it("size returns the current queue length", async () => {
    const q = new MemoryQueue();
    expect(await q.size()).toBe(0);
    await q.enqueue("a");
    expect(await q.size()).toBe(1);
    await q.enqueue("b");
    expect(await q.size()).toBe(2);
  });

  it("dequeue returns items in FIFO order", async () => {
    const q = new MemoryQueue();
    await q.enqueue("first");
    await q.enqueue("second");
    await q.enqueue("third");

    const items = await q.dequeue(2);
    expect(items).toHaveLength(2);
    expect(items[0].payload).toBe("first");
    expect(items[1].payload).toBe("second");
    // Third item remains
    expect(await q.size()).toBe(1);
  });

  it("dequeue returns empty array when queue is empty", async () => {
    const q = new MemoryQueue();
    const items = await q.dequeue();
    expect(items).toHaveLength(0);
  });

  it("dequeue with default limit=1 removes only one item", async () => {
    const q = new MemoryQueue();
    await q.enqueue("a");
    await q.enqueue("b");

    const items = await q.dequeue();
    expect(items).toHaveLength(1);
    expect(items[0].payload).toBe("a");
    expect(await q.size()).toBe(1);
  });

  it("dequeued items have correct structure (id, payload, enqueuedAt)", async () => {
    const q = new MemoryQueue();
    await q.enqueue({ key: "value" });
    const items = await q.dequeue();
    expect(items).toHaveLength(1);
    expect(typeof items[0].id).toBe("string");
    expect(items[0].payload).toEqual({ key: "value" });
    expect(typeof items[0].enqueuedAt).toBe("number");
    expect(items[0].enqueuedAt).toBeGreaterThan(0);
  });

  it("peek returns items without removing them", async () => {
    const q = new MemoryQueue();
    await q.enqueue("peek-test-1");
    await q.enqueue("peek-test-2");

    const peeked = await q.peek(2);
    expect(peeked).toHaveLength(2);
    expect(peeked[0].payload).toBe("peek-test-1");

    // Items still in queue
    expect(await q.size()).toBe(2);
  });

  it("peek with default limit=1 returns only one item", async () => {
    const q = new MemoryQueue();
    await q.enqueue("a");
    await q.enqueue("b");

    const peeked = await q.peek();
    expect(peeked).toHaveLength(1);
    expect(peeked[0].payload).toBe("a");
    expect(await q.size()).toBe(2); // still 2 items
  });

  it("close empties the queue", async () => {
    const q = new MemoryQueue();
    await q.enqueue("a");
    await q.enqueue("b");

    await q.close();
    expect(await q.size()).toBe(0);
  });
});
