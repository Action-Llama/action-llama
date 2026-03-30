import { eq, and, or, isNull, gt, lte, isNotNull } from "drizzle-orm";
import { createDb } from "../db/connection.js";
import { applyMigrations } from "../db/migrate.js";
import { stateTable } from "../db/schema.js";
import type { AppDb } from "../db/connection.js";
import type { StateStore } from "./state-store.js";

/**
 * SQLite-backed StateStore for local mode.
 *
 * Uses Drizzle ORM with better-sqlite3 for fast, synchronous, embedded storage.
 * The async interface is preserved for API compatibility with the
 * DynamoDB backend — all operations resolve immediately.
 *
 * Supports two constructor signatures:
 *   new SqliteStateStore(dbPath: string)   — creates its own connection (backward compat)
 *   new SqliteStateStore(db: AppDb)        — uses a shared connection (preferred)
 */
export class SqliteStateStore implements StateStore {
  private db: AppDb;
  private ownDb: boolean;
  private sweepTimer: ReturnType<typeof setInterval> | undefined;

  constructor(dbOrPath: string | AppDb) {
    if (typeof dbOrPath === "string") {
      this.db = createDb(dbOrPath);
      this.ownDb = true;
      applyMigrations(this.db);
    } else {
      this.db = dbOrPath;
      this.ownDb = false;
    }

    // Periodic sweep of expired rows (every 60 s).
    this.sweepTimer = setInterval(() => this.sweep(), 60_000);
    if (this.sweepTimer.unref) this.sweepTimer.unref();
  }

  async get<T>(ns: string, key: string): Promise<T | null> {
    const now = nowSec();
    const rows = this.db
      .select({ value: stateTable.value })
      .from(stateTable)
      .where(
        and(
          eq(stateTable.ns, ns),
          eq(stateTable.key, key),
          or(isNull(stateTable.expiresAt), gt(stateTable.expiresAt, now))
        )
      )
      .all();
    const row = rows[0];
    return row ? (JSON.parse(row.value) as T) : null;
  }

  async set<T>(ns: string, key: string, value: T, opts?: { ttl?: number }): Promise<void> {
    const expiresAt = opts?.ttl ? nowSec() + opts.ttl : null;
    this.db
      .insert(stateTable)
      .values({ ns, key, value: JSON.stringify(value), expiresAt })
      .onConflictDoUpdate({
        target: [stateTable.ns, stateTable.key],
        set: { value: JSON.stringify(value), expiresAt },
      })
      .run();
  }

  async delete(ns: string, key: string): Promise<void> {
    this.db
      .delete(stateTable)
      .where(and(eq(stateTable.ns, ns), eq(stateTable.key, key)))
      .run();
  }

  async deleteAll(ns: string): Promise<void> {
    this.db.delete(stateTable).where(eq(stateTable.ns, ns)).run();
  }

  async list<T>(ns: string): Promise<Array<{ key: string; value: T }>> {
    const now = nowSec();
    const rows = this.db
      .select({ key: stateTable.key, value: stateTable.value })
      .from(stateTable)
      .where(
        and(
          eq(stateTable.ns, ns),
          or(isNull(stateTable.expiresAt), gt(stateTable.expiresAt, now))
        )
      )
      .all();
    return rows.map((r) => ({ key: r.key, value: JSON.parse(r.value) as T }));
  }

  /** Remove expired rows. Returns the number of rows deleted. */
  sweep(): number {
    const now = nowSec();
    const result = this.db
      .delete(stateTable)
      .where(and(isNotNull(stateTable.expiresAt), lte(stateTable.expiresAt, now)))
      .run();
    return result.changes;
  }

  async close(): Promise<void> {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
    if (this.ownDb) {
      (this.db as any).$client.close();
    }
  }
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}
