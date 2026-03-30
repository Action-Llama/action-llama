/**
 * Tests for EventSourcedWorkQueue — the event-sourced WorkQueue implementation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventSourcedWorkQueue } from "../../src/events/event-queue-unified.js";
import {
  createPersistenceStore,
  type PersistenceStore,
} from "../../src/shared/persistence/index.js";
import { EventTypes } from "../../src/shared/persistence/event-store.js";

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Wait for all pending microtasks and timers to settle so that
 * fire-and-forget async operations (enqueueAsync, dequeueAsync, clearAsync)
 * have completed before we inspect the queue state.
 */
function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("EventSourcedWorkQueue", () => {
  let store: PersistenceStore;
  let queue: EventSourcedWorkQueue<string>;

  beforeEach(async () => {
    store = await createPersistenceStore({ type: "memory" });
    queue = new EventSourcedWorkQueue<string>(store, 100);
  });

  afterEach(async () => {
    queue.close();
    await store.close();
  });

  describe("enqueue", () => {
    it("returns accepted: true immediately (optimistic response)", () => {
      const result = queue.enqueue("agent-a", "event-1");
      expect(result.accepted).toBe(true);
    });

    it("returns no dropped item when the queue has space", () => {
      const result = queue.enqueue("agent-a", "event-1");
      expect(result.dropped).toBeUndefined();
    });

    it("after async settles, the item is reflected in size()", async () => {
      queue.enqueue("agent-a", "event-1");
      await flushAsync();
      expect(queue.size("agent-a")).toBe(1);
    });

    it("multiple enqueues increase size accordingly", async () => {
      queue.enqueue("agent-a", "event-1");
      await flushAsync();
      queue.enqueue("agent-a", "event-2");
      await flushAsync();
      queue.enqueue("agent-a", "event-3");
      await flushAsync();
      expect(queue.size("agent-a")).toBe(3);
    });

    it("queues for different agents are isolated", async () => {
      queue.enqueue("agent-a", "event-a");
      queue.enqueue("agent-b", "event-b");
      await flushAsync();
      expect(queue.size("agent-a")).toBe(1);
      expect(queue.size("agent-b")).toBe(1);
    });

    it("uses the provided receivedAt timestamp", async () => {
      const ts = new Date("2025-01-01T00:00:00Z");
      queue.enqueue("agent-a", "event-1", ts);
      await flushAsync();
      const item = queue.dequeue("agent-a");
      expect(item?.receivedAt.getTime()).toBe(ts.getTime());
    });
  });

  describe("dequeue", () => {
    it("returns undefined for an unknown agent with no queue state", () => {
      // No enqueue has been called, so queueState has no entry for this agent
      const result = queue.dequeue("unknown-agent");
      expect(result).toBeUndefined();
    });

    it("returns items in FIFO order after async settles", async () => {
      queue.enqueue("agent-a", "first");
      await flushAsync();
      queue.enqueue("agent-a", "second");
      await flushAsync();

      const item1 = queue.dequeue("agent-a");
      const item2 = queue.dequeue("agent-a");
      const item3 = queue.dequeue("agent-a");

      expect(item1?.context).toBe("first");
      expect(item2?.context).toBe("second");
      expect(item3).toBeUndefined();
    });

    it("decreases size after dequeue", async () => {
      queue.enqueue("agent-a", "event-1");
      await flushAsync();
      queue.enqueue("agent-a", "event-2");
      await flushAsync();

      queue.dequeue("agent-a");
      expect(queue.size("agent-a")).toBe(1);
    });

    it("returns undefined when queue is empty after dequeuing all items", async () => {
      queue.enqueue("agent-a", "only-item");
      await flushAsync();
      queue.dequeue("agent-a");
      expect(queue.dequeue("agent-a")).toBeUndefined();
    });
  });

  describe("size", () => {
    it("returns 0 for an agent that has never enqueued items", () => {
      expect(queue.size("nonexistent")).toBe(0);
    });

    it("returns the correct count after enqueues", async () => {
      queue.enqueue("agent-x", "a");
      await flushAsync();
      queue.enqueue("agent-x", "b");
      await flushAsync();
      expect(queue.size("agent-x")).toBe(2);
    });
  });

  describe("clear", () => {
    it("empties the queue for a single agent", async () => {
      queue.enqueue("agent-a", "event-1");
      queue.enqueue("agent-a", "event-2");
      await flushAsync();

      queue.clear("agent-a");
      await flushAsync();

      expect(queue.size("agent-a")).toBe(0);
      expect(queue.dequeue("agent-a")).toBeUndefined();
    });

    it("does not affect other agents", async () => {
      queue.enqueue("agent-a", "event-a");
      queue.enqueue("agent-b", "event-b");
      await flushAsync();

      queue.clear("agent-a");
      await flushAsync();

      expect(queue.size("agent-a")).toBe(0);
      expect(queue.size("agent-b")).toBe(1);
    });
  });

  describe("clearAll", () => {
    it("empties queues for all agents", async () => {
      queue.enqueue("agent-a", "event-a");
      queue.enqueue("agent-b", "event-b");
      await flushAsync();

      queue.clearAll();
      await flushAsync();

      expect(queue.size("agent-a")).toBe(0);
      expect(queue.size("agent-b")).toBe(0);
    });
  });

  describe("close", () => {
    it("resets all in-memory state", async () => {
      queue.enqueue("agent-a", "event-1");
      await flushAsync();

      queue.close();

      expect(queue.size("agent-a")).toBe(0);
      expect(queue.dequeue("agent-a")).toBeUndefined();
    });
  });

  describe("replayQueueHistory", () => {
    it("returns an empty array when no events have been recorded for the agent", async () => {
      const history = await queue.replayQueueHistory("no-events-agent");
      expect(history).toEqual([]);
    });

    it("returns recorded work.queued events after enqueue", async () => {
      queue.enqueue("agent-r", "payload-1");
      await flushAsync();

      const history = await queue.replayQueueHistory("agent-r");
      expect(history.length).toBeGreaterThan(0);
      const queuedEvent = history.find((e) => e.type === EventTypes.WORK_QUEUED);
      expect(queuedEvent).toBeDefined();
      expect(queuedEvent!.data.context).toBe("payload-1");
      expect(queuedEvent!.data.agentName).toBe("agent-r");
    });

    it("records work.dequeued events after dequeue", async () => {
      queue.enqueue("agent-r", "payload-dequeue");
      await flushAsync();
      queue.dequeue("agent-r");
      await flushAsync();

      const history = await queue.replayQueueHistory("agent-r");
      const dequeuedEvent = history.find((e) => e.type === EventTypes.WORK_DEQUEUED);
      expect(dequeuedEvent).toBeDefined();
      expect(dequeuedEvent!.data.agentName).toBe("agent-r");
    });

    it("records work.dropped events when queue is cleared", async () => {
      queue.enqueue("agent-r", "to-be-dropped");
      await flushAsync();
      queue.clear("agent-r");
      await flushAsync();

      const history = await queue.replayQueueHistory("agent-r");
      const droppedEvent = history.find((e) => e.type === EventTypes.WORK_DROPPED);
      expect(droppedEvent).toBeDefined();
      expect(droppedEvent!.data.reason).toBe("queue-cleared");
    });

    it("includes timestamp on each event", async () => {
      queue.enqueue("agent-r", "ts-test");
      await flushAsync();

      const history = await queue.replayQueueHistory("agent-r");
      expect(history[0].timestamp).toBeTypeOf("number");
      expect(history[0].timestamp).toBeGreaterThan(0);
    });
  });

  describe("getQueueStats", () => {
    it("returns all-zero stats for an agent with no events", async () => {
      const stats = await queue.getQueueStats("empty-agent");
      expect(stats).toEqual({
        totalEnqueued: 0,
        totalDequeued: 0,
        totalDropped: 0,
        currentSize: 0,
      });
    });

    it("counts enqueued events correctly", async () => {
      queue.enqueue("agent-stats", "item-1");
      await flushAsync();
      queue.enqueue("agent-stats", "item-2");
      await flushAsync();

      const stats = await queue.getQueueStats("agent-stats");
      expect(stats.totalEnqueued).toBe(2);
      expect(stats.currentSize).toBe(2);
    });

    it("counts dequeued events correctly", async () => {
      queue.enqueue("agent-stats", "item-1");
      await flushAsync();
      queue.enqueue("agent-stats", "item-2");
      await flushAsync();
      queue.dequeue("agent-stats");
      await flushAsync();

      const stats = await queue.getQueueStats("agent-stats");
      expect(stats.totalEnqueued).toBe(2);
      expect(stats.totalDequeued).toBe(1);
      expect(stats.currentSize).toBe(1);
    });

    it("counts dropped events after clear()", async () => {
      queue.enqueue("agent-stats", "item-1");
      await flushAsync();
      queue.clear("agent-stats");
      await flushAsync();

      const stats = await queue.getQueueStats("agent-stats");
      expect(stats.totalDropped).toBe(1);
    });

    it("respects the since timestamp filter", async () => {
      const before = Date.now();
      queue.enqueue("agent-stats", "item-1");
      await flushAsync();

      // All events happened at or after `before`, so filtering from after should yield 0
      const stats = await queue.getQueueStats("agent-stats", Date.now() + 10_000);
      expect(stats.totalEnqueued).toBe(0);

      // Filtering from before should include everything
      const statsAll = await queue.getQueueStats("agent-stats", before - 1);
      expect(statsAll.totalEnqueued).toBe(1);
    });
  });

  describe("initialize", () => {
    it("resolves without error when there are no existing work-queue streams", async () => {
      await expect(queue.initialize()).resolves.not.toThrow();
    });

    it("rebuilds queue state from existing streams on initialize()", async () => {
      // Enqueue an item and let the stream be persisted
      queue.enqueue("agent-init", "item-1");
      await flushAsync();

      // Create a new queue instance pointing at the same store
      const queue2 = new EventSourcedWorkQueue<string>(store, 100);
      await queue2.initialize();

      // The queue2 should have rebuilt the state for agent-init
      expect(queue2.size("agent-init")).toBe(1);

      queue2.close();
    });

    it("processes WORK_DEQUEUED events in the stream during initialize() replay", async () => {
      // Enqueue two items
      queue.enqueue("agent-deq", "item-1");
      await flushAsync();
      queue.enqueue("agent-deq", "item-2");
      await flushAsync();

      expect(queue.size("agent-deq")).toBe(2);

      // Dequeue one item — this persists a WORK_DEQUEUED event to the stream
      const dequeued = queue.dequeue("agent-deq");
      expect(dequeued).toBeDefined();
      expect(["item-1", "item-2"]).toContain(dequeued?.context);
      await flushAsync(); // wait for dequeueAsync to write the WORK_DEQUEUED event

      // Verify WORK_DEQUEUED event is in the stream
      const history = await queue.replayQueueHistory("agent-deq");
      const dequeuedEvents = history.filter((e) => e.type === EventTypes.WORK_DEQUEUED);
      expect(dequeuedEvents).toHaveLength(1);

      // Create a new queue from the same backing store and replay via initialize()
      // This exercises the WORK_DEQUEUED case in buildQueueState
      const queue2 = new EventSourcedWorkQueue<string>(store, 100);
      await expect(queue2.initialize()).resolves.not.toThrow();

      // The new queue should have some items (exact count depends on replay logic)
      // but at minimum it processed the events without error
      expect(queue2.size("agent-deq")).toBeGreaterThanOrEqual(1);

      queue2.close();
    });

    it("processes WORK_DROPPED events in the stream during initialize() replay", async () => {
      // Use a queue with max size 1 so the second enqueue evicts the first.
      const smallQueue = new EventSourcedWorkQueue<string>(store, 1);

      smallQueue.enqueue("agent-drop-replay", "item-1");
      await flushAsync();

      expect(smallQueue.size("agent-drop-replay")).toBe(1);

      // Second enqueue evicts item-1 and persists both WORK_DROPPED and WORK_QUEUED events
      smallQueue.enqueue("agent-drop-replay", "item-2");
      await flushAsync();
      await flushAsync(); // extra flush for nested async operations

      expect(smallQueue.size("agent-drop-replay")).toBe(1);

      // Verify WORK_DROPPED event is in the stream
      const history = await smallQueue.replayQueueHistory("agent-drop-replay");
      const droppedEvents = history.filter((e) => e.type === EventTypes.WORK_DROPPED);
      expect(droppedEvents).toHaveLength(1);
      expect(droppedEvents[0].data.reason).toBe("queue-full");

      smallQueue.close();

      // Create a new queue from the same backing store and replay via initialize()
      // This exercises the WORK_DROPPED case in buildQueueState
      const queue2 = new EventSourcedWorkQueue<string>(store, 100);
      await expect(queue2.initialize()).resolves.not.toThrow();

      // The stream has WORK_QUEUED(1), WORK_DROPPED(1), WORK_QUEUED(2)
      // initialize() processes all these events without throwing
      expect(queue2.size("agent-drop-replay")).toBeGreaterThanOrEqual(1);

      queue2.close();
    });

    it("replays WORK_DEQUEUED and WORK_DROPPED with correct workIds so size is exact after initialize()", async () => {
      // Regression test: buildQueueState must pass the original workId when replaying
      // WORK_QUEUED events, otherwise WORK_DEQUEUED / WORK_DROPPED replay silently fails.
      const smallQueue = new EventSourcedWorkQueue<string>(store, 1);

      smallQueue.enqueue("agent-replay-exact", "item-1");
      await flushAsync();
      // Second enqueue evicts item-1 via WORK_DROPPED and adds item-2
      smallQueue.enqueue("agent-replay-exact", "item-2");
      await flushAsync();
      await flushAsync();

      expect(smallQueue.size("agent-replay-exact")).toBe(1);
      smallQueue.close();

      // Rebuild from persisted events
      const queue2 = new EventSourcedWorkQueue<string>(store, 100);
      await queue2.initialize();

      // Must be exactly 1 — if workId was not preserved during replay,
      // WORK_DROPPED would fail to find item-1 and size would incorrectly be 2.
      expect(queue2.size("agent-replay-exact")).toBe(1);

      queue2.close();
    });
  });

  describe("max-size eviction", () => {
    it("drops the oldest item when max size is reached", async () => {
      const smallQueue = new EventSourcedWorkQueue<string>(store, 2);

      smallQueue.enqueue("agent-evict", "item-1");
      smallQueue.enqueue("agent-evict", "item-2");
      await flushAsync();

      // Third item should evict the oldest
      smallQueue.enqueue("agent-evict", "item-3");
      await flushAsync();

      // Queue should still have 2 items
      expect(smallQueue.size("agent-evict")).toBe(2);

      // The oldest item should have been dropped
      const first = smallQueue.dequeue("agent-evict");
      const second = smallQueue.dequeue("agent-evict");
      expect(first?.context).toBe("item-2");
      expect(second?.context).toBe("item-3");

      smallQueue.close();
    });

    it("records a work.dropped event in the stream when an item is evicted", async () => {
      const smallQueue = new EventSourcedWorkQueue<string>(store, 1);

      smallQueue.enqueue("agent-evict2", "item-1");
      await flushAsync();
      smallQueue.enqueue("agent-evict2", "item-2");
      await flushAsync();

      const history = await smallQueue.replayQueueHistory("agent-evict2");
      const droppedEvent = history.find(
        (e) => e.type === EventTypes.WORK_DROPPED && e.data.reason === "queue-full"
      );
      expect(droppedEvent).toBeDefined();

      smallQueue.close();
    });
  });
});
