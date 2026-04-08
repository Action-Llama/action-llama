/**
 * Integration tests: events/event-queue-sqlite.ts SqliteWorkQueue — no Docker required.
 *
 * SqliteWorkQueue is a SQLite-backed work queue implementing the WorkQueue
 * interface. It supports two construction modes:
 *   1. maxSize + dbPath string — creates its own DB connection (backward compat)
 *   2. maxSize + AppDb instance — shares a connection (preferred)
 *
 * Compared to the in-memory MemoryWorkQueue, SqliteWorkQueue is durable:
 * items survive process restarts. Dequeue is atomic (SELECT + DELETE in one
 * SQLite transaction) and returns a single item or undefined.
 *
 * Covers:
 *   - events/event-queue-sqlite.ts: SqliteWorkQueue constructor (string path)
 *   - events/event-queue-sqlite.ts: SqliteWorkQueue.enqueue — persists item, accepted:true
 *   - events/event-queue-sqlite.ts: SqliteWorkQueue.enqueue — overflow drops oldest item
 *   - events/event-queue-sqlite.ts: SqliteWorkQueue.dequeue — returns single item, FIFO
 *   - events/event-queue-sqlite.ts: SqliteWorkQueue.dequeue — returns undefined when empty
 *   - events/event-queue-sqlite.ts: SqliteWorkQueue.peek — non-destructive, respects limit
 *   - events/event-queue-sqlite.ts: SqliteWorkQueue.size — scoped by agent name
 *   - events/event-queue-sqlite.ts: SqliteWorkQueue.clear — clears only named agent queue
 *   - events/event-queue-sqlite.ts: SqliteWorkQueue.clearAll — clears all agent queues
 *   - events/event-queue-sqlite.ts: SqliteWorkQueue.close — releases owned DB connection
 *   - events/event-queue-sqlite.ts: SqliteWorkQueue.setAgentMaxSize — per-agent cap
 *   - events/event-queue-sqlite.ts: SqliteWorkQueue constructor (shared AppDb)
 *   - events/event-queue-sqlite.ts: data persists across close/reopen
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const { SqliteWorkQueue } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/events/event-queue-sqlite.js"
);

const { createDb } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/db/connection.js"
);

const { applyMigrations } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/db/migrate.js"
);

function makeTempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "al-sqlite-work-queue-test-"));
  return join(dir, "work-queue.db");
}

describe("integration: events/event-queue-sqlite.ts SqliteWorkQueue (no Docker required)", { timeout: 30_000 }, () => {

  it("constructor(string) — creates own DB and enqueue works", () => {
    const q = new SqliteWorkQueue(10, makeTempDbPath());
    try {
      const result = q.enqueue("agent-a", { value: 1 });
      expect(result.accepted).toBe(true);
      expect(result.dropped).toBeUndefined();
      expect(q.size("agent-a")).toBe(1);
    } finally {
      q.close();
    }
  });

  it("enqueue/dequeue is FIFO — returns single item per call", () => {
    const q = new SqliteWorkQueue(10, makeTempDbPath());
    try {
      q.enqueue("agent-a", { value: 1 });
      q.enqueue("agent-a", { value: 2 });
      q.enqueue("agent-a", { value: 3 });

      const first = q.dequeue("agent-a");
      const second = q.dequeue("agent-a");
      const third = q.dequeue("agent-a");

      expect(first?.context).toEqual({ value: 1 });
      expect(second?.context).toEqual({ value: 2 });
      expect(third?.context).toEqual({ value: 3 });
      expect(q.size("agent-a")).toBe(0);
    } finally {
      q.close();
    }
  });

  it("dequeue returns undefined when queue is empty", () => {
    const q = new SqliteWorkQueue(10, makeTempDbPath());
    try {
      expect(q.dequeue("nonexistent-agent")).toBeUndefined();
    } finally {
      q.close();
    }
  });

  it("size reflects enqueued and dequeued items accurately", () => {
    const q = new SqliteWorkQueue(10, makeTempDbPath());
    try {
      expect(q.size("agent-a")).toBe(0);
      q.enqueue("agent-a", { value: 1 });
      q.enqueue("agent-a", { value: 2 });
      expect(q.size("agent-a")).toBe(2);
      q.dequeue("agent-a");
      expect(q.size("agent-a")).toBe(1);
    } finally {
      q.close();
    }
  });

  it("peek returns items without removing them", () => {
    const q = new SqliteWorkQueue(10, makeTempDbPath());
    try {
      q.enqueue("agent-a", { value: 1 });
      q.enqueue("agent-a", { value: 2 });

      const peeked = q.peek("agent-a");
      expect(peeked).toHaveLength(2);
      expect(peeked[0].context).toEqual({ value: 1 });
      expect(peeked[1].context).toEqual({ value: 2 });

      // Items still in queue
      expect(q.size("agent-a")).toBe(2);
    } finally {
      q.close();
    }
  });

  it("peek respects limit parameter", () => {
    const q = new SqliteWorkQueue(10, makeTempDbPath());
    try {
      for (let i = 0; i < 5; i++) q.enqueue("agent-a", { value: i });

      const peeked = q.peek("agent-a", 3);
      expect(peeked).toHaveLength(3);
      expect(peeked[0].context).toEqual({ value: 0 });
      expect(peeked[1].context).toEqual({ value: 1 });
      expect(peeked[2].context).toEqual({ value: 2 });

      // Queue unchanged
      expect(q.size("agent-a")).toBe(5);
    } finally {
      q.close();
    }
  });

  it("dequeue item has correct structure (context, receivedAt)", () => {
    const q = new SqliteWorkQueue(10, makeTempDbPath());
    try {
      const before = Date.now();
      q.enqueue("agent-a", { key: "value", num: 42 });
      const item = q.dequeue("agent-a");

      expect(item).toBeDefined();
      expect(item!.context).toEqual({ key: "value", num: 42 });
      expect(item!.receivedAt).toBeInstanceOf(Date);
      expect(item!.receivedAt.getTime()).toBeGreaterThanOrEqual(before);
    } finally {
      q.close();
    }
  });

  it("receivedAt is preserved when explicitly provided", () => {
    const q = new SqliteWorkQueue(10, makeTempDbPath());
    try {
      const date = new Date("2024-06-15T12:00:00.000Z");
      q.enqueue("agent-a", { value: "test" }, date);
      const item = q.dequeue("agent-a");
      expect(item!.receivedAt.getTime()).toBe(date.getTime());
    } finally {
      q.close();
    }
  });

  it("overflow: drops oldest item when at global maxSize", () => {
    const q = new SqliteWorkQueue(2, makeTempDbPath());
    try {
      q.enqueue("agent-a", { value: 1 });
      q.enqueue("agent-a", { value: 2 });

      // Third enqueue should drop oldest (value: 1)
      const result = q.enqueue("agent-a", { value: 3 });
      expect(result.accepted).toBe(true);
      expect(result.dropped).toBeDefined();
      expect((result.dropped!.context as any).value).toBe(1);

      // Queue should have [2, 3]
      expect(q.size("agent-a")).toBe(2);
      const first = q.dequeue("agent-a");
      expect((first!.context as any).value).toBe(2);
      const second = q.dequeue("agent-a");
      expect((second!.context as any).value).toBe(3);
    } finally {
      q.close();
    }
  });

  it("clear removes only the named agent queue", () => {
    const q = new SqliteWorkQueue(10, makeTempDbPath());
    try {
      q.enqueue("agent-a", { value: 1 });
      q.enqueue("agent-b", { value: 2 });

      q.clear("agent-a");

      expect(q.size("agent-a")).toBe(0);
      expect(q.size("agent-b")).toBe(1);
    } finally {
      q.close();
    }
  });

  it("clearAll removes all agent queues", () => {
    const q = new SqliteWorkQueue(10, makeTempDbPath());
    try {
      q.enqueue("agent-a", { value: 1 });
      q.enqueue("agent-b", { value: 2 });
      q.enqueue("agent-c", { value: 3 });

      q.clearAll();

      expect(q.size("agent-a")).toBe(0);
      expect(q.size("agent-b")).toBe(0);
      expect(q.size("agent-c")).toBe(0);
    } finally {
      q.close();
    }
  });

  it("close releases owned DB connection (ownDb=true path)", () => {
    const dbPath = makeTempDbPath();
    const q = new SqliteWorkQueue(10, dbPath);
    q.enqueue("agent-a", { value: 42 });
    expect(q.size("agent-a")).toBe(1);

    // close() should not throw when ownDb=true
    expect(() => q.close()).not.toThrow();

    // After close, a new queue on the same path should see the persisted item
    const q2 = new SqliteWorkQueue(10, dbPath);
    try {
      expect(q2.size("agent-a")).toBe(1);
      const item = q2.dequeue("agent-a");
      expect((item!.context as any).value).toBe(42);
    } finally {
      q2.close();
    }
  });

  it("setAgentMaxSize: per-agent cap overrides global maxSize", () => {
    const q = new SqliteWorkQueue(100, makeTempDbPath()); // Global max = 100
    try {
      q.setAgentMaxSize("small-agent", 2);

      q.enqueue("small-agent", { value: 1 });
      q.enqueue("small-agent", { value: 2 });

      // Third should drop first due to per-agent cap of 2
      const result = q.enqueue("small-agent", { value: 3 });
      expect(result.dropped).toBeDefined();
      expect((result.dropped!.context as any).value).toBe(1);
      expect(q.size("small-agent")).toBe(2);
    } finally {
      q.close();
    }
  });

  it("setAgentMaxSize does not affect other agents", () => {
    const q = new SqliteWorkQueue(100, makeTempDbPath());
    try {
      q.setAgentMaxSize("small-agent", 1);

      // Other agents still use global max (100)
      for (let i = 0; i < 10; i++) q.enqueue("large-agent", { value: i });
      expect(q.size("large-agent")).toBe(10);
      expect(q.size("small-agent")).toBe(0);
    } finally {
      q.close();
    }
  });

  it("multiple agents have independent queues", () => {
    const q = new SqliteWorkQueue(10, makeTempDbPath());
    try {
      q.enqueue("agent-a", { value: "a" });
      q.enqueue("agent-b", { value: "b" });

      expect(q.size("agent-a")).toBe(1);
      expect(q.size("agent-b")).toBe(1);

      expect(q.dequeue("agent-a")?.context).toEqual({ value: "a" });
      expect(q.dequeue("agent-b")?.context).toEqual({ value: "b" });
      expect(q.dequeue("agent-a")).toBeUndefined();
    } finally {
      q.close();
    }
  });

  it("constructor(AppDb) — uses shared connection (ownDb=false)", () => {
    const dbPath = makeTempDbPath();
    const db = createDb(dbPath);
    applyMigrations(db);

    const q = new SqliteWorkQueue(10, db);
    try {
      q.enqueue("shared-agent", { msg: "hello" });
      expect(q.size("shared-agent")).toBe(1);
      const item = q.dequeue("shared-agent");
      expect((item!.context as any).msg).toBe("hello");
      expect(q.size("shared-agent")).toBe(0);
    } finally {
      // When ownDb=false, close() is a no-op for the DB connection
      q.close();
      // Close the shared DB manually
      (db as any).$client.close();
    }
  });

  it("data persists across close and reopen", () => {
    const dbPath = makeTempDbPath();

    // Write some items
    const q1 = new SqliteWorkQueue(10, dbPath);
    q1.enqueue("agent-a", { step: 1 });
    q1.enqueue("agent-a", { step: 2 });
    q1.close();

    // Reopen and verify persistence
    const q2 = new SqliteWorkQueue(10, dbPath);
    try {
      expect(q2.size("agent-a")).toBe(2);
      const first = q2.dequeue("agent-a");
      expect((first!.context as any).step).toBe(1);
      const second = q2.dequeue("agent-a");
      expect((second!.context as any).step).toBe(2);
    } finally {
      q2.close();
    }
  });
});
