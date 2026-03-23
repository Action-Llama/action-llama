import { describe, it, expect, afterEach } from "vitest";
import { MemoryWorkQueue, createWorkQueue } from "../../src/events/event-queue.js";
import { SqliteWorkQueue } from "../../src/events/event-queue-sqlite.js";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

/** Shared test suite run against both backends. */
function workQueueSuite(
  name: string,
  factory: (maxSize?: number) => { queue: MemoryWorkQueue<string> | SqliteWorkQueue<string>; cleanup: () => void },
) {
  describe(name, () => {
    let queue: MemoryWorkQueue<string> | SqliteWorkQueue<string>;
    let cleanup: () => void;

    afterEach(() => {
      cleanup?.();
    });

    it("enqueues and dequeues in FIFO order", () => {
      ({ queue, cleanup } = factory());
      queue.enqueue("agent-a", "event-1");
      queue.enqueue("agent-a", "event-2");

      expect(queue.dequeue("agent-a")?.context).toBe("event-1");
      expect(queue.dequeue("agent-a")?.context).toBe("event-2");
      expect(queue.dequeue("agent-a")).toBeUndefined();
    });

    it("isolates queues per agent", () => {
      ({ queue, cleanup } = factory());
      queue.enqueue("agent-a", "a-event");
      queue.enqueue("agent-b", "b-event");

      expect(queue.size("agent-a")).toBe(1);
      expect(queue.size("agent-b")).toBe(1);
      expect(queue.dequeue("agent-a")?.context).toBe("a-event");
      expect(queue.dequeue("agent-b")?.context).toBe("b-event");
    });

    it("drops oldest event when queue is full", () => {
      ({ queue, cleanup } = factory(3));
      queue.enqueue("agent-a", "event-1");
      queue.enqueue("agent-a", "event-2");
      queue.enqueue("agent-a", "event-3");

      const result = queue.enqueue("agent-a", "event-4");
      expect(result.dropped?.context).toBe("event-1");
      expect(queue.size("agent-a")).toBe(3);
      expect(queue.dequeue("agent-a")?.context).toBe("event-2");
    });

    it("returns accepted: true even when dropping", () => {
      ({ queue, cleanup } = factory(1));
      queue.enqueue("agent-a", "event-1");
      const result = queue.enqueue("agent-a", "event-2");
      expect(result.accepted).toBe(true);
      expect(result.dropped?.context).toBe("event-1");
    });

    it("returns no dropped event when queue has space", () => {
      ({ queue, cleanup } = factory(5));
      const result = queue.enqueue("agent-a", "event-1");
      expect(result.accepted).toBe(true);
      expect(result.dropped).toBeUndefined();
    });

    it("size returns 0 for unknown agent", () => {
      ({ queue, cleanup } = factory());
      expect(queue.size("unknown")).toBe(0);
    });

    it("dequeue returns undefined for unknown agent", () => {
      ({ queue, cleanup } = factory());
      expect(queue.dequeue("unknown")).toBeUndefined();
    });

    it("sets receivedAt timestamp on enqueue", () => {
      ({ queue, cleanup } = factory());
      const before = new Date();
      queue.enqueue("agent-a", "event-1");
      const after = new Date();
      const event = queue.dequeue("agent-a")!;
      expect(event.receivedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(event.receivedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it("preserves explicit receivedAt", () => {
      ({ queue, cleanup } = factory());
      const ts = new Date("2025-06-01T00:00:00Z");
      queue.enqueue("agent-a", "event-1", ts);
      const event = queue.dequeue("agent-a")!;
      expect(event.receivedAt.getTime()).toBe(ts.getTime());
    });

    it("clear removes all events for an agent", () => {
      ({ queue, cleanup } = factory());
      queue.enqueue("agent-a", "event-1");
      queue.enqueue("agent-a", "event-2");
      queue.clear("agent-a");
      expect(queue.size("agent-a")).toBe(0);
      expect(queue.dequeue("agent-a")).toBeUndefined();
    });

    it("clearAll removes all agents' queues", () => {
      ({ queue, cleanup } = factory());
      queue.enqueue("agent-a", "a-event");
      queue.enqueue("agent-b", "b-event");
      queue.clearAll();
      expect(queue.size("agent-a")).toBe(0);
      expect(queue.size("agent-b")).toBe(0);
    });
  });
}

// Run shared suite for MemoryWorkQueue
workQueueSuite("MemoryWorkQueue", (maxSize) => {
  const queue = new MemoryWorkQueue<string>(maxSize);
  return { queue, cleanup: () => {} };
});

// Run shared suite for SqliteWorkQueue
workQueueSuite("SqliteWorkQueue", (maxSize) => {
  const dir = mkdtempSync(join(tmpdir(), "al-wq-test-"));
  const queue = new SqliteWorkQueue<string>(maxSize ?? 100, join(dir, "wq.db"));
  return {
    queue,
    cleanup: () => {
      queue.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
});

// SQLite-specific durability tests
describe("SqliteWorkQueue durability", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("items survive close and reopen", () => {
    dir = mkdtempSync(join(tmpdir(), "al-wq-durable-"));
    const dbPath = join(dir, "wq.db");

    const q1 = new SqliteWorkQueue<string>(100, dbPath);
    q1.enqueue("agent-a", "event-1");
    q1.enqueue("agent-a", "event-2");
    q1.close();

    // Reopen — items should still be there
    const q2 = new SqliteWorkQueue<string>(100, dbPath);
    expect(q2.size("agent-a")).toBe(2);
    expect(q2.dequeue("agent-a")?.context).toBe("event-1");
    expect(q2.dequeue("agent-a")?.context).toBe("event-2");
    q2.close();
  });

  it("clearAll is durable across reopen", () => {
    dir = mkdtempSync(join(tmpdir(), "al-wq-durable-"));
    const dbPath = join(dir, "wq.db");

    const q1 = new SqliteWorkQueue<string>(100, dbPath);
    q1.enqueue("agent-a", "event-1");
    q1.clearAll();
    q1.close();

    const q2 = new SqliteWorkQueue<string>(100, dbPath);
    expect(q2.size("agent-a")).toBe(0);
    q2.close();
  });
});

// Factory test
describe("createWorkQueue", () => {
  it("creates MemoryWorkQueue for type=memory", async () => {
    const queue = await createWorkQueue<string>(10, { type: "memory" });
    expect(queue).toBeInstanceOf(MemoryWorkQueue);
    queue.close();
  });

  it("creates SqliteWorkQueue for type=sqlite", async () => {
    const dir = mkdtempSync(join(tmpdir(), "al-wq-factory-"));
    try {
      const queue = await createWorkQueue<string>(10, {
        type: "sqlite",
        path: join(dir, "wq.db"),
      });
      expect(queue).toBeInstanceOf(SqliteWorkQueue);
      queue.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
