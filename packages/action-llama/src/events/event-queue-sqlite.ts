import { eq, asc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { createDb } from "../db/connection.js";
import { applyMigrations } from "../db/migrate.js";
import { workQueueTable } from "../db/schema.js";
import type { AppDb } from "../db/connection.js";
import type { WorkQueue, QueuedWorkItem, EnqueueResult } from "./event-queue.js";

/**
 * SQLite-backed WorkQueue — durable per-agent FIFO queue.
 *
 * Items are written to disk immediately on enqueue, so work
 * survives process crashes and restarts without a separate
 * persistence layer.
 *
 * Uses Drizzle ORM with better-sqlite3 for synchronous embedded storage.
 * Dequeue is atomic (transaction: select + delete) to prevent
 * concurrent double-claims.
 *
 * Supports two constructor signatures:
 *   new SqliteWorkQueue(maxSize, dbPath: string)  — creates its own connection (backward compat)
 *   new SqliteWorkQueue(maxSize, db: AppDb)        — uses a shared connection (preferred)
 */
export class SqliteWorkQueue<T> implements WorkQueue<T> {
  private db: AppDb;
  private ownDb: boolean;
  private maxSize: number;
  private agentMaxSizes = new Map<string, number>();

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
    maxSize: number,
  ) => { dropped?: { payload: string; received_at: number } };

  constructor(maxSize: number, dbOrPath: string | AppDb) {
    this.maxSize = maxSize;

    if (typeof dbOrPath === "string") {
      this.db = createDb(dbOrPath);
      this.ownDb = true;
      applyMigrations(this.db);
    } else {
      this.db = dbOrPath;
      this.ownDb = false;
    }

    const client = (this.db as any).$client;

    // Atomic dequeue: peek + delete in one transaction
    this._dequeueTransaction = client.transaction((agent: string) => {
      const row = client
        .prepare("SELECT id, payload, received_at FROM work_queue WHERE agent = ? ORDER BY rowid ASC LIMIT 1")
        .get(agent) as { id: string; payload: string; received_at: number } | undefined;
      if (!row) return undefined;
      client.prepare("DELETE FROM work_queue WHERE agent = ? AND id = ?").run(agent, row.id);
      return row;
    });

    // Atomic enqueue with overflow: insert + conditionally drop oldest
    this._enqueueTransaction = client.transaction(
      (agent: string, id: string, payload: string, receivedAt: number, maxSize: number) => {
        const sizeRow = client.prepare("SELECT COUNT(*) AS n FROM work_queue WHERE agent = ?").get(agent) as { n: number };
        let dropped: { payload: string; received_at: number } | undefined;

        if (sizeRow.n >= maxSize) {
          const oldest = client
            .prepare("SELECT id, payload, received_at FROM work_queue WHERE agent = ? ORDER BY rowid ASC LIMIT 1")
            .get(agent) as { id: string; payload: string; received_at: number } | undefined;
          if (oldest) {
            client.prepare("DELETE FROM work_queue WHERE agent = ? AND id = ?").run(agent, oldest.id);
            dropped = { payload: oldest.payload, received_at: oldest.received_at };
          }
        }

        client.prepare("INSERT INTO work_queue (id, agent, payload, received_at) VALUES (?, ?, ?, ?)").run(id, agent, payload, receivedAt);
        return { dropped };
      },
    );
  }

  setAgentMaxSize(agentName: string, maxSize: number): void {
    this.agentMaxSizes.set(agentName, maxSize);
  }

  enqueue(agentName: string, context: T, receivedAt?: Date): EnqueueResult<T> {
    const id = randomUUID();
    const ts = (receivedAt || new Date()).getTime();
    const effectiveMax = this.agentMaxSizes.get(agentName) ?? this.maxSize;
    const { dropped: droppedRow } = this._enqueueTransaction(
      agentName,
      id,
      JSON.stringify(context),
      ts,
      effectiveMax,
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

  peek(agentName: string, limit?: number): QueuedWorkItem<T>[] {
    const client = (this.db as any).$client;
    const sql =
      limit !== undefined
        ? "SELECT payload, received_at FROM work_queue WHERE agent = ? ORDER BY rowid ASC LIMIT ?"
        : "SELECT payload, received_at FROM work_queue WHERE agent = ? ORDER BY rowid ASC";
    const rows: { payload: string; received_at: number }[] =
      limit !== undefined
        ? client.prepare(sql).all(agentName, limit)
        : client.prepare(sql).all(agentName);
    return rows.map((r) => ({
      context: JSON.parse(r.payload) as T,
      receivedAt: new Date(r.received_at),
    }));
  }

  size(agentName: string): number {
    const row = (this.db as any).$client
      .prepare("SELECT COUNT(*) AS n FROM work_queue WHERE agent = ?")
      .get(agentName) as { n: number };
    return row.n;
  }

  clear(agentName: string): void {
    this.db.delete(workQueueTable).where(eq(workQueueTable.agent, agentName)).run();
  }

  clearAll(): void {
    this.db.delete(workQueueTable).run();
  }

  close(): void {
    if (this.ownDb) {
      (this.db as any).$client.close();
    }
  }
}
