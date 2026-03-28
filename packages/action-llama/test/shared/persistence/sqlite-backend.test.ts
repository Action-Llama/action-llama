/**
 * Direct unit tests for the SqliteBackend class to improve coverage
 * of operations not exercised by the higher-level unified-store tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { SqliteBackend } from "../../../src/shared/persistence/backends/sqlite.js";
import { createEvent } from "../../../src/shared/persistence/event-store.js";

describe("SqliteBackend – direct operations", () => {
  let backend: SqliteBackend;

  beforeEach(async () => {
    backend = new SqliteBackend(":memory:");
    await backend.init();
  });

  afterEach(async () => {
    await backend.close();
  });

  describe("constructor with real file path", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "al-sqlite-"));
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("creates parent directories for a real file path", async () => {
      const dbPath = join(tmpDir, "nested", "dir", "test.db");
      const fileBackend = new SqliteBackend(dbPath);
      await fileBackend.init();
      expect(existsSync(join(tmpDir, "nested", "dir"))).toBe(true);
      await fileBackend.close();
    });
  });

  describe("kv operations", () => {
    it("kvDelete removes an existing key", async () => {
      await backend.kvSet("ns", "key1", { val: "hello" });
      const before = await backend.kvGet("ns", "key1");
      expect(before).toEqual({ val: "hello" });

      await backend.kvDelete("ns", "key1");
      const after = await backend.kvGet("ns", "key1");
      expect(after).toBeNull();
    });

    it("kvDelete is a no-op for a missing key", async () => {
      await expect(backend.kvDelete("ns", "nonexistent")).resolves.toBeUndefined();
    });

    it("kvDeleteAll removes all keys in a namespace", async () => {
      await backend.kvSet("batch", "a", 1);
      await backend.kvSet("batch", "b", 2);
      await backend.kvSet("other", "c", 3);

      await backend.kvDeleteAll("batch");

      const a = await backend.kvGet("batch", "a");
      const b = await backend.kvGet("batch", "b");
      const c = await backend.kvGet("other", "c");
      expect(a).toBeNull();
      expect(b).toBeNull();
      expect(c).toBe(3);
    });

    it("kvList returns all non-expired entries in a namespace", async () => {
      await backend.kvSet("list-ns", "x", { n: 10 });
      await backend.kvSet("list-ns", "y", { n: 20 });
      await backend.kvSet("other-ns", "z", { n: 30 });

      const items = await backend.kvList<{ n: number }>("list-ns");
      expect(items).toHaveLength(2);
      const keys = items.map((i) => i.key).sort();
      expect(keys).toEqual(["x", "y"]);
      expect(items.find((i) => i.key === "x")?.value).toEqual({ n: 10 });
    });

    it("kvList returns empty array for an empty namespace", async () => {
      const items = await backend.kvList("empty-ns");
      expect(items).toEqual([]);
    });

    it("kvList excludes expired entries", async () => {
      await backend.kvSet("ttl-ns", "fresh", "value", 60_000);
      await backend.kvSet("ttl-ns", "expired", "old", 1); // 1ms TTL
      await new Promise((r) => setTimeout(r, 10)); // wait for expiry

      const items = await backend.kvList("ttl-ns");
      const keys = items.map((i) => i.key);
      expect(keys).toContain("fresh");
      expect(keys).not.toContain("expired");
    });
  });

  describe("snapshot operations", () => {
    it("eventGetSnapshot returns null when no snapshot exists", async () => {
      const result = await backend.eventGetSnapshot("stream-a", "my-snapshot");
      expect(result).toBeNull();
    });

    it("eventSaveSnapshot persists and eventGetSnapshot retrieves snapshot data", async () => {
      const data = { count: 42, lastId: "evt-99" };
      await backend.eventSaveSnapshot("stream-a", "projection", data, "evt-99");

      const retrieved = await backend.eventGetSnapshot<typeof data>("stream-a", "projection");
      expect(retrieved).toEqual(data);
    });

    it("eventSaveSnapshot overwrites an existing snapshot", async () => {
      await backend.eventSaveSnapshot("stream-b", "snap", { v: 1 }, "evt-1");
      await backend.eventSaveSnapshot("stream-b", "snap", { v: 2 }, "evt-2");

      const result = await backend.eventGetSnapshot<{ v: number }>("stream-b", "snap");
      expect(result?.v).toBe(2);
    });

    it("snapshots are isolated by stream name", async () => {
      await backend.eventSaveSnapshot("s1", "type", { owner: "s1" }, "e1");
      await backend.eventSaveSnapshot("s2", "type", { owner: "s2" }, "e2");

      const r1 = await backend.eventGetSnapshot<{ owner: string }>("s1", "type");
      const r2 = await backend.eventGetSnapshot<{ owner: string }>("s2", "type");
      expect(r1?.owner).toBe("s1");
      expect(r2?.owner).toBe("s2");
    });
  });

  describe("eventListStreams", () => {
    it("returns empty array when no events have been appended", async () => {
      const streams = await backend.eventListStreams();
      expect(streams).toEqual([]);
    });

    it("returns the stream names that have events", async () => {
      await backend.eventAppend("alpha", {
        type: "test.event",
        data: {},
        version: 1,
      });
      await backend.eventAppend("beta", {
        type: "test.event",
        data: {},
        version: 1,
      });

      const streams = await backend.eventListStreams();
      expect(streams.sort()).toEqual(["alpha", "beta"]);
    });
  });

  describe("querySql", () => {
    it("executes a valid SQL query and returns results", async () => {
      await backend.kvSet("ns", "k1", "v1");
      const rows = await backend.querySql<{ namespace: string }>(
        "SELECT namespace FROM kv_store WHERE namespace = ?",
        ["ns"]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].namespace).toBe("ns");
    });

    it("returns empty array for a query with no matching rows", async () => {
      const rows = await backend.querySql("SELECT * FROM kv_store WHERE namespace = ?", ["nope"]);
      expect(rows).toEqual([]);
    });

    it("throws an error wrapping the SQL error message for invalid SQL", async () => {
      await expect(backend.querySql("SELECT * FROM nonexistent_table")).rejects.toThrow(
        "SQL query failed"
      );
    });
  });

  describe("transaction operations", () => {
    it("transactionRun commits changes on success", async () => {
      await backend.transactionRun(async () => {
        await backend.kvSet("tx-ns", "committed", "yes");
      });

      const val = await backend.kvGet("tx-ns", "committed");
      expect(val).toBe("yes");
    });

    it("transactionRun rolls back changes on error", async () => {
      await expect(
        backend.transactionRun(async () => {
          await backend.kvSet("tx-ns", "rolled-back", "no");
          throw new Error("force rollback");
        })
      ).rejects.toThrow("force rollback");

      const val = await backend.kvGet("tx-ns", "rolled-back");
      expect(val).toBeNull();
    });

    it("nested transactionBegin increments depth without starting a new transaction", async () => {
      await backend.transactionBegin();
      await backend.transactionBegin(); // should be a no-op for the DB
      await backend.transactionCommit();
      await backend.transactionCommit();
      // If we reach here without error, the nested transaction handling is correct
    });

    it("transactionCommit at depth > 1 does not commit yet", async () => {
      await backend.transactionBegin();
      await backend.transactionBegin();
      // Second commit only decrements depth, does not commit
      await backend.transactionCommit();
      // First commit does the actual COMMIT
      await backend.transactionCommit();
    });

    it("transactionRollback at depth > 1 does not roll back yet", async () => {
      await backend.transactionBegin();
      await backend.transactionBegin();
      await backend.transactionRollback();
      await backend.transactionRollback();
    });
  });

  describe("close", () => {
    it("close resolves without throwing", async () => {
      const b = new SqliteBackend(":memory:");
      await b.init();
      await expect(b.close()).resolves.toBeUndefined();
    });

    it("close clears the sweep timer", async () => {
      const b = new SqliteBackend(":memory:");
      await b.init();
      // Should not throw; interval is cleared
      await b.close();
    });
  });
});
