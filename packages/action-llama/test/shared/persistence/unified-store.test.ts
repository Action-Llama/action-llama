/**
 * Tests for unified persistence layer.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createPersistenceStore, type PersistenceStore } from "../../../src/shared/persistence/index.js";
import { createEvent, EventTypes } from "../../../src/shared/persistence/event-store.js";

describe("Unified Persistence Store", () => {
  let store: PersistenceStore;

  beforeEach(async () => {
    store = await createPersistenceStore({ type: "memory" });
  });

  afterEach(async () => {
    await store.close();
  });

  describe("Key-Value Operations", () => {
    it("should store and retrieve values", async () => {
      await store.kv.set("test", "key1", { data: "value1" });
      const result = await store.kv.get("test", "key1");
      expect(result).toEqual({ data: "value1" });
    });

    it("should handle TTL expiration", async () => {
      await store.kv.set("test", "key1", { data: "value1" }, { ttl: 0.001 }); // 1ms TTL
      await new Promise(resolve => setTimeout(resolve, 10)); // Wait for expiration
      const result = await store.kv.get("test", "key1");
      expect(result).toBeNull();
    });

    it("should list values in namespace", async () => {
      await store.kv.set("test", "key1", { data: "value1" });
      await store.kv.set("test", "key2", { data: "value2" });
      await store.kv.set("other", "key3", { data: "value3" });
      
      const results = await store.kv.list("test");
      expect(results).toHaveLength(2);
      expect(results.map(r => r.key).sort()).toEqual(["key1", "key2"]);
    });

    it("should delete single keys", async () => {
      await store.kv.set("test", "key1", { data: "value1" });
      await store.kv.set("test", "key2", { data: "value2" });
      
      await store.kv.delete("test", "key1");
      
      const result1 = await store.kv.get("test", "key1");
      const result2 = await store.kv.get("test", "key2");
      
      expect(result1).toBeNull();
      expect(result2).toEqual({ data: "value2" });
    });

    it("should delete all keys in namespace", async () => {
      await store.kv.set("test", "key1", { data: "value1" });
      await store.kv.set("test", "key2", { data: "value2" });
      await store.kv.set("other", "key3", { data: "value3" });
      
      await store.kv.deleteAll("test");
      
      const testResults = await store.kv.list("test");
      const otherResults = await store.kv.list("other");
      
      expect(testResults).toHaveLength(0);
      expect(otherResults).toHaveLength(1);
    });
  });

  describe("Event Sourcing", () => {
    it("should append and replay events", async () => {
      const stream = store.events.stream("test-stream");
      
      const event1 = await stream.append(createEvent("test.created", { id: 1 }));
      const event2 = await stream.append(createEvent("test.updated", { id: 1, value: "new" }));
      
      const events = [];
      for await (const event of stream.replay()) {
        events.push(event);
      }
      
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe("test.created");
      expect(events[1].type).toBe("test.updated");
      expect(events[0].id).toBe(event1.id);
      expect(events[1].id).toBe(event2.id);
    });

    it("should filter events by type", async () => {
      const stream = store.events.stream("test-stream");
      
      await stream.append(createEvent("test.created", { id: 1 }));
      await stream.append(createEvent("test.updated", { id: 1 }));
      await stream.append(createEvent("test.deleted", { id: 1 }));
      
      const events = [];
      for await (const event of stream.replay({ type: "test.updated" })) {
        events.push(event);
      }
      
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("test.updated");
    });

    it("should filter events by timestamp", async () => {
      const stream = store.events.stream("test-stream");
      const beforeTime = Date.now();
      
      await stream.append(createEvent("test.old", { id: 1 }));
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const afterTime = Date.now();
      await stream.append(createEvent("test.new", { id: 2 }));
      
      const recentEvents = [];
      for await (const event of stream.replay({ from: afterTime })) {
        recentEvents.push(event);
      }
      
      expect(recentEvents).toHaveLength(1);
      expect(recentEvents[0].type).toBe("test.new");
    });

    it("should handle snapshots", async () => {
      const stream = store.events.stream("test-stream");
      
      // Create some events
      const event1 = await stream.append(createEvent("test.created", { id: 1, value: 0 }));
      await stream.append(createEvent("test.incremented", { id: 1, value: 1 }));
      await stream.append(createEvent("test.incremented", { id: 1, value: 2 }));
      
      // Save snapshot
      const snapshotData = { id: 1, value: 2, lastEventId: event1.id };
      await stream.saveSnapshot("counter", snapshotData, event1.id);
      
      // Retrieve snapshot
      const retrieved = await stream.getSnapshot("counter");
      expect(retrieved).toEqual(snapshotData);
    });

    it("should list available streams", async () => {
      const stream1 = store.events.stream("stream-1");
      const stream2 = store.events.stream("stream-2");
      
      await stream1.append(createEvent("test", { data: 1 }));
      await stream2.append(createEvent("test", { data: 2 }));
      
      const streams = await store.events.listStreams();
      expect(streams.sort()).toEqual(["stream-1", "stream-2"]);
    });
  });

  describe("Transactions", () => {
    it("should commit successful transactions", async () => {
      await store.transaction(async (txStore) => {
        await txStore.kv.set("test", "key1", { data: "value1" });
        await txStore.kv.set("test", "key2", { data: "value2" });
      });
      
      const results = await store.kv.list("test");
      expect(results).toHaveLength(2);
    });

    it("should rollback failed transactions", async () => {
      await expect(store.transaction(async (txStore) => {
        await txStore.kv.set("test", "key1", { data: "value1" });
        await txStore.kv.set("test", "key2", { data: "value2" });
        throw new Error("Transaction failed");
      })).rejects.toThrow("Transaction failed");
      
      const results = await store.kv.list("test");
      expect(results).toHaveLength(0);
    });
  });
});

describe("SQLite Backend", () => {
  let store: PersistenceStore;

  beforeEach(async () => {
    store = await createPersistenceStore({ type: "sqlite", path: ":memory:" });
  });

  afterEach(async () => {
    await store.close();
  });

  it("should work with SQLite backend", async () => {
    // Test basic KV operations
    await store.kv.set("test", "key1", { data: "sqlite-value" });
    const result = await store.kv.get("test", "key1");
    expect(result).toEqual({ data: "sqlite-value" });
    
    // Test events
    const stream = store.events.stream("sqlite-stream");
    await stream.append(createEvent("test.sqlite", { backend: "sqlite" }));
    
    const events = [];
    for await (const event of stream.replay()) {
      events.push(event);
    }
    
    expect(events).toHaveLength(1);
    expect(events[0].data).toEqual({ backend: "sqlite" });
  });

  it("should support SQL queries", async () => {
    // Add some KV data
    await store.kv.set("users", "user1", { name: "Alice", age: 30 });
    await store.kv.set("users", "user2", { name: "Bob", age: 25 });
    
    // Note: SQL queries depend on the backend schema
    // This is a basic test - more complex queries would need the actual schema
    const results = await store.query.sql("SELECT COUNT(*) as count FROM kv_store WHERE namespace = ?", ["users"]);
    expect(results[0].count).toBe(2);
  });
});

describe("Event Store Helpers", () => {
  let store: PersistenceStore;

  beforeEach(async () => {
    store = await createPersistenceStore({ type: "memory" });
  });

  afterEach(async () => {
    await store.close();
  });

  it("should create events with proper metadata", async () => {
    const event = createEvent("test.action", { id: 1 }, { source: "test", actor: "user" });
    
    expect(event.type).toBe("test.action");
    expect(event.data).toEqual({ id: 1 });
    expect(event.metadata?.source).toBe("action-llama"); // Default source is overridden
    expect(event.metadata?.actor).toBe("user");
    expect(event.version).toBe(1);
  });

  it("should handle standard event types", async () => {
    const stream = store.events.stream("test-stream");
    
    await stream.append(createEvent(EventTypes.RUN_STARTED, { agentName: "test" }));
    await stream.append(createEvent(EventTypes.RUN_COMPLETED, { agentName: "test" }));
    
    const events = [];
    for await (const event of stream.replay()) {
      events.push(event);
    }
    
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe(EventTypes.RUN_STARTED);
    expect(events[1].type).toBe(EventTypes.RUN_COMPLETED);
  });
});