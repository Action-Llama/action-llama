import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createQueue, type Queue } from "../../src/shared/queue.js";
import { MemoryQueue } from "../../src/shared/queue-memory.js";
import { SqliteQueue } from "../../src/shared/queue-sqlite.js";
import { createDb } from "../../src/db/connection.js";
import { applyMigrations } from "../../src/db/migrate.js";

/**
 * Contract tests: every Queue implementation must pass these.
 */
function queueContract(label: string, factory: () => Promise<Queue<string>>) {
  describe(label, () => {
    it("enqueue returns a unique id", async () => {
      const q = await factory();
      const id1 = await q.enqueue("a");
      const id2 = await q.enqueue("b");
      expect(typeof id1).toBe("string");
      expect(id1).not.toBe(id2);
      await q.close();
    });

    it("size reflects enqueue and dequeue", async () => {
      const q = await factory();
      expect(await q.size()).toBe(0);
      await q.enqueue("x");
      await q.enqueue("y");
      expect(await q.size()).toBe(2);
      await q.dequeue();
      expect(await q.size()).toBe(1);
      await q.close();
    });

    it("dequeue returns items in FIFO order", async () => {
      const q = await factory();
      await q.enqueue("first");
      await q.enqueue("second");
      await q.enqueue("third");
      const [item] = await q.dequeue();
      expect(item.payload).toBe("first");
      const [item2] = await q.dequeue();
      expect(item2.payload).toBe("second");
      await q.close();
    });

    it("dequeue removes items from the queue", async () => {
      const q = await factory();
      await q.enqueue("item");
      await q.dequeue();
      expect(await q.size()).toBe(0);
      await q.close();
    });

    it("dequeue with limit returns multiple items in order", async () => {
      const q = await factory();
      await q.enqueue("a");
      await q.enqueue("b");
      await q.enqueue("c");
      const items = await q.dequeue(2);
      expect(items).toHaveLength(2);
      expect(items[0].payload).toBe("a");
      expect(items[1].payload).toBe("b");
      expect(await q.size()).toBe(1);
      await q.close();
    });

    it("dequeue on empty queue returns empty array", async () => {
      const q = await factory();
      const items = await q.dequeue();
      expect(items).toEqual([]);
      await q.close();
    });

    it("dequeue limit larger than queue size returns all items", async () => {
      const q = await factory();
      await q.enqueue("only");
      const items = await q.dequeue(10);
      expect(items).toHaveLength(1);
      expect(items[0].payload).toBe("only");
      await q.close();
    });

    it("peek returns items without removing them", async () => {
      const q = await factory();
      await q.enqueue("peek-me");
      const [item] = await q.peek();
      expect(item.payload).toBe("peek-me");
      expect(await q.size()).toBe(1);
      await q.close();
    });

    it("peek with limit returns multiple items in order without removing them", async () => {
      const q = await factory();
      await q.enqueue("a");
      await q.enqueue("b");
      const items = await q.peek(2);
      expect(items).toHaveLength(2);
      expect(items[0].payload).toBe("a");
      expect(items[1].payload).toBe("b");
      expect(await q.size()).toBe(2);
      await q.close();
    });

    it("item has correct id and enqueuedAt", async () => {
      const q = await factory();
      const before = Date.now();
      const id = await q.enqueue("timestamped");
      const [item] = await q.dequeue();
      expect(item.id).toBe(id);
      expect(item.enqueuedAt).toBeGreaterThanOrEqual(before);
      expect(item.enqueuedAt).toBeLessThanOrEqual(Date.now());
      await q.close();
    });

    it("round-trips complex JSON payloads", async () => {
      const q = await factory() as unknown as Queue<{ n: number; arr: string[] }>;
      const payload = { n: 42, arr: ["x", "y"] };
      await q.enqueue(payload);
      const [item] = await q.dequeue();
      expect(item.payload).toEqual(payload);
      await q.close();
    });
  });
}

describe("Queue", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  function sqliteFactory(name = "default"): () => Promise<Queue<string>> {
    return async () => {
      const dir = mkdtempSync(join(tmpdir(), "al-queue-"));
      dirs.push(dir);
      return new SqliteQueue<string>(join(dir, "queue.db"), name);
    };
  }

  queueContract("MemoryQueue", async () => new MemoryQueue<string>());
  queueContract("SqliteQueue", sqliteFactory());

  describe("SqliteQueue — multiple queues in one db file", () => {
    it("isolates items by queue name", async () => {
      const dir = mkdtempSync(join(tmpdir(), "al-queue-"));
      dirs.push(dir);
      const path = join(dir, "multi.db");
      const q1 = new SqliteQueue<string>(path, "alpha");
      const q2 = new SqliteQueue<string>(path, "beta");
      await q1.enqueue("from-alpha");
      await q2.enqueue("from-beta");
      const [item1] = await q1.dequeue();
      expect(item1.payload).toBe("from-alpha");
      expect(await q1.size()).toBe(0);
      expect(await q2.size()).toBe(1);
      const [item2] = await q2.dequeue();
      expect(item2.payload).toBe("from-beta");
      await q1.close();
      await q2.close();
    });

    it("dequeue is atomic — concurrent reads don't double-claim", async () => {
      const dir = mkdtempSync(join(tmpdir(), "al-queue-"));
      dirs.push(dir);
      const path = join(dir, "atomic.db");
      // Two handles to the same queue name
      const q1 = new SqliteQueue<string>(path, "shared");
      const q2 = new SqliteQueue<string>(path, "shared");
      await q1.enqueue("item-1");
      await q1.enqueue("item-2");
      // Each reader claims one item
      const [a] = await q1.dequeue();
      const [b] = await q2.dequeue();
      expect(a.payload).not.toBe(b.payload);
      expect(await q1.size()).toBe(0);
      await q1.close();
      await q2.close();
    });
  });

  describe("SqliteQueue — with existing AppDb (shared connection)", () => {
    it("accepts an existing AppDb and uses ownDb = false path", async () => {
      const sharedDb = createDb(":memory:");
      applyMigrations(sharedDb);

      const q = new SqliteQueue<string>(sharedDb as any, "shared-db-queue");
      await q.enqueue("hello");
      const dequeued = await q.dequeue();
      expect(dequeued).toHaveLength(1);
      expect(dequeued[0].payload).toBe("hello");
      await q.close();
    });
  });

  describe("createQueue factory", () => {
    it("creates memory queue", async () => {
      const q = await createQueue<number>({ type: "memory" });
      await q.enqueue(42);
      const [item] = await q.dequeue();
      expect(item.payload).toBe(42);
      await q.close();
    });

    it("creates sqlite queue", async () => {
      const dir = mkdtempSync(join(tmpdir(), "al-queue-"));
      dirs.push(dir);
      const q = await createQueue<string>({
        type: "sqlite",
        path: join(dir, "q.db"),
        name: "test",
      });
      await q.enqueue("hello");
      const [item] = await q.dequeue();
      expect(item.payload).toBe("hello");
      await q.close();
    });
  });
});
