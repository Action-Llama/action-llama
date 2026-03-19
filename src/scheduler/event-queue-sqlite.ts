import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { randomUUID } from "crypto";
import type { WorkQueue, QueuedWorkItem, EnqueueResult } from "./event-queue.js";

/**
 * SQLite-backed WorkQueue — durable per-agent FIFO queue.
 *
 * Items are written to disk immediately on enqueue, so work
 * survives process crashes and restarts without a separate
 * persistence layer.
 *
 * Uses better-sqlite3 for synchronous embedded storage.
 * Dequeue is atomic (transaction: select + delete) to prevent
 * concurrent double-claims.
 */
export class SqliteWorkQueue<T> implements WorkQueue<T> {
  private db: InstanceType<typeof Database>;
  private stmts: {
    enqueue: any;
    dequeue_peek: any;
    delete_by_id: any;
    size: any;
    clear_agent: any;
    clear_all: any;
    oldest: any;
  };
  private maxSize: number;

  private _dequeueTransaction: (agent: string) => {
    id: string;
    payload: string;
    received_at: number;
  } | undefined;

  private _enqueueTransaction: (
    agent: string,
    id: string,
    payload: string,
    receivedAt: number,
  ) => { dropped?: { payload: string; received_at: number } };

  constructor(maxSize: number, dbPath: string) {
    this.maxSize = maxSize;

    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS work_queue (
        id          TEXT    NOT NULL,
        agent       TEXT    NOT NULL,
        payload     TEXT    NOT NULL,
        received_at INTEGER NOT NULL,
        PRIMARY KEY (agent, id)
      )
    `);
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_wq_agent ON work_queue(agent)",
    );

    this.stmts = {
      enqueue: this.db.prepare(
        "INSERT INTO work_queue (id, agent, payload, received_at) VALUES (?, ?, ?, ?)",
      ),
      dequeue_peek: this.db.prepare(
        "SELECT id, payload, received_at FROM work_queue WHERE agent = ? ORDER BY rowid ASC LIMIT 1",
      ),
      delete_by_id: this.db.prepare(
        "DELETE FROM work_queue WHERE agent = ? AND id = ?",
      ),
      size: this.db.prepare(
        "SELECT COUNT(*) AS n FROM work_queue WHERE agent = ?",
      ),
      clear_agent: this.db.prepare("DELETE FROM work_queue WHERE agent = ?"),
      clear_all: this.db.prepare("DELETE FROM work_queue"),
      oldest: this.db.prepare(
        "SELECT id, payload, received_at FROM work_queue WHERE agent = ? ORDER BY rowid ASC LIMIT 1",
      ),
    };

    // Atomic dequeue: peek + delete in one transaction
    this._dequeueTransaction = this.db.transaction((agent: string) => {
      const row = this.stmts.dequeue_peek.get(agent) as
        | { id: string; payload: string; received_at: number }
        | undefined;
      if (!row) return undefined;
      this.stmts.delete_by_id.run(agent, row.id);
      return row;
    });

    // Atomic enqueue with overflow: insert + conditionally drop oldest
    this._enqueueTransaction = this.db.transaction(
      (agent: string, id: string, payload: string, receivedAt: number) => {
        const { n } = this.stmts.size.get(agent) as { n: number };
        let dropped: { payload: string; received_at: number } | undefined;

        if (n >= this.maxSize) {
          const oldest = this.stmts.oldest.get(agent) as
            | { id: string; payload: string; received_at: number }
            | undefined;
          if (oldest) {
            this.stmts.delete_by_id.run(agent, oldest.id);
            dropped = { payload: oldest.payload, received_at: oldest.received_at };
          }
        }

        this.stmts.enqueue.run(id, agent, payload, receivedAt);
        return { dropped };
      },
    );
  }

  enqueue(agentName: string, context: T, receivedAt?: Date): EnqueueResult<T> {
    const id = randomUUID();
    const ts = (receivedAt || new Date()).getTime();
    const { dropped: droppedRow } = this._enqueueTransaction(
      agentName,
      id,
      JSON.stringify(context),
      ts,
    );

    let dropped: QueuedWorkItem<T> | undefined;
    if (droppedRow) {
      dropped = {
        context: JSON.parse(droppedRow.payload) as T,
        receivedAt: new Date(droppedRow.received_at),
      };
    }
    return { accepted: true, dropped };
  }

  dequeue(agentName: string): QueuedWorkItem<T> | undefined {
    const row = this._dequeueTransaction(agentName);
    if (!row) return undefined;
    return {
      context: JSON.parse(row.payload) as T,
      receivedAt: new Date(row.received_at),
    };
  }

  size(agentName: string): number {
    const row = this.stmts.size.get(agentName) as { n: number };
    return row.n;
  }

  clear(agentName: string): void {
    this.stmts.clear_agent.run(agentName);
  }

  clearAll(): void {
    this.stmts.clear_all.run();
  }

  close(): void {
    this.db.close();
  }
}
