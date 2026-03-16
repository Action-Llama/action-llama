import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";
import type { StateStore } from "./state-store.js";

/**
 * SQLite-backed StateStore for local mode.
 *
 * Uses better-sqlite3 for fast, synchronous, embedded storage.
 * The async interface is preserved for API compatibility with the
 * DynamoDB backend — all operations resolve immediately.
 */
export class SqliteStateStore implements StateStore {
  private db: InstanceType<typeof Database>;
  // better-sqlite3 generic Statement types don't compose with ReturnType<>;
  // the public StateStore interface provides the type safety boundary.
  private stmts: any;
  private sweepTimer: ReturnType<typeof setInterval> | undefined;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS state (
        ns    TEXT NOT NULL,
        key   TEXT NOT NULL,
        value TEXT NOT NULL,
        expires_at INTEGER,
        PRIMARY KEY (ns, key)
      )
    `);
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_state_expires ON state(expires_at) WHERE expires_at IS NOT NULL"
    );

    // Prepare statements once for performance.
    this.stmts = {
      get: this.db.prepare(
        "SELECT value FROM state WHERE ns = ? AND key = ? AND (expires_at IS NULL OR expires_at > ?)"
      ),
      set: this.db.prepare(
        "INSERT OR REPLACE INTO state (ns, key, value, expires_at) VALUES (?, ?, ?, ?)"
      ),
      del: this.db.prepare("DELETE FROM state WHERE ns = ? AND key = ?"),
      delAll: this.db.prepare("DELETE FROM state WHERE ns = ?"),
      list: this.db.prepare(
        "SELECT key, value FROM state WHERE ns = ? AND (expires_at IS NULL OR expires_at > ?)"
      ),
      sweep: this.db.prepare(
        "DELETE FROM state WHERE expires_at IS NOT NULL AND expires_at <= ?"
      ),
    };

    // Periodic sweep of expired rows (every 60 s).
    this.sweepTimer = setInterval(() => this.sweep(), 60_000);
    if (this.sweepTimer.unref) this.sweepTimer.unref();
  }

  async get<T>(ns: string, key: string): Promise<T | null> {
    const row = this.stmts.get.get(ns, key, nowSec()) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : null;
  }

  async set<T>(ns: string, key: string, value: T, opts?: { ttl?: number }): Promise<void> {
    const expiresAt = opts?.ttl ? nowSec() + opts.ttl : null;
    this.stmts.set.run(ns, key, JSON.stringify(value), expiresAt);
  }

  async delete(ns: string, key: string): Promise<void> {
    this.stmts.del.run(ns, key);
  }

  async deleteAll(ns: string): Promise<void> {
    this.stmts.delAll.run(ns);
  }

  async list<T>(ns: string): Promise<Array<{ key: string; value: T }>> {
    const rows = this.stmts.list.all(ns, nowSec()) as Array<{ key: string; value: string }>;
    return rows.map((r) => ({ key: r.key, value: JSON.parse(r.value) as T }));
  }

  /** Remove expired rows. Returns the number of rows deleted. */
  sweep(): number {
    return (this.stmts.sweep.run(nowSec()) as { changes: number }).changes;
  }

  async close(): Promise<void> {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
    this.db.close();
  }
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}
