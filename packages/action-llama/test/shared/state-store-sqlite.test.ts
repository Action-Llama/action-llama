import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { SqliteStateStore } from "../../src/shared/state-store-sqlite.js";
import { createDb } from "../../src/db/connection.js";
import { applyMigrations } from "../../src/db/migrate.js";

describe("SqliteStateStore", () => {
  const dirs: string[] = [];

  function createStore(): SqliteStateStore {
    const dir = mkdtempSync(join(tmpdir(), "al-state-"));
    dirs.push(dir);
    return new SqliteStateStore(join(dir, "state.db"));
  }

  afterEach(async () => {
    for (const dir of dirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it("get returns null for missing key", async () => {
    const store = createStore();
    expect(await store.get("ns", "missing")).toBeNull();
    await store.close();
  });

  it("set and get round-trips JSON values", async () => {
    const store = createStore();
    await store.set("ns", "key1", { hello: "world", n: 42 });
    expect(await store.get("ns", "key1")).toEqual({ hello: "world", n: 42 });
    await store.close();
  });

  it("namespaces are isolated", async () => {
    const store = createStore();
    await store.set("a", "key", "val-a");
    await store.set("b", "key", "val-b");
    expect(await store.get("a", "key")).toBe("val-a");
    expect(await store.get("b", "key")).toBe("val-b");
    await store.close();
  });

  it("set overwrites existing key", async () => {
    const store = createStore();
    await store.set("ns", "key", "v1");
    await store.set("ns", "key", "v2");
    expect(await store.get("ns", "key")).toBe("v2");
    await store.close();
  });

  it("delete removes a key", async () => {
    const store = createStore();
    await store.set("ns", "key", "val");
    await store.delete("ns", "key");
    expect(await store.get("ns", "key")).toBeNull();
    await store.close();
  });

  it("deleteAll removes all keys in namespace", async () => {
    const store = createStore();
    await store.set("ns", "a", 1);
    await store.set("ns", "b", 2);
    await store.set("other", "c", 3);
    await store.deleteAll("ns");
    expect(await store.get("ns", "a")).toBeNull();
    expect(await store.get("ns", "b")).toBeNull();
    expect(await store.get("other", "c")).toBe(3);
    await store.close();
  });

  it("list returns all entries in namespace", async () => {
    const store = createStore();
    await store.set("ns", "a", 1);
    await store.set("ns", "b", 2);
    await store.set("other", "c", 3);
    const entries = await store.list("ns");
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.key).sort()).toEqual(["a", "b"]);
    await store.close();
  });

  it("expired entries are not returned by get", async () => {
    const store = createStore();
    // TTL of 0 seconds = already expired by next read
    await store.set("ns", "key", "val", { ttl: -1 });
    expect(await store.get("ns", "key")).toBeNull();
    await store.close();
  });

  it("expired entries are not returned by list", async () => {
    const store = createStore();
    await store.set("ns", "live", "yes", { ttl: 3600 });
    await store.set("ns", "dead", "no", { ttl: -1 });
    const entries = await store.list("ns");
    expect(entries).toHaveLength(1);
    expect(entries[0].key).toBe("live");
    await store.close();
  });

  it("sweep removes expired rows", async () => {
    const store = createStore();
    await store.set("ns", "expired", "gone", { ttl: -1 });
    await store.set("ns", "alive", "here", { ttl: 3600 });
    const removed = store.sweep();
    expect(removed).toBe(1);
    expect(await store.get("ns", "alive")).toBe("here");
    await store.close();
  });

  it("calls unref on the sweep timer when available", async () => {
    const unrefSpy = vi.fn();
    const origSetInterval = globalThis.setInterval;
    // Override setInterval to return a timer with a spy on unref
    const fakeTimer = { unref: unrefSpy } as any;
    vi.spyOn(globalThis, "setInterval" as any).mockReturnValueOnce(fakeTimer);

    const store = createStore();

    expect(unrefSpy).toHaveBeenCalledOnce();
    await store.close();
    vi.restoreAllMocks();
  });

  it("sweep timer callback fires and removes expired entries when interval elapses", async () => {
    // Use fake timers so we can advance time without waiting
    vi.useFakeTimers({ now: Date.now() });

    const store = createStore();
    // Insert an already-expired entry and a live entry
    await store.set("ns", "expired", "gone", { ttl: -1 });
    await store.set("ns", "alive", "here", { ttl: 3600 });

    // Advance fake timers by 60 seconds to fire the sweep interval callback
    vi.advanceTimersByTime(60_000);

    // The callback () => this.sweep() should have run, removing the expired row
    expect(await store.get("ns", "expired")).toBeNull();
    expect(await store.get("ns", "alive")).toBe("here");

    vi.useRealTimers();
    await store.close();
  });

  it("accepts a shared AppDb connection and does not close it on close()", async () => {
    const dir = mkdtempSync(join(tmpdir(), "al-state-shared-"));
    dirs.push(dir);

    const db = createDb(join(dir, "shared.db"));
    applyMigrations(db);

    const closeSpy = vi.spyOn((db as any).$client, "close");

    const store = new SqliteStateStore(db);
    await store.set("ns", "k", "v");
    expect(await store.get("ns", "k")).toBe("v");

    // Closing a store with a shared db must NOT close the underlying db
    await store.close();
    expect(closeSpy).not.toHaveBeenCalled();

    closeSpy.mockRestore();
    (db as any).$client.close();
  });

  it("does not call unref when timer has no unref method", () => {
    const origSetInterval = globalThis.setInterval;
    // Return a timer without an unref property
    const fakeTimer = {} as any;
    vi.spyOn(globalThis, "setInterval" as any).mockReturnValueOnce(fakeTimer);

    // Should not throw even though fakeTimer.unref is undefined
    const store = new SqliteStateStore(":memory:");
    expect(store).toBeDefined();
    store.close();

    vi.restoreAllMocks();
  });
});
