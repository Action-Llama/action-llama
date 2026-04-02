/**
 * Integration tests: shared/queue-sqlite.ts SqliteQueue — no Docker required.
 *
 * SqliteQueue is a SQLite-backed persistent queue implementing the Queue
 * interface. It supports two construction modes:
 *   1. dbPath string — creates its own DB connection (backward compat)
 *   2. AppDb instance — shares a connection (preferred)
 *
 * Multiple named queues can share the same SQLite database, differentiated
 * by the `name` column in the shared `queue` table.
 *
 * Functions tested:
 *   - constructor(dbPath, name) — creates own DB and applies migrations
 *   - enqueue(payload) — appends item, returns UUID
 *   - dequeue(limit?) — removes and returns up to N items FIFO (atomic transaction)
 *   - peek(limit?) — reads without removing
 *   - size() — returns count for this queue name
 *   - close() — closes DB connection when owner
 *   - multiple named queues on same DB path — size isolation
 *
 * Covers:
 *   - shared/queue-sqlite.ts: SqliteQueue constructor (string path)
 *   - shared/queue-sqlite.ts: SqliteQueue.enqueue — INSERT, returns UUID
 *   - shared/queue-sqlite.ts: SqliteQueue.dequeue — atomic transaction, FIFO
 *   - shared/queue-sqlite.ts: SqliteQueue.dequeue default limit=1
 *   - shared/queue-sqlite.ts: SqliteQueue.dequeue empty queue
 *   - shared/queue-sqlite.ts: SqliteQueue.peek — non-destructive, respects limit
 *   - shared/queue-sqlite.ts: SqliteQueue.size — scoped by queue name
 *   - shared/queue-sqlite.ts: SqliteQueue.close — closes owned connection
 *   - shared/queue-sqlite.ts: two queues sharing same DB path — isolation by name
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const { SqliteQueue } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/shared/queue-sqlite.js"
);

function makeTempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "al-sqlite-queue-test-"));
  return join(dir, "queue.db");
}

describe("integration: shared/queue-sqlite.ts SqliteQueue (no Docker required)", { timeout: 30_000 }, () => {

  it("enqueue returns a unique UUID for each item", async () => {
    const q = new SqliteQueue(makeTempDbPath(), "test-queue");
    try {
      const id1 = await q.enqueue("first");
      const id2 = await q.enqueue("second");
      expect(typeof id1).toBe("string");
      expect(id1.length).toBeGreaterThan(0);
      expect(id2).not.toBe(id1);
    } finally {
      await q.close();
    }
  });

  it("size returns the current queue length scoped by name", async () => {
    const q = new SqliteQueue(makeTempDbPath(), "size-queue");
    try {
      expect(await q.size()).toBe(0);
      await q.enqueue("a");
      expect(await q.size()).toBe(1);
      await q.enqueue("b");
      expect(await q.size()).toBe(2);
    } finally {
      await q.close();
    }
  });

  it("dequeue returns items in FIFO order", async () => {
    const q = new SqliteQueue(makeTempDbPath(), "fifo-queue");
    try {
      await q.enqueue("first");
      await q.enqueue("second");
      await q.enqueue("third");

      const items = await q.dequeue(2);
      expect(items).toHaveLength(2);
      expect(items[0].payload).toBe("first");
      expect(items[1].payload).toBe("second");
      // Third item remains
      expect(await q.size()).toBe(1);
    } finally {
      await q.close();
    }
  });

  it("dequeue returns empty array when queue is empty", async () => {
    const q = new SqliteQueue(makeTempDbPath(), "empty-queue");
    try {
      const items = await q.dequeue();
      expect(items).toHaveLength(0);
    } finally {
      await q.close();
    }
  });

  it("dequeue with default limit=1 removes only one item", async () => {
    const q = new SqliteQueue(makeTempDbPath(), "limit-queue");
    try {
      await q.enqueue("a");
      await q.enqueue("b");

      const items = await q.dequeue();
      expect(items).toHaveLength(1);
      expect(items[0].payload).toBe("a");
      expect(await q.size()).toBe(1);
    } finally {
      await q.close();
    }
  });

  it("dequeued items have correct structure (id, payload, enqueuedAt)", async () => {
    const q = new SqliteQueue(makeTempDbPath(), "struct-queue");
    try {
      const before = Date.now();
      await q.enqueue({ key: "value", num: 42 });
      const items = await q.dequeue();

      expect(items).toHaveLength(1);
      expect(typeof items[0].id).toBe("string");
      expect(items[0].payload).toEqual({ key: "value", num: 42 });
      expect(typeof items[0].enqueuedAt).toBe("number");
      expect(items[0].enqueuedAt).toBeGreaterThanOrEqual(before);
    } finally {
      await q.close();
    }
  });

  it("peek returns items without removing them", async () => {
    const q = new SqliteQueue(makeTempDbPath(), "peek-queue");
    try {
      await q.enqueue("peek-1");
      await q.enqueue("peek-2");

      const peeked = await q.peek(2);
      expect(peeked).toHaveLength(2);
      expect(peeked[0].payload).toBe("peek-1");

      // Items still in queue
      expect(await q.size()).toBe(2);
    } finally {
      await q.close();
    }
  });

  it("peek with default limit=1 returns only one item non-destructively", async () => {
    const q = new SqliteQueue(makeTempDbPath(), "peek-limit-queue");
    try {
      await q.enqueue("a");
      await q.enqueue("b");

      const peeked = await q.peek();
      expect(peeked).toHaveLength(1);
      expect(peeked[0].payload).toBe("a");
      // Both items still present
      expect(await q.size()).toBe(2);
    } finally {
      await q.close();
    }
  });

  it("two queues on the same DB path are isolated by name", async () => {
    const dbPath = makeTempDbPath();
    const q1 = new SqliteQueue(dbPath, "queue-alpha");
    const q2 = new SqliteQueue(dbPath, "queue-beta");
    try {
      await q1.enqueue("alpha-item");
      await q1.enqueue("alpha-item-2");
      await q2.enqueue("beta-item");

      // Sizes are independent
      expect(await q1.size()).toBe(2);
      expect(await q2.size()).toBe(1);

      // Dequeue from q2 only affects q2
      const betaItems = await q2.dequeue();
      expect(betaItems).toHaveLength(1);
      expect(betaItems[0].payload).toBe("beta-item");

      expect(await q1.size()).toBe(2); // q1 unaffected
      expect(await q2.size()).toBe(0);
    } finally {
      await q1.close();
      await q2.close();
    }
  });

  it("dequeue is atomic: all-or-nothing within the limit", async () => {
    const q = new SqliteQueue(makeTempDbPath(), "atomic-queue");
    try {
      for (let i = 0; i < 5; i++) {
        await q.enqueue(`item-${i}`);
      }

      // Dequeue 3 at once
      const batch = await q.dequeue(3);
      expect(batch).toHaveLength(3);
      expect(batch[0].payload).toBe("item-0");
      expect(batch[1].payload).toBe("item-1");
      expect(batch[2].payload).toBe("item-2");

      // Remaining: 2 items
      expect(await q.size()).toBe(2);

      // Dequeue remaining
      const rest = await q.dequeue(10);
      expect(rest).toHaveLength(2);
      expect(rest[0].payload).toBe("item-3");
      expect(rest[1].payload).toBe("item-4");

      expect(await q.size()).toBe(0);
    } finally {
      await q.close();
    }
  });

  it("close() releases the database connection (ownDb=true path)", async () => {
    const dbPath = makeTempDbPath();
    const q = new SqliteQueue(dbPath, "close-queue");
    await q.enqueue("item");
    expect(await q.size()).toBe(1);

    // close() should not throw when ownDb=true
    await expect(q.close()).resolves.toBeUndefined();

    // After close, a new queue instance on the same path still works
    const q2 = new SqliteQueue(dbPath, "close-queue");
    try {
      expect(await q2.size()).toBe(1); // persisted item survives close
      const items = await q2.dequeue();
      expect(items[0].payload).toBe("item");
    } finally {
      await q2.close();
    }
  });

  it("enqueue then dequeue roundtrip with object payload", async () => {
    const q = new SqliteQueue(makeTempDbPath(), "roundtrip-queue");
    try {
      const payload = {
        agentName: "my-agent",
        triggerType: "webhook",
        context: { event: "push", branch: "main" },
      };
      await q.enqueue(payload);
      const items = await q.dequeue();
      expect(items).toHaveLength(1);
      expect(items[0].payload).toEqual(payload);
    } finally {
      await q.close();
    }
  });
});
