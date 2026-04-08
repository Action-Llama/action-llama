/**
 * Integration tests: shared/state-store-sqlite.ts SqliteStateStore — no Docker required.
 *
 * SqliteStateStore is a SQLite-backed persistent key-value store with namespaces
 * and optional TTL expiry. It implements the StateStore interface and is used
 * for the container registry, lock store, and call entries.
 *
 * None of the existing integration tests exercise SqliteStateStore directly —
 * it is only used through the scheduler which requires Docker. This test file
 * creates the store directly from the dist file.
 *
 * Methods tested:
 *   - constructor(dbPath) — creates own DB, applies migrations
 *   - set(ns, key, value) — persists JSON value
 *   - get(ns, key) — retrieves value, returns null for missing
 *   - get with TTL — returns null when expired
 *   - delete(ns, key) — removes single entry
 *   - deleteAll(ns) — removes all entries in namespace
 *   - list(ns) — returns all non-expired entries in namespace
 *   - sweep() — deletes expired rows, returns change count
 *   - close() — clears sweep timer, closes owned connection
 *   - namespace isolation — same key in different namespaces are independent
 *   - TTL: set with ttl then get after expiry returns null
 *   - TTL: list excludes expired entries
 *
 * Covers:
 *   - shared/state-store-sqlite.ts: SqliteStateStore constructor (string path)
 *   - shared/state-store-sqlite.ts: get() present/missing/expired
 *   - shared/state-store-sqlite.ts: set() insert/upsert, with/without TTL
 *   - shared/state-store-sqlite.ts: delete() removes specific key
 *   - shared/state-store-sqlite.ts: deleteAll() removes all keys in ns
 *   - shared/state-store-sqlite.ts: list() filters expired entries
 *   - shared/state-store-sqlite.ts: sweep() removes expired rows
 *   - shared/state-store-sqlite.ts: close() teardown without error
 *   - shared/state-store-sqlite.ts: namespace isolation
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const { SqliteStateStore } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/shared/state-store-sqlite.js"
);

function makeTempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "al-state-store-test-"));
  return join(dir, "state.db");
}

describe("integration: shared/state-store-sqlite.ts SqliteStateStore (no Docker required)", { timeout: 30_000 }, () => {

  it("set then get returns the stored value", async () => {
    const store = new SqliteStateStore(makeTempDbPath());
    await store.set("ns1", "key1", { hello: "world" });
    const val = await store.get("ns1", "key1");
    expect(val).toEqual({ hello: "world" });
    await store.close();
  });

  it("get returns null for missing key", async () => {
    const store = new SqliteStateStore(makeTempDbPath());
    const val = await store.get("ns1", "nonexistent");
    expect(val).toBeNull();
    await store.close();
  });

  it("set overwrites an existing value (upsert)", async () => {
    const store = new SqliteStateStore(makeTempDbPath());
    await store.set("ns1", "key1", "original");
    await store.set("ns1", "key1", "updated");
    const val = await store.get("ns1", "key1");
    expect(val).toBe("updated");
    await store.close();
  });

  it("delete removes the specified key", async () => {
    const store = new SqliteStateStore(makeTempDbPath());
    await store.set("ns1", "key1", "to-delete");
    await store.set("ns1", "key2", "keep");
    await store.delete("ns1", "key1");

    expect(await store.get("ns1", "key1")).toBeNull();
    expect(await store.get("ns1", "key2")).toBe("keep");
    await store.close();
  });

  it("delete is a no-op for non-existent key", async () => {
    const store = new SqliteStateStore(makeTempDbPath());
    // Should not throw
    await expect(store.delete("ns1", "does-not-exist")).resolves.toBeUndefined();
    await store.close();
  });

  it("deleteAll removes all entries in the namespace", async () => {
    const store = new SqliteStateStore(makeTempDbPath());
    await store.set("ns-to-clear", "k1", "v1");
    await store.set("ns-to-clear", "k2", "v2");
    await store.set("ns-other", "k1", "keep");

    await store.deleteAll("ns-to-clear");

    expect(await store.get("ns-to-clear", "k1")).toBeNull();
    expect(await store.get("ns-to-clear", "k2")).toBeNull();
    // Other namespace unaffected
    expect(await store.get("ns-other", "k1")).toBe("keep");
    await store.close();
  });

  it("list returns all non-expired entries in the namespace", async () => {
    const store = new SqliteStateStore(makeTempDbPath());
    await store.set("ns-list", "alpha", 1);
    await store.set("ns-list", "beta", 2);
    await store.set("ns-other", "gamma", 3);

    const entries = await store.list("ns-list");
    expect(entries.length).toBe(2);
    const keys = entries.map((e: { key: string }) => e.key).sort();
    expect(keys).toEqual(["alpha", "beta"]);
    const values = Object.fromEntries(entries.map((e: { key: string; value: unknown }) => [e.key, e.value]));
    expect(values["alpha"]).toBe(1);
    expect(values["beta"]).toBe(2);

    await store.close();
  });

  it("list returns empty array for empty namespace", async () => {
    const store = new SqliteStateStore(makeTempDbPath());
    const entries = await store.list("empty-ns");
    expect(entries).toEqual([]);
    await store.close();
  });

  it("namespace isolation — same key in different namespaces are independent", async () => {
    const store = new SqliteStateStore(makeTempDbPath());
    await store.set("ns-a", "shared-key", "value-a");
    await store.set("ns-b", "shared-key", "value-b");

    expect(await store.get("ns-a", "shared-key")).toBe("value-a");
    expect(await store.get("ns-b", "shared-key")).toBe("value-b");

    await store.delete("ns-a", "shared-key");
    expect(await store.get("ns-a", "shared-key")).toBeNull();
    expect(await store.get("ns-b", "shared-key")).toBe("value-b"); // unaffected

    await store.close();
  });

  it("set with ttl=1 makes the entry expire after 1 second", async () => {
    const store = new SqliteStateStore(makeTempDbPath());
    await store.set("ns-ttl", "expire-key", "temporary", { ttl: 1 });

    // Should still be present immediately
    expect(await store.get("ns-ttl", "expire-key")).toBe("temporary");

    // Wait 1.1 seconds for expiry
    await new Promise((r) => setTimeout(r, 1100));

    // Should now be null (TTL expired)
    const val = await store.get("ns-ttl", "expire-key");
    expect(val).toBeNull();

    await store.close();
  }, 15_000); // extra timeout for sleep

  it("list excludes entries that have expired via TTL", async () => {
    const store = new SqliteStateStore(makeTempDbPath());
    await store.set("ns-ttl-list", "persistent", "stays", { ttl: 3600 });
    await store.set("ns-ttl-list", "expiring", "goes", { ttl: 1 });

    // Wait for expiry
    await new Promise((r) => setTimeout(r, 1100));

    const entries = await store.list("ns-ttl-list");
    const keys = entries.map((e: { key: string }) => e.key);
    expect(keys).toContain("persistent");
    expect(keys).not.toContain("expiring");

    await store.close();
  }, 15_000);

  it("sweep deletes expired rows and returns the count of deleted rows", async () => {
    const store = new SqliteStateStore(makeTempDbPath());
    await store.set("ns-sweep", "a", "v1", { ttl: 1 });
    await store.set("ns-sweep", "b", "v2", { ttl: 1 });
    await store.set("ns-sweep", "c", "v3", { ttl: 3600 }); // non-expiring

    // Wait for expiry
    await new Promise((r) => setTimeout(r, 1100));

    const deleted = store.sweep();
    expect(deleted).toBe(2); // a and b expired

    // c is still present
    expect(await store.get("ns-sweep", "c")).toBe("v3");

    await store.close();
  }, 15_000);

  it("sweep returns 0 when no entries are expired", async () => {
    const store = new SqliteStateStore(makeTempDbPath());
    await store.set("ns1", "k1", "v1");
    const deleted = store.sweep();
    expect(deleted).toBe(0);
    await store.close();
  });

  it("set and get work with complex object values", async () => {
    const store = new SqliteStateStore(makeTempDbPath());
    const payload = {
      agentName: "worker",
      context: { nested: true, values: [1, 2, 3] },
      timestamp: 12345678,
    };
    await store.set("registry", "instance-001", payload);
    const result = await store.get("registry", "instance-001");
    expect(result).toEqual(payload);
    await store.close();
  });

  it("close() resolves without error when ownDb=true", async () => {
    const store = new SqliteStateStore(makeTempDbPath());
    await store.set("ns", "k", "v");
    await expect(store.close()).resolves.toBeUndefined();
  });
});
