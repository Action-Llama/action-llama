/**
 * SQLite backend for unified persistence layer using Drizzle ORM.
 *
 * Implements the PersistenceBackend interface with SQLite storage,
 * combining key-value operations, event sourcing, and query capabilities
 * in a single database with optimized indexes and transaction support.
 *
 * Supports two constructor signatures:
 *   new SqliteBackend(dbPath: string)  — creates its own connection (backward compat)
 *   new SqliteBackend(db: AppDb)        — uses a shared connection (preferred)
 */

import { eq, and, isNull, or, gt, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { createDb } from "../../../db/connection.js";
import { applyMigrations } from "../../../db/migrate.js";
import { kvStoreTable, eventsTable, snapshotsTable } from "../../../db/schema.js";
import type { AppDb } from "../../../db/connection.js";
import type { PersistenceBackend, Event, EventQuery } from "../index.js";

export class SqliteBackend implements PersistenceBackend {
  private db: AppDb;
  private ownDb: boolean;
  private sweepTimer: ReturnType<typeof setInterval> | undefined;
  private transactionDepth = 0;

  constructor(dbOrPath: string | AppDb) {
    if (typeof dbOrPath === "string") {
      this.db = createDb(dbOrPath);
      this.ownDb = true;
    } else {
      this.db = dbOrPath;
      this.ownDb = false;
    }
  }

  async init(): Promise<void> {
    // When this instance owns its DB connection, run migrations to set up schema.
    if (this.ownDb) {
      applyMigrations(this.db);
    }
    // Start periodic cleanup of expired KV entries.
    this.sweepTimer = setInterval(() => this.sweep(), 60_000);
    if (this.sweepTimer.unref) this.sweepTimer.unref();
  }

  // Key-value operations
  async kvGet<T>(namespace: string, key: string): Promise<T | null> {
    const now = Date.now();
    const rows = this.db
      .select({ value: kvStoreTable.value })
      .from(kvStoreTable)
      .where(
        and(
          eq(kvStoreTable.namespace, namespace),
          eq(kvStoreTable.key, key),
          or(isNull(kvStoreTable.expiresAt), gt(kvStoreTable.expiresAt, now))
        )
      )
      .all();
    const row = rows[0];
    return row ? JSON.parse(row.value) : null;
  }

  async kvSet<T>(namespace: string, key: string, value: T, ttlMs?: number): Promise<void> {
    const expiresAt = ttlMs ? Date.now() + ttlMs : null;
    const now = Date.now();
    this.db
      .insert(kvStoreTable)
      .values({ namespace, key, value: JSON.stringify(value), expiresAt, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [kvStoreTable.namespace, kvStoreTable.key],
        set: { value: JSON.stringify(value), expiresAt, updatedAt: now },
      })
      .run();
  }

  async kvDelete(namespace: string, key: string): Promise<void> {
    this.db
      .delete(kvStoreTable)
      .where(and(eq(kvStoreTable.namespace, namespace), eq(kvStoreTable.key, key)))
      .run();
  }

  async kvDeleteAll(namespace: string): Promise<void> {
    this.db.delete(kvStoreTable).where(eq(kvStoreTable.namespace, namespace)).run();
  }

  async kvList<T>(namespace: string): Promise<Array<{ key: string; value: T }>> {
    const now = Date.now();
    const rows = this.db
      .select({ key: kvStoreTable.key, value: kvStoreTable.value })
      .from(kvStoreTable)
      .where(
        and(
          eq(kvStoreTable.namespace, namespace),
          or(isNull(kvStoreTable.expiresAt), gt(kvStoreTable.expiresAt, now))
        )
      )
      .all();
    return rows.map((row) => ({ key: row.key, value: JSON.parse(row.value) }));
  }

  // Event operations
  async eventAppend(stream: string, event: Omit<Event, "id" | "timestamp">): Promise<Event> {
    const id = randomUUID();
    const timestamp = Date.now();

    // Compute next sequence number and insert atomically using raw SQL subquery
    const client = (this.db as any).$client;
    client
      .prepare(`
        INSERT INTO events (id, stream, type, data, metadata, timestamp, version, sequence)
        VALUES (?, ?, ?, ?, ?, ?, ?, (
          SELECT COALESCE(MAX(sequence), 0) + 1 FROM events WHERE stream = ?
        ))
      `)
      .run(
        id,
        stream,
        event.type,
        JSON.stringify(event.data),
        event.metadata ? JSON.stringify(event.metadata) : null,
        timestamp,
        event.version,
        stream
      );

    return {
      id,
      timestamp,
      type: event.type,
      data: event.data,
      metadata: event.metadata,
      version: event.version,
    };
  }

  async *eventReplay(stream: string, query?: EventQuery): AsyncIterable<Event> {
    const type = query?.type ?? null;
    const from = query?.from ?? null;
    const to = query?.to ?? null;
    const limit = Math.min(query?.limit ?? 1000, 10000);
    const offset = query?.offset ?? 0;

    const rows = (this.db as any).$client
      .prepare(`
        SELECT id, stream, type, data, metadata, timestamp, version, sequence
        FROM events
        WHERE stream = ?
          AND (? IS NULL OR type = ?)
          AND (? IS NULL OR timestamp >= ?)
          AND (? IS NULL OR timestamp < ?)
        ORDER BY sequence ASC
        LIMIT ? OFFSET ?
      `)
      .all(stream, type, type, from, from, to, to, limit, offset) as Array<{
        id: string;
        stream: string;
        type: string;
        data: string;
        metadata: string | null;
        timestamp: number;
        version: number;
      }>;

    for (const row of rows) {
      yield {
        id: row.id,
        type: row.type,
        data: JSON.parse(row.data),
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        timestamp: row.timestamp,
        version: row.version,
      };
    }
  }

  async eventGetSnapshot<T>(stream: string, type: string): Promise<T | null> {
    const rows = this.db
      .select({ data: snapshotsTable.data })
      .from(snapshotsTable)
      .where(and(eq(snapshotsTable.stream, stream), eq(snapshotsTable.type, type)))
      .all();
    const row = rows[0];
    return row ? JSON.parse(row.data) : null;
  }

  async eventSaveSnapshot<T>(stream: string, type: string, data: T, eventId: string): Promise<void> {
    const now = Date.now();
    this.db
      .insert(snapshotsTable)
      .values({ stream, type, data: JSON.stringify(data), eventId, createdAt: now })
      .onConflictDoUpdate({
        target: [snapshotsTable.stream, snapshotsTable.type],
        set: { data: JSON.stringify(data), eventId, createdAt: now },
      })
      .run();
  }

  async eventListStreams(): Promise<string[]> {
    const rows = (this.db as any).$client
      .prepare("SELECT DISTINCT stream FROM events ORDER BY stream")
      .all() as Array<{ stream: string }>;
    return rows.map((row) => row.stream);
  }

  // Query operations — allow arbitrary SQL strings
  async querySql<T>(query: string, params: any[] = []): Promise<T[]> {
    try {
      const stmt = (this.db as any).$client.prepare(query);
      return stmt.all(...params) as T[];
    } catch (error) {
      throw new Error(`SQL query failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  // Transaction operations
  async transactionBegin(): Promise<void> {
    if (this.transactionDepth === 0) {
      (this.db as any).$client.exec("BEGIN");
    }
    this.transactionDepth++;
  }

  async transactionCommit(): Promise<void> {
    this.transactionDepth--;
    if (this.transactionDepth === 0) {
      (this.db as any).$client.exec("COMMIT");
    }
  }

  async transactionRollback(): Promise<void> {
    this.transactionDepth--;
    if (this.transactionDepth === 0) {
      (this.db as any).$client.exec("ROLLBACK");
    }
  }

  async transactionRun<T>(fn: () => Promise<T>): Promise<T> {
    await this.transactionBegin();
    try {
      const result = await fn();
      await this.transactionCommit();
      return result;
    } catch (error) {
      await this.transactionRollback();
      throw error;
    }
  }

  // Cleanup and maintenance
  private sweep(): void {
    const now = Date.now();
    const result = (this.db as any).$client
      .prepare("DELETE FROM kv_store WHERE expires_at IS NOT NULL AND expires_at <= ?")
      .run(now) as { changes: number };
    if (result.changes > 0) {
      console.debug(`Cleaned up ${result.changes} expired KV entries`);
    }
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
