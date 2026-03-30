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
