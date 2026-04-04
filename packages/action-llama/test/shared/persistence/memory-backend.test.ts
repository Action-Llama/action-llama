/**
 * Tests for MemoryBackend — covering edge cases not exercised by the
 * general unified-store tests.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { createPersistenceStore, type PersistenceStore } from "../../../src/shared/persistence/index.js";
import { createEvent } from "../../../src/shared/persistence/event-store.js";

afterEach(() => {
  vi.useRealTimers();
});

// ─── maxSize enforcement ──────────────────────────────────────────────────────

describe("MemoryBackend — maxSize enforcement", () => {
  it("throws when kvSet would exceed the maxSize limit", async () => {
    const store = await createPersistenceStore({ type: "memory", maxSize: 2 });

    // Fill the store to the limit
    await store.kv.set("ns", "key1", "value1");
    await store.kv.set("ns", "key2", "value2");

    // Third distinct key should throw
    await expect(store.kv.set("ns", "key3", "value3")).rejects.toThrow(
      "Memory store size limit exceeded (2)"
    );

    await store.close();
  });

  it("allows overwriting an existing key even at maxSize", async () => {
    const store = await createPersistenceStore({ type: "memory", maxSize: 1 });
    await store.kv.set("ns", "key1", "original");

    // Updating the same key should not throw
    await expect(store.kv.set("ns", "key1", "updated")).resolves.not.toThrow();

    const val = await store.kv.get("ns", "key1");
    expect(val).toBe("updated");

    await store.close();
  });
});

// ─── kvList with expired entries ─────────────────────────────────────────────

describe("MemoryBackend — kvList skips expired entries", () => {
  it("does not return entries whose TTL has elapsed", async () => {
    const store = await createPersistenceStore({ type: "memory" });

    // Set one long-lived key and one very short-lived key
    await store.kv.set("ns", "live", "live-value");
    await store.kv.set("ns", "dead", "dead-value", { ttl: 0.001 }); // 1 ms

    // Wait for the short-lived key to expire
    await new Promise((resolve) => setTimeout(resolve, 20));

    const results = await store.kv.list("ns");
    const keys = results.map((r) => r.key);

    expect(keys).toContain("live");
    expect(keys).not.toContain("dead");

    await store.close();
  });

  it("returns an empty list when all entries in the namespace have expired", async () => {
    const store = await createPersistenceStore({ type: "memory" });

    await store.kv.set("ns", "a", "va", { ttl: 0.001 });
    await store.kv.set("ns", "b", "vb", { ttl: 0.001 });

    await new Promise((resolve) => setTimeout(resolve, 20));

    const results = await store.kv.list("ns");
    expect(results).toHaveLength(0);

    await store.close();
  });
});

// ─── eventReplay with `to` filter ────────────────────────────────────────────

describe("MemoryBackend — eventReplay to filter", () => {
  it("returns only events before the `to` timestamp", async () => {
    const store = await createPersistenceStore({ type: "memory" });
    const stream = store.events.stream("test-stream");

    // Append first event
    await stream.append(createEvent("event.first", { seq: 1 }));

    // Record a cutoff time between the two events
    const cutoffTs = Date.now() + 1; // one millisecond in the future
    await new Promise((resolve) => setTimeout(resolve, 5)); // ensure next event is after cutoff

    // Append second event
    await stream.append(createEvent("event.second", { seq: 2 }));

    // Query with `to` — should only return the first event
    const earlyEvents: string[] = [];
    for await (const evt of stream.replay({ to: cutoffTs })) {
      earlyEvents.push(evt.type);
    }

    expect(earlyEvents).toContain("event.first");
    expect(earlyEvents).not.toContain("event.second");

    await store.close();
  });

  it("returns no events when `to` is before all event timestamps", async () => {
    const store = await createPersistenceStore({ type: "memory" });
    const stream = store.events.stream("test-stream");

    await new Promise((resolve) => setTimeout(resolve, 5));
    const beforeAll = Date.now() - 1000; // well in the past

    await stream.append(createEvent("event.after", { seq: 1 }));

    const events: string[] = [];
    for await (const evt of stream.replay({ to: beforeAll })) {
      events.push(evt.type);
    }

    expect(events).toHaveLength(0);

    await store.close();
  });
});

// ─── createPersistenceStore with unknown backend type ─────────────────────────

describe("createPersistenceStore — unknown backend type", () => {
  it("throws an error for an unsupported persistence backend type", async () => {
    await expect(
      createPersistenceStore({ type: "unknown-backend-xyz" as any })
    ).rejects.toThrow("Unsupported persistence backend: unknown-backend-xyz");
  });
});

// ─── transaction with existing events snapshot ───────────────────────────────

describe("MemoryBackend — transactionBegin snapshots events", () => {
  it("snapshots existing events when beginning a transaction, allowing rollback", async () => {
    const store = await createPersistenceStore({ type: "memory" });

    // Append an event so the events map has entries
    const stream = store.events.stream("test-stream-tx");
    await stream.append(createEvent("test", { value: "before" }));

    // Verify event exists
    const beforeEvents: any[] = [];
    for await (const evt of stream.replay({})) {
      beforeEvents.push(evt);
    }
    expect(beforeEvents).toHaveLength(1);

    // Use transaction with rollback — this calls transactionBegin() which
    // snapshots the events map (covers the [...v] spread on line 205)
    let caughtError: Error | null = null;
    try {
      await store.transaction(async (txStore) => {
        // Append another event during the transaction
        const txStream = txStore.events.stream("test-stream-tx");
        await txStream.append(createEvent("test", { value: "during" }));

        const duringEvents: any[] = [];
        for await (const evt of txStream.replay({})) {
          duringEvents.push(evt);
        }
        expect(duringEvents).toHaveLength(2);

        // Force rollback by throwing
        throw new Error("rollback");
      });
    } catch (err: any) {
      caughtError = err;
    }

    expect(caughtError?.message).toBe("rollback");

    // After rollback, events should be back to 1
    const afterEvents: any[] = [];
    for await (const evt of stream.replay({})) {
      afterEvents.push(evt);
    }
    expect(afterEvents).toHaveLength(1);
    expect((afterEvents[0] as any).data.value).toBe("before");

    await store.close();
  });
});

// ─── nested transactions ──────────────────────────────────────────────────────

describe("MemoryBackend — nested transactions", () => {
  it("does not take a snapshot when transactionDepth > 1 (nested begin)", async () => {
    const { MemoryBackend } = await import("../../../src/shared/persistence/backends/memory.js");
    const backend = new MemoryBackend();
    await backend.init();

    // Begin outer transaction (depth = 1, snapshot taken)
    await backend.transactionBegin();
    await backend.kvSet("ns", "key", "outer");

    // Begin nested transaction (depth = 2, snapshot NOT taken again)
    await backend.transactionBegin();
    await backend.kvSet("ns", "key2", "inner");

    // Commit inner (depth goes to 1 — not 0, so stack is NOT popped)
    await backend.transactionCommit();

    // Commit outer (depth goes to 0 — stack IS popped)
    await backend.transactionCommit();

    // Both keys should persist
    expect(await backend.kvGet("ns", "key")).toBe("outer");
    expect(await backend.kvGet("ns", "key2")).toBe("inner");

    await backend.close();
  });

  it("does not restore state for nested rollback (depth > 0 after decrement)", async () => {
    const { MemoryBackend } = await import("../../../src/shared/persistence/backends/memory.js");
    const backend = new MemoryBackend();
    await backend.init();

    // Outer transaction
    await backend.transactionBegin();
    await backend.kvSet("ns", "k1", "v1");

    // Inner (nested) transaction
    await backend.transactionBegin();
    await backend.kvSet("ns", "k2", "v2");

    // Rolling back inner doesn't restore — only outer rollback does
    await backend.transactionRollback(); // depth 2 → 1, nothing restored
    // k2 is still there because the stack only restores on depth 0
    expect(await backend.kvGet("ns", "k2")).toBe("v2");

    // Now rollback outer — restores to pre-transaction state
    await backend.transactionRollback(); // depth 1 → 0, restores
    expect(await backend.kvGet("ns", "k1")).toBeNull();
    expect(await backend.kvGet("ns", "k2")).toBeNull();

    await backend.close();
  });
});

// ─── close without init ───────────────────────────────────────────────────────

describe("MemoryBackend — close without init", () => {
  it("does not throw when close() is called before init()", async () => {
    // Directly import MemoryBackend to test without init()
    const { MemoryBackend } = await import("../../../src/shared/persistence/backends/memory.js");
    const backend = new MemoryBackend();

    // close() without init() — sweepTimer is undefined, should not throw
    await expect(backend.close()).resolves.not.toThrow();
  });
});

// ─── sweep() with no expired entries ─────────────────────────────────────────

describe("MemoryBackend — sweep() with no expired entries", () => {
  it("does not log when no entries are cleaned", async () => {
    vi.useFakeTimers();
    const consoleSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

    const store = await createPersistenceStore({ type: "memory" });

    // Set a live key (no TTL)
    await store.kv.set("ns", "live", "value");

    // Advance timers to trigger sweep — nothing should expire
    vi.advanceTimersByTime(60_001);

    // console.debug should NOT have been called (cleaned = 0)
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
    vi.useRealTimers();
    await store.close();
  });
});

// ─── init() with timer lacking unref ─────────────────────────────────────────

describe("MemoryBackend — timer without unref", () => {
  it("does not throw when setInterval returns a timer without unref", async () => {
    const fakeTimer = {} as any; // no unref property
    vi.spyOn(globalThis, "setInterval" as any).mockReturnValueOnce(fakeTimer);

    const { MemoryBackend } = await import("../../../src/shared/persistence/backends/memory.js");
    const backend = new MemoryBackend();
    await expect(backend.init()).resolves.not.toThrow();

    vi.restoreAllMocks();
    await backend.close();
  });
});

// ─── sweep() via fake timers ──────────────────────────────────────────────────

describe("MemoryBackend — sweep() via timer", () => {
  it("removes expired KV entries when the sweep timer fires", async () => {
    vi.useFakeTimers();

    const store = await createPersistenceStore({ type: "memory" });

    // Set a key with a short TTL (1 ms)
    await store.kv.set("ns", "expiring", "soon", { ttl: 1 });

    // Advance real time past the TTL so the entry is considered expired,
    // then advance fake timers to fire the 60-second sweep interval.
    // We need to manually let time pass for Date.now() to reflect the expiry.
    vi.setSystemTime(Date.now() + 5000);
    vi.advanceTimersByTime(60_001);

    // After sweep, the key should no longer be retrievable
    const val = await store.kv.get("ns", "expiring");
    expect(val).toBeNull();

    vi.useRealTimers();
    await store.close();
  });
});
