import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { randomUUID } from "crypto";
import type { Queue, QueueItem } from "./queue.js";

/**
 * SQLite-backed Queue.
 *
 * All queue instances sharing a file use a single `queue` table,
 * differentiated by a `name` column — the same pattern SqliteStateStore
 * uses for namespaces.
 *
 * Uses better-sqlite3 for fast, synchronous, embedded storage.
 * The async interface is preserved for compatibility with future
 * remote-backed implementations (e.g., PostgreSQL).
 *
 * Dequeue is atomic: a transaction selects and deletes the head rows
 * so concurrent readers (if any) cannot claim the same items.
 */
export class SqliteQueue<T> implements Queue<T> {
  private db: InstanceType<typeof Database>;
  // better-sqlite3 generic Statement types don't compose with ReturnType<>;
  // the public Queue interface provides the type safety boundary.
  private stmts: any;
  private readonly name: string;
  private _dequeueTransaction: (name: string, limit: number) => Array<{
    id: string;
    payload: string;
    enqueued_at: number;
  }>;

  constructor(dbPath: string, name: string) {
    this.name = name;
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS queue (
        id          TEXT NOT NULL,
        name        TEXT NOT NULL,
        payload     TEXT NOT NULL,
        enqueued_at INTEGER NOT NULL,
        PRIMARY KEY (name, id)
      )
    `);
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_queue_name ON queue(name)"
    );

    // Prepare statements once for performance.
    this.stmts = {
      enqueue: this.db.prepare(
        "INSERT INTO queue (id, name, payload, enqueued_at) VALUES (?, ?, ?, ?)"
      ),
      peek: this.db.prepare(
        "SELECT id, payload, enqueued_at FROM queue WHERE name = ? ORDER BY rowid ASC LIMIT ?"
      ),
      delete: this.db.prepare("DELETE FROM queue WHERE name = ? AND id = ?"),
      size: this.db.prepare("SELECT COUNT(*) AS n FROM queue WHERE name = ?"),
    };

    // Pre-compiled transaction for atomic dequeue (select + delete in one shot).
    this._dequeueTransaction = this.db.transaction(
      (name: string, limit: number) => {
        const rows = this.stmts.peek.all(name, limit) as Array<{
          id: string;
          payload: string;
          enqueued_at: number;
        }>;
        for (const row of rows) {
          this.stmts.delete.run(name, row.id);
        }
        return rows;
      }
    );
  }

  async enqueue(payload: T): Promise<string> {
    const id = randomUUID();
    this.stmts.enqueue.run(id, this.name, JSON.stringify(payload), Date.now());
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
    const rows = this.stmts.peek.all(this.name, limit) as Array<{
      id: string;
      payload: string;
      enqueued_at: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      payload: JSON.parse(r.payload) as T,
      enqueuedAt: r.enqueued_at,
    }));
  }

  async size(): Promise<number> {
    const row = this.stmts.size.get(this.name) as { n: number };
    return row.n;
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
