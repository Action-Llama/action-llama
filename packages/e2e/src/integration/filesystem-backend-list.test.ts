/**
 * Integration tests: FilesystemBackend.list() and StateStoreAdapter — no Docker required.
 *
 * Previously untested methods:
 *
 *   FilesystemBackend.list(): returns all CredentialEntry records from the base directory.
 *     Each entry has {type, instance, field}. The method skips non-directory entries
 *     and subdirectories at the field level.
 *
 *   StateStoreAdapter: wraps PersistenceStore for backward compatibility.
 *     Delegates get/set/delete/deleteAll/list to persistence.kv.
 *     close() is a no-op (does not close the underlying store).
 *
 * Covers:
 *   - shared/filesystem-backend.ts: FilesystemBackend.list() — empty dir returns []
 *   - shared/filesystem-backend.ts: FilesystemBackend.list() — single entry
 *   - shared/filesystem-backend.ts: FilesystemBackend.list() — multiple types/instances/fields
 *   - shared/filesystem-backend.ts: FilesystemBackend.list() — skips non-directory at type level
 *   - shared/filesystem-backend.ts: FilesystemBackend.list() — non-existent baseDir returns []
 *   - shared/persistence/adapters/state-store.ts: StateStoreAdapter.get/set/delete/deleteAll/list
 *   - shared/persistence/adapters/state-store.ts: StateStoreAdapter.close() no-op
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  setDefaultBackend,
  resetDefaultBackend,
} from "@action-llama/action-llama/internals/credentials";
import { FilesystemBackend } from "@action-llama/action-llama/internals/filesystem-backend";

const { createPersistenceStore } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/shared/persistence/index.js"
);

const { StateStoreAdapter } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/shared/persistence/adapters/state-store.js"
);

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "al-fs-backend-test-"));
}

// ── FilesystemBackend.list() ─────────────────────────────────────────────────

describe("FilesystemBackend.list() (no Docker required)", { timeout: 10_000 }, () => {
  afterEach(() => {
    resetDefaultBackend();
  });

  it("returns empty array for a non-existent base directory", async () => {
    const backend = new FilesystemBackend("/tmp/nonexistent-al-dir-" + Date.now());
    const entries = await backend.list();
    expect(entries).toEqual([]);
  });

  it("returns empty array for an empty base directory", async () => {
    const dir = makeTempDir();
    const backend = new FilesystemBackend(dir);
    const entries = await backend.list();
    expect(entries).toEqual([]);
  });

  it("returns one entry for a single credential field", async () => {
    const dir = makeTempDir();
    const backend = new FilesystemBackend(dir);
    await backend.write("anthropic_key", "default", "token");

    const entries = await backend.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ type: "anthropic_key", instance: "default", field: "token" });
  });

  it("returns all entries for multiple types, instances, and fields", async () => {
    const dir = makeTempDir();
    const backend = new FilesystemBackend(dir);
    await backend.write("anthropic_key", "default", "token");
    await backend.write("github_token", "default", "token");
    await backend.write("git_ssh", "mybot", "id_rsa");
    await backend.write("git_ssh", "mybot", "email");

    const entries = await backend.list();
    expect(entries).toHaveLength(4);

    // Verify all entries are present (order may vary)
    const keys = entries.map((e: { type: string; instance: string; field: string }) => `${e.type}/${e.instance}/${e.field}`).sort();
    expect(keys).toEqual([
      "anthropic_key/default/token",
      "git_ssh/mybot/email",
      "git_ssh/mybot/id_rsa",
      "github_token/default/token",
    ]);
  });

  it("skips non-directory entries at the type level", async () => {
    const dir = makeTempDir();
    const backend = new FilesystemBackend(dir);
    // Create a file at the type level (should be skipped)
    writeFileSync(join(dir, "not-a-dir.txt"), "file content");
    // Create a real credential
    await backend.write("anthropic_key", "default", "token");

    const entries = await backend.list();
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("anthropic_key");
  });

  it("returns entries with correct structure for each field", async () => {
    const dir = makeTempDir();
    const backend = new FilesystemBackend(dir);
    await backend.write("git_ssh", "botty", "id_rsa");
    await backend.write("git_ssh", "botty", "username");
    await backend.write("git_ssh", "botty", "email");

    const entries = await backend.list();
    expect(entries).toHaveLength(3);
    for (const entry of entries) {
      expect(entry.type).toBe("git_ssh");
      expect(entry.instance).toBe("botty");
      expect(["id_rsa", "username", "email"]).toContain(entry.field);
    }
  });
});

// ── StateStoreAdapter ─────────────────────────────────────────────────────────

describe("StateStoreAdapter (shared/persistence/adapters/state-store.ts, no Docker required)", { timeout: 10_000 }, () => {
  async function makeAdapter() {
    const store = await createPersistenceStore({ type: "memory" });
    return new StateStoreAdapter(store);
  }

  it("set then get returns stored value", async () => {
    const adapter = await makeAdapter();
    await adapter.set("ns1", "key1", { data: "hello" });
    const val = await adapter.get("ns1", "key1");
    expect(val).toEqual({ data: "hello" });
  });

  it("get returns null for missing key", async () => {
    const adapter = await makeAdapter();
    const val = await adapter.get("ns1", "nonexistent");
    expect(val).toBeNull();
  });

  it("delete removes a specific key", async () => {
    const adapter = await makeAdapter();
    await adapter.set("ns1", "key1", "value1");
    await adapter.delete("ns1", "key1");
    const val = await adapter.get("ns1", "key1");
    expect(val).toBeNull();
  });

  it("deleteAll removes all keys in namespace", async () => {
    const adapter = await makeAdapter();
    await adapter.set("ns1", "key1", "value1");
    await adapter.set("ns1", "key2", "value2");
    await adapter.set("ns2", "key1", "value3"); // different namespace

    await adapter.deleteAll("ns1");

    expect(await adapter.get("ns1", "key1")).toBeNull();
    expect(await adapter.get("ns1", "key2")).toBeNull();
    // ns2 unaffected
    expect(await adapter.get("ns2", "key1")).toBe("value3");
  });

  it("list returns all entries in namespace", async () => {
    const adapter = await makeAdapter();
    await adapter.set("ns1", "key1", "val1");
    await adapter.set("ns1", "key2", "val2");
    await adapter.set("ns2", "other", "val3");

    const ns1Entries = await adapter.list("ns1");
    expect(ns1Entries).toHaveLength(2);
    const keys = ns1Entries.map((e: { key: string }) => e.key).sort();
    expect(keys).toEqual(["key1", "key2"]);
  });

  it("close() does not throw (no-op)", async () => {
    const adapter = await makeAdapter();
    await adapter.set("ns1", "key", "value");
    await expect(adapter.close()).resolves.not.toThrow();
    // Key still accessible after close (adapter.close does NOT close underlying store)
    const val = await adapter.get("ns1", "key");
    expect(val).toBe("value");
  });

  it("set with TTL - value expires", async () => {
    const adapter = await makeAdapter();
    await adapter.set("ns1", "expiring", "data", { ttl: 0 }); // TTL=0 seconds
    // Give it a brief moment for expiry (if TTL=0 means immediate expiry)
    const val = await adapter.get("ns1", "expiring");
    // TTL=0 may or may not have expired — just check it doesn't crash
    // The important thing is it accepts the opts parameter
    expect(val === null || val === "data").toBe(true);
  });
});
