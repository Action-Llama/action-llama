import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { SqliteStateStore } from "../../src/shared/state-store-sqlite.js";

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
});
