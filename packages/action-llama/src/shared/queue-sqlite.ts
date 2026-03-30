import { eq, and, asc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { createDb } from "../db/connection.js";
import { applyMigrations } from "../db/migrate.js";
import { queueTable } from "../db/schema.js";
import type { AppDb } from "../db/connection.js";
import type { Queue, QueueItem } from "./queue.js";

/**
 * SQLite-backed Queue using Drizzle ORM.
 *
 * All queue instances sharing a connection use a single `queue` table,
 * differentiated by a `name` column — the same pattern SqliteStateStore
 * uses for namespaces.
 *
 * Uses better-sqlite3 for fast, synchronous, embedded storage.
 * The async interface is preserved for compatibility with future
 * remote-backed implementations (e.g., PostgreSQL).
 *
 * Dequeue is atomic: a transaction selects and deletes the head rows
 * so concurrent readers (if any) cannot claim the same items.
 *
 * Supports two constructor signatures:
 *   new SqliteQueue(dbPath: string, name)  — creates its own connection (backward compat)
 *   new SqliteQueue(db: AppDb, name)        — uses a shared connection (preferred)
 */
export class SqliteQueue<T> implements Queue<T> {
  private db: AppDb;
  private ownDb: boolean;
  private readonly name: string;
  private _dequeueTransaction: (name: string, limit: number) => Array<{
    id: string;
    payload: string;
    enqueued_at: number;
  }>;

  constructor(dbOrPath: string | AppDb, name: string) {
    this.name = name;

    if (typeof dbOrPath === "string") {
      this.db = createDb(dbOrPath);
      this.ownDb = true;
      applyMigrations(this.db);
    } else {
      this.db = dbOrPath;
      this.ownDb = false;
    }

    const client = (this.db as any).$client;

    // Pre-compiled transaction for atomic dequeue (select + delete in one shot).
    this._dequeueTransaction = client.transaction(
      (queueName: string, limit: number) => {
        const rows = client
          .prepare("SELECT id, payload, enqueued_at FROM queue WHERE name = ? ORDER BY rowid ASC LIMIT ?")
          .all(queueName, limit) as Array<{ id: string; payload: string; enqueued_at: number }>;
        for (const row of rows) {
          client.prepare("DELETE FROM queue WHERE name = ? AND id = ?").run(queueName, row.id);
        }
        return rows;
      }
    );
  }

  async enqueue(payload: T): Promise<string> {
    const id = randomUUID();
    this.db.insert(queueTable).values({
      id,
      name: this.name,
      payload: JSON.stringify(payload),
      enqueuedAt: Date.now(),
    }).run();
    return id;
  }

  async dequeue(limit = 1): Promise<QueueItem<T>[]> {
    const rows = this._dequeueTransaction(this.name, limit);
    return rows.map((r) => ({
      id: r.id,
      payload: JSON.parse(r.payload) as T,
      enqueuedAt: r.enqueued_at,
    }));
  }

  async peek(limit = 1): Promise<QueueItem<T>[]> {
    const rows = (this.db as any).$client
      .prepare("SELECT id, payload, enqueued_at FROM queue WHERE name = ? ORDER BY rowid ASC LIMIT ?")
      .all(this.name, limit) as Array<{ id: string; payload: string; enqueued_at: number }>;
    return rows.map((r) => ({
      id: r.id,
      payload: JSON.parse(r.payload) as T,
      enqueuedAt: r.enqueued_at,
    }));
  }

  async size(): Promise<number> {
    const row = (this.db as any).$client
      .prepare("SELECT COUNT(*) AS n FROM queue WHERE name = ?")
      .get(this.name) as { n: number };
    return row.n;
  }

  async close(): Promise<void> {
    if (this.ownDb) {
      (this.db as any).$client.close();
    }
  }
}
