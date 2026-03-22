/**
 * SQLite backend for unified persistence layer.
 * 
 * Implements the PersistenceBackend interface with SQLite storage,
 * combining key-value operations, event sourcing, and query capabilities
 * in a single database with optimized indexes and transaction support.
 */

import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { randomUUID } from "crypto";
import type { PersistenceBackend, Event, EventQuery } from "../index.js";

export class SqliteBackend implements PersistenceBackend {
  private db: InstanceType<typeof Database>;
  private stmts: any = {};
  private sweepTimer: ReturnType<typeof setInterval> | undefined;
  private transactionDepth = 0;

  constructor(private dbPath: string) {
    if (dbPath !== ":memory:") {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("cache_size = 1000");
    this.db.pragma("temp_store = memory");
  }

  async init(): Promise<void> {
    // Create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kv_store (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        expires_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        PRIMARY KEY (namespace, key)
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        stream TEXT NOT NULL,
        type TEXT NOT NULL,
        data TEXT NOT NULL,
        metadata TEXT,
        timestamp INTEGER NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        sequence INTEGER NOT NULL
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS snapshots (
        stream TEXT NOT NULL,
        type TEXT NOT NULL,
        data TEXT NOT NULL,
        event_id TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        PRIMARY KEY (stream, type)
      )
    `);

    // Create indexes
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_kv_expires ON kv_store(expires_at) WHERE expires_at IS NOT NULL");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_kv_namespace ON kv_store(namespace)");
    
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_events_stream ON events(stream, sequence)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_events_type ON events(stream, type, timestamp)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(stream, timestamp)");
    
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_snapshots_stream ON snapshots(stream)");

    // Prepare statements
    this.stmts = {
      // Key-value operations
      kvGet: this.db.prepare(`
        SELECT value FROM kv_store 
        WHERE namespace = ? AND key = ? AND (expires_at IS NULL OR expires_at > ?)
      `),
      kvSet: this.db.prepare(`
        INSERT OR REPLACE INTO kv_store (namespace, key, value, expires_at, updated_at) 
        VALUES (?, ?, ?, ?, ?)
      `),
      kvDelete: this.db.prepare("DELETE FROM kv_store WHERE namespace = ? AND key = ?"),
      kvDeleteAll: this.db.prepare("DELETE FROM kv_store WHERE namespace = ?"),
      kvList: this.db.prepare(`
        SELECT key, value FROM kv_store 
        WHERE namespace = ? AND (expires_at IS NULL OR expires_at > ?)
        ORDER BY key
      `),
      
      // Event operations
      eventAppend: this.db.prepare(`
        INSERT INTO events (id, stream, type, data, metadata, timestamp, version, sequence)
        VALUES (?, ?, ?, ?, ?, ?, ?, (
          SELECT COALESCE(MAX(sequence), 0) + 1 FROM events WHERE stream = ?
        ))
      `),
      eventReplay: this.db.prepare(`
        SELECT id, stream, type, data, metadata, timestamp, version, sequence
        FROM events 
        WHERE stream = ?
          AND (? IS NULL OR type = ?)
          AND (? IS NULL OR timestamp >= ?)
          AND (? IS NULL OR timestamp < ?)
        ORDER BY sequence ASC
        LIMIT ? OFFSET ?
      `),
      eventCount: this.db.prepare(`
        SELECT COUNT(*) as count FROM events 
        WHERE stream = ?
          AND (? IS NULL OR type = ?)
          AND (? IS NULL OR timestamp >= ?)
          AND (? IS NULL OR timestamp < ?)
      `),
      eventListStreams: this.db.prepare("SELECT DISTINCT stream FROM events ORDER BY stream"),
      
      // Snapshot operations
      snapshotGet: this.db.prepare("SELECT data FROM snapshots WHERE stream = ? AND type = ?"),
      snapshotSet: this.db.prepare(`
        INSERT OR REPLACE INTO snapshots (stream, type, data, event_id, created_at)
        VALUES (?, ?, ?, ?, ?)
      `),
      
      // Cleanup
      sweep: this.db.prepare("DELETE FROM kv_store WHERE expires_at IS NOT NULL AND expires_at <= ?"),
    };

    // Start periodic cleanup of expired KV entries
    this.sweepTimer = setInterval(() => this.sweep(), 60_000);
    if (this.sweepTimer.unref) this.sweepTimer.unref();
  }

  // Key-value operations
  async kvGet<T>(namespace: string, key: string): Promise<T | null> {
    const row = this.stmts.kvGet.get(namespace, key, Date.now()) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : null;
  }

  async kvSet<T>(namespace: string, key: string, value: T, ttlMs?: number): Promise<void> {
    const expiresAt = ttlMs ? Date.now() + ttlMs : null;
    const now = Date.now();
    this.stmts.kvSet.run(namespace, key, JSON.stringify(value), expiresAt, now);
  }

  async kvDelete(namespace: string, key: string): Promise<void> {
    this.stmts.kvDelete.run(namespace, key);
  }

  async kvDeleteAll(namespace: string): Promise<void> {
    this.stmts.kvDeleteAll.run(namespace);
  }

  async kvList<T>(namespace: string): Promise<Array<{ key: string; value: T }>> {
    const rows = this.stmts.kvList.all(namespace, Date.now()) as Array<{ key: string; value: string }>;
    return rows.map(row => ({ key: row.key, value: JSON.parse(row.value) }));
  }

  // Event operations
  async eventAppend(stream: string, event: Omit<Event, 'id' | 'timestamp'>): Promise<Event> {
    const id = randomUUID();
    const timestamp = Date.now();
    
    this.stmts.eventAppend.run(
      id,
      stream, 
      event.type,
      JSON.stringify(event.data),
      event.metadata ? JSON.stringify(event.metadata) : null,
      timestamp,
      event.version,
      stream // for the sequence subquery
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
    const type = query?.type || null;
    const from = query?.from || null;
    const to = query?.to || null;
    const limit = Math.min(query?.limit || 1000, 10000); // Cap at 10k for safety
    const offset = query?.offset || 0;
    
    const rows = this.stmts.eventReplay.all(
      stream, type, type, from, from, to, to, limit, offset
    ) as Array<{
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
    const row = this.stmts.snapshotGet.get(stream, type) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : null;
  }

  async eventSaveSnapshot<T>(stream: string, type: string, data: T, eventId: string): Promise<void> {
    const now = Date.now();
    this.stmts.snapshotSet.run(stream, type, JSON.stringify(data), eventId, now);
  }

  async eventListStreams(): Promise<string[]> {
    const rows = this.stmts.eventListStreams.all() as Array<{ stream: string }>;
    return rows.map(row => row.stream);
  }

  // Query operations
  async querySql<T>(query: string, params: any[] = []): Promise<T[]> {
    try {
      const stmt = this.db.prepare(query);
      return stmt.all(...params) as T[];
    } catch (error) {
      throw new Error(`SQL query failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  // Transaction operations
  async transactionBegin(): Promise<void> {
    if (this.transactionDepth === 0) {
      this.db.exec("BEGIN");
    }
    this.transactionDepth++;
  }

  async transactionCommit(): Promise<void> {
    this.transactionDepth--;
    if (this.transactionDepth === 0) {
      this.db.exec("COMMIT");
    }
  }

  async transactionRollback(): Promise<void> {
    this.transactionDepth--;
    if (this.transactionDepth === 0) {
      this.db.exec("ROLLBACK");
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
    const result = this.stmts.sweep.run(now) as { changes: number };
    if (result.changes > 0) {
      console.debug(`Cleaned up ${result.changes} expired KV entries`);
    }
  }

  async close(): Promise<void> {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
    this.db.close();
  }
}