/**
 * Integration tests: shared/persistence/index.ts PersistenceStore.query.sql() — no Docker required.
 *
 * PersistenceStore exposes a `query.sql()` method that delegates to the backend's
 * `querySql()` implementation. This is never tested in the existing
 * persistence-layer.test.ts which only tests kv and events operations.
 *
 * Two backend behaviors:
 *
 *   1. MemoryBackend.querySql() — always throws "SQL queries are not supported in
 *      memory backend". This documents the limitation.
 *
 *   2. SqliteBackend.querySql() — executes a real SQL query against the SQLite
 *      database via better-sqlite3's `prepare().all()`. Returns an array of rows.
 *      - Valid query returns results
 *      - Invalid SQL throws Error with "SQL query failed:"
 *      - Query with params works
 *
 * Covers:
 *   - shared/persistence/backends/memory.ts: MemoryBackend.querySql() — throws not-supported Error
 *   - shared/persistence/backends/sqlite.ts: SqliteBackend.querySql() — valid SQL returns rows
 *   - shared/persistence/backends/sqlite.ts: SqliteBackend.querySql() — invalid SQL throws "SQL query failed"
 *   - shared/persistence/backends/sqlite.ts: SqliteBackend.querySql() — parameterized query returns rows
 *   - shared/persistence/index.ts: PersistenceStore.query.sql() delegates to backend querySql
 *   - shared/persistence/index.ts: PersistenceStore.query.sql() memory backend → throws
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const { createPersistenceStore } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/shared/persistence/index.js"
);

function makeTempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "al-persistence-sql-test-"));
  return join(dir, "persistence.db");
}

// ─── MemoryBackend.querySql() ─────────────────────────────────────────────────

describe(
  "integration: PersistenceStore.query.sql() — MemoryBackend (no Docker required)",
  { timeout: 10_000 },
  () => {
    it("query.sql() on memory backend throws 'not supported' error", async () => {
      const store = await createPersistenceStore({ type: "memory" });
      await expect(store.query.sql("SELECT 1")).rejects.toThrow(Error);
      await store.close();
    });

    it("query.sql() on memory backend error mentions 'memory backend'", async () => {
      const store = await createPersistenceStore({ type: "memory" });
      let caught: Error | undefined;
      try {
        await store.query.sql("SELECT 1");
      } catch (err: unknown) {
        caught = err as Error;
      }
      expect(caught).toBeDefined();
      expect(caught!.message).toMatch(/memory/i);
      await store.close();
    });

    it("query.sql() on memory backend error mentions 'SQL'", async () => {
      const store = await createPersistenceStore({ type: "memory" });
      await expect(store.query.sql("SELECT 1")).rejects.toThrow(/SQL/);
      await store.close();
    });
  },
);

// ─── SqliteBackend.querySql() ─────────────────────────────────────────────────

describe(
  "integration: PersistenceStore.query.sql() — SqliteBackend (no Docker required)",
  { timeout: 10_000 },
  () => {
    it("valid SQL query 'SELECT 1 AS n' returns row with n=1", async () => {
      const store = await createPersistenceStore({ type: "sqlite", path: makeTempDbPath() });
      const rows = await store.query.sql<{ n: number }>("SELECT 1 AS n");
      expect(Array.isArray(rows)).toBe(true);
      expect(rows.length).toBe(1);
      expect(rows[0].n).toBe(1);
      await store.close();
    });

    it("invalid SQL throws Error with 'SQL query failed' prefix", async () => {
      const store = await createPersistenceStore({ type: "sqlite", path: makeTempDbPath() });
      await expect(store.query.sql("SELECT * FROM nonexistent_table_xyz")).rejects.toThrow(
        /SQL query failed/,
      );
      await store.close();
    });

    it("invalid SQL error is an Error instance", async () => {
      const store = await createPersistenceStore({ type: "sqlite", path: makeTempDbPath() });
      await expect(store.query.sql("NOT VALID SQL !!!")).rejects.toThrow(Error);
      await store.close();
    });

    it("parameterized query with single param returns filtered results", async () => {
      const store = await createPersistenceStore({ type: "sqlite", path: makeTempDbPath() });
      // Use SQLite's built-in sqlite_master to avoid schema dependency
      const rows = await store.query.sql<{ val: number }>(
        "SELECT ? AS val",
        [42]
      );
      expect(Array.isArray(rows)).toBe(true);
      expect(rows.length).toBe(1);
      expect(rows[0].val).toBe(42);
      await store.close();
    });

    it("query returns empty array when no rows match", async () => {
      const store = await createPersistenceStore({ type: "sqlite", path: makeTempDbPath() });
      // Query SQLite's built-in table for a type that won't exist
      const rows = await store.query.sql<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='definitely_nonexistent_xyz'"
      );
      expect(Array.isArray(rows)).toBe(true);
      expect(rows.length).toBe(0);
      await store.close();
    });

    it("query.sql() result is same type as returned array", async () => {
      const store = await createPersistenceStore({ type: "sqlite", path: makeTempDbPath() });
      const rows = await store.query.sql("SELECT 1 AS a, 2 AS b");
      expect(rows).toBeInstanceOf(Array);
      await store.close();
    });
  },
);
