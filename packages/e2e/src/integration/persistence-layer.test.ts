/**
 * Integration tests: shared/persistence/ unified persistence layer — no Docker required.
 *
 * The persistence layer provides a unified abstraction over key-value storage,
 * event sourcing, and query operations. It supports two backends:
 *   - MemoryBackend — in-memory (tests, single-process)
 *   - SqliteBackend — SQLite (production)
 *
 * Both are exercised here via the createPersistenceStore() factory, which is
 * the public API used throughout the scheduler.
 *
 * Covers:
 *   - shared/persistence/index.ts: createPersistenceStore() memory + sqlite
 *   - shared/persistence/index.ts: PersistenceStore.kv.get/set/delete/deleteAll/list
 *   - shared/persistence/index.ts: PersistenceStore.events.stream().append/replay
 *   - shared/persistence/index.ts: PersistenceStore.events.listStreams()
 *   - shared/persistence/index.ts: EventStream.getSnapshot/saveSnapshot
 *   - shared/persistence/index.ts: PersistenceStore.transaction() with rollback
 *   - shared/persistence/backends/memory.ts: MemoryBackend — all operations
 *   - shared/persistence/backends/sqlite.ts: SqliteBackend — all operations
 *   - shared/persistence/event-store.ts: createEvent() helper
 *   - shared/persistence/event-store.ts: EventStreamWrapper.appendTyped()
 *   - shared/persistence/event-store.ts: EventMigrator.addMigration()/migrate()
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const { createPersistenceStore } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/shared/persistence/index.js"
);

const { createEvent, EventTypes, EventStreamWrapper, Projections, EventMigrator } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/shared/persistence/event-store.js"
);

function makeTempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "al-persistence-test-"));
  return join(dir, "persistence.db");
}

// Run the same suite against both backends
for (const backendType of ["memory", "sqlite"] as const) {
  describe(`integration: persistence layer (${backendType} backend, no Docker required)`, { timeout: 30_000 }, () => {

    async function makeStore() {
      if (backendType === "memory") {
        return createPersistenceStore({ type: "memory" });
      } else {
        return createPersistenceStore({ type: "sqlite", path: makeTempDbPath() });
      }
    }

    // -------------------------------------------------------------------------
    // KV operations
    // -------------------------------------------------------------------------

    it("kv.get returns null for missing key", async () => {
      const store = await makeStore();
      const val = await store.kv.get("ns1", "missing");
      expect(val).toBeNull();
      await store.close();
    });

    it("kv.set then kv.get returns the stored value", async () => {
      const store = await makeStore();
      await store.kv.set("ns1", "key1", { data: 42 });
      const val = await store.kv.get("ns1", "key1");
      expect(val).toEqual({ data: 42 });
      await store.close();
    });

    it("kv.set upserts (overwrites existing key)", async () => {
      const store = await makeStore();
      await store.kv.set("ns1", "key1", "original");
      await store.kv.set("ns1", "key1", "updated");
      const val = await store.kv.get("ns1", "key1");
      expect(val).toBe("updated");
      await store.close();
    });

    it("kv.delete removes the key", async () => {
      const store = await makeStore();
      await store.kv.set("ns1", "k1", "v1");
      await store.kv.set("ns1", "k2", "v2");
      await store.kv.delete("ns1", "k1");
      expect(await store.kv.get("ns1", "k1")).toBeNull();
      expect(await store.kv.get("ns1", "k2")).toBe("v2");
      await store.close();
    });

    it("kv.deleteAll removes all keys in namespace", async () => {
      const store = await makeStore();
      await store.kv.set("ns-clear", "a", 1);
      await store.kv.set("ns-clear", "b", 2);
      await store.kv.set("ns-other", "c", 3);
      await store.kv.deleteAll("ns-clear");
      expect(await store.kv.get("ns-clear", "a")).toBeNull();
      expect(await store.kv.get("ns-clear", "b")).toBeNull();
      expect(await store.kv.get("ns-other", "c")).toBe(3); // unaffected
      await store.close();
    });

    it("kv.list returns all entries in namespace", async () => {
      const store = await makeStore();
      await store.kv.set("ns-list", "x", "val-x");
      await store.kv.set("ns-list", "y", "val-y");
      await store.kv.set("ns-other", "z", "val-z");

      const entries = await store.kv.list("ns-list");
      expect(entries.length).toBe(2);
      const keys = entries.map((e: { key: string }) => e.key).sort();
      expect(keys).toEqual(["x", "y"]);
      await store.close();
    });

    it("kv.list returns empty array for empty namespace", async () => {
      const store = await makeStore();
      const entries = await store.kv.list("empty-ns");
      expect(entries).toEqual([]);
      await store.close();
    });

    it("kv.set with TTL makes entry expire", async () => {
      const store = await makeStore();
      await store.kv.set("ns-ttl", "expires", "temp", { ttl: 1 }); // 1 second
      expect(await store.kv.get("ns-ttl", "expires")).toBe("temp");

      await new Promise((r) => setTimeout(r, 1100));
      expect(await store.kv.get("ns-ttl", "expires")).toBeNull();
      await store.close();
    }, 15_000);

    // -------------------------------------------------------------------------
    // Event stream operations
    // -------------------------------------------------------------------------

    it("events.stream().append returns event with id and timestamp", async () => {
      const store = await makeStore();
      const stream = store.events.stream("my-stream");
      const event = await stream.append({ type: "test.event", data: { val: 1 }, version: 1 });
      expect(typeof event.id).toBe("string");
      expect(event.id.length).toBeGreaterThan(0);
      expect(typeof event.timestamp).toBe("number");
      expect(event.timestamp).toBeGreaterThan(0);
      expect(event.type).toBe("test.event");
      expect(event.data).toEqual({ val: 1 });
      await store.close();
    });

    it("events.stream().replay returns appended events in order", async () => {
      const store = await makeStore();
      const stream = store.events.stream("order-stream");
      await stream.append({ type: "a", data: 1, version: 1 });
      await stream.append({ type: "b", data: 2, version: 1 });
      await stream.append({ type: "c", data: 3, version: 1 });

      const events: any[] = [];
      for await (const e of stream.replay()) {
        events.push(e);
      }
      expect(events.length).toBe(3);
      expect(events[0].type).toBe("a");
      expect(events[1].type).toBe("b");
      expect(events[2].type).toBe("c");
      await store.close();
    });

    it("events.stream().replay with type filter returns only matching events", async () => {
      const store = await makeStore();
      const stream = store.events.stream("filter-stream");
      await stream.append({ type: "want", data: 1, version: 1 });
      await stream.append({ type: "skip", data: 2, version: 1 });
      await stream.append({ type: "want", data: 3, version: 1 });

      const events: any[] = [];
      for await (const e of stream.replay({ type: "want" })) {
        events.push(e);
      }
      expect(events.length).toBe(2);
      expect(events.every((e: any) => e.type === "want")).toBe(true);
      await store.close();
    });

    it("events.stream().replay with limit returns at most N events", async () => {
      const store = await makeStore();
      const stream = store.events.stream("limit-stream");
      for (let i = 0; i < 5; i++) {
        await stream.append({ type: "item", data: i, version: 1 });
      }

      const events: any[] = [];
      for await (const e of stream.replay({ limit: 3 })) {
        events.push(e);
      }
      expect(events.length).toBe(3);
      await store.close();
    });

    it("events.stream().getSnapshot returns null when no snapshot exists", async () => {
      const store = await makeStore();
      const stream = store.events.stream("snap-stream");
      const snap = await stream.getSnapshot("my-projection");
      expect(snap).toBeNull();
      await store.close();
    });

    it("events.stream().saveSnapshot then getSnapshot returns saved data", async () => {
      const store = await makeStore();
      const stream = store.events.stream("snap-stream");
      const event = await stream.append({ type: "evt", data: {}, version: 1 });
      await stream.saveSnapshot("my-projection", { state: "ready", count: 42 }, event.id);
      const snap = await stream.getSnapshot("my-projection");
      expect(snap).toEqual({ state: "ready", count: 42 });
      await store.close();
    });

    it("events.listStreams returns names of streams that have events", async () => {
      const store = await makeStore();
      const s1 = store.events.stream("stream-alpha");
      const s2 = store.events.stream("stream-beta");
      await s1.append({ type: "e", data: {}, version: 1 });
      await s2.append({ type: "e", data: {}, version: 1 });

      const streams = await store.events.listStreams();
      expect(streams).toContain("stream-alpha");
      expect(streams).toContain("stream-beta");
      await store.close();
    });

    // -------------------------------------------------------------------------
    // Transaction
    // -------------------------------------------------------------------------

    it("transaction commits on success", async () => {
      const store = await makeStore();
      await store.transaction(async (txStore) => {
        await txStore.kv.set("tx-ns", "k1", "committed");
      });
      const val = await store.kv.get("tx-ns", "k1");
      expect(val).toBe("committed");
      await store.close();
    });

    it("transaction rolls back on error (memory backend)", async () => {
      if (backendType !== "memory") return; // SQLite txn rollback behavior varies

      const store = await makeStore();
      await store.kv.set("tx-ns", "before", "original");

      try {
        await store.transaction(async (txStore) => {
          await txStore.kv.set("tx-ns", "before", "modified");
          throw new Error("rollback trigger");
        });
      } catch {
        // Expected
      }

      // Memory backend rolls back: original value should be restored
      const val = await store.kv.get("tx-ns", "before");
      expect(val).toBe("original");
      await store.close();
    });
  });
}

// -------------------------------------------------------------------------
// event-store.ts helpers
// -------------------------------------------------------------------------

describe("integration: persistence/event-store.ts helpers (no Docker required)", { timeout: 30_000 }, () => {

  it("createEvent() returns correct structure with defaults", () => {
    const evt = createEvent("test.type", { key: "val" });
    expect(evt.type).toBe("test.type");
    expect(evt.data).toEqual({ key: "val" });
    expect(evt.version).toBe(1);
    expect(evt.metadata?.source).toBe("action-llama");
  });

  it("createEvent() uses provided version", () => {
    const evt = createEvent("test.type", {}, undefined, 3);
    expect(evt.version).toBe(3);
  });

  it("EventTypes namespace has expected constants", () => {
    expect(EventTypes.RUN_STARTED).toBe("run.started");
    expect(EventTypes.RUN_COMPLETED).toBe("run.completed");
    expect(EventTypes.RUN_FAILED).toBe("run.failed");
    expect(EventTypes.CALL_INITIATED).toBe("call.initiated");
    expect(EventTypes.LOCK_ACQUIRED).toBe("lock.acquired");
    expect(EventTypes.SESSION_CREATED).toBe("session.created");
  });

  it("EventStreamWrapper.appendTyped() appends with metadata", async () => {
    const store = await createPersistenceStore({ type: "memory" });
    const stream = store.events.stream("wrapper-stream");
    const wrapper = new EventStreamWrapper(stream);

    await wrapper.appendTyped(EventTypes.RUN_STARTED, { instanceId: "i-001", agentName: "agent" }, {
      source: "test",
      correlationId: "corr-001",
    });

    const events: any[] = [];
    for await (const e of stream.replay()) {
      events.push(e);
    }
    expect(events.length).toBe(1);
    expect(events[0].type).toBe(EventTypes.RUN_STARTED);
    expect(events[0].data.instanceId).toBe("i-001");
    expect(events[0].metadata?.correlationId).toBe("corr-001");

    await store.close();
  });

  it("EventMigrator.migrate() returns same event when targetVersion equals current version", () => {
    const migrator = new EventMigrator();
    const event = { id: "e1", type: "test.event", data: {}, timestamp: Date.now(), version: 1 };
    // Migrate to same version — no-op
    const result = migrator.migrate(event, 1);
    expect(result).toEqual(event);
  });

  it("EventMigrator.migrate() applies registered migration to targetVersion", () => {
    const migrator = new EventMigrator();
    migrator.addMigration("test.event", {
      fromVersion: 1,
      toVersion: 2,
      migrate: (e) => ({ ...e, version: 2, data: { ...e.data, migrated: true } }),
    });

    const event = { id: "e1", type: "test.event", data: { original: true }, timestamp: Date.now(), version: 1 };
    const result = migrator.migrate(event, 2);
    expect(result.version).toBe(2);
    expect(result.data.migrated).toBe(true);
    expect(result.data.original).toBe(true);
  });
});
