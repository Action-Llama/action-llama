/**
 * In-memory backend for unified persistence layer.
 * 
 * Used primarily for testing and development. Provides the same interface
 * as SQLite backend but stores everything in memory with optional size limits.
 */

import { randomUUID } from "crypto";
import type { PersistenceBackend, Event, EventQuery } from "../index.js";

interface KvEntry<T = any> {
  value: T;
  expiresAt?: number;
  createdAt: number;
  updatedAt: number;
}

interface EventEntry {
  event: Event;
  sequence: number;
}

interface SnapshotEntry<T = any> {
  data: T;
  eventId: string;
  createdAt: number;
}

export class MemoryBackend implements PersistenceBackend {
  private kvStore = new Map<string, KvEntry>();
  private events = new Map<string, EventEntry[]>(); // stream -> events
  private snapshots = new Map<string, SnapshotEntry>(); // stream:type -> snapshot
  private sweepTimer: ReturnType<typeof setInterval> | undefined;
  private transactionStack: (() => void)[] = [];
  private transactionDepth = 0;
  
  constructor(private maxSize?: number) {}

  async init(): Promise<void> {
    // Start periodic cleanup of expired KV entries
    this.sweepTimer = setInterval(() => this.sweep(), 60_000);
    if (this.sweepTimer.unref) this.sweepTimer.unref();
  }

  // Key-value operations
  async kvGet<T>(namespace: string, key: string): Promise<T | null> {
    const storeKey = `${namespace}:${key}`;
    const entry = this.kvStore.get(storeKey);
    
    if (!entry) return null;
    
    // Check expiration
    if (entry.expiresAt && Date.now() >= entry.expiresAt) {
      this.kvStore.delete(storeKey);
      return null;
    }
    
    return entry.value as T;
  }

  async kvSet<T>(namespace: string, key: string, value: T, ttlMs?: number): Promise<void> {
    const storeKey = `${namespace}:${key}`;
    const now = Date.now();
    
    // Check size limits if specified
    if (this.maxSize && this.kvStore.size >= this.maxSize && !this.kvStore.has(storeKey)) {
      throw new Error(`Memory store size limit exceeded (${this.maxSize})`);
    }
    
    const entry: KvEntry<T> = {
      value,
      expiresAt: ttlMs ? now + ttlMs : undefined,
      createdAt: this.kvStore.has(storeKey) ? this.kvStore.get(storeKey)!.createdAt : now,
      updatedAt: now,
    };
    
    this.kvStore.set(storeKey, entry);
  }

  async kvDelete(namespace: string, key: string): Promise<void> {
    const storeKey = `${namespace}:${key}`;
    this.kvStore.delete(storeKey);
  }

  async kvDeleteAll(namespace: string): Promise<void> {
    const prefix = `${namespace}:`;
    for (const key of this.kvStore.keys()) {
      if (key.startsWith(prefix)) {
        this.kvStore.delete(key);
      }
    }
  }

  async kvList<T>(namespace: string): Promise<Array<{ key: string; value: T }>> {
    const prefix = `${namespace}:`;
    const now = Date.now();
    const results: Array<{ key: string; value: T }> = [];
    
    for (const [storeKey, entry] of this.kvStore.entries()) {
      if (!storeKey.startsWith(prefix)) continue;
      
      // Skip expired entries
      if (entry.expiresAt && now >= entry.expiresAt) {
        this.kvStore.delete(storeKey);
        continue;
      }
      
      const key = storeKey.slice(prefix.length);
      results.push({ key, value: entry.value as T });
    }
    
    return results.sort((a, b) => a.key.localeCompare(b.key));
  }

  // Event operations
  async eventAppend(stream: string, event: Omit<Event, 'id' | 'timestamp'>): Promise<Event> {
    const id = randomUUID();
    const timestamp = Date.now();
    
    const fullEvent: Event = {
      id,
      timestamp,
      type: event.type,
      data: event.data,
      metadata: event.metadata,
      version: event.version,
    };
    
    if (!this.events.has(stream)) {
      this.events.set(stream, []);
    }
    
    const streamEvents = this.events.get(stream)!;
    const sequence = streamEvents.length + 1;
    
    streamEvents.push({
      event: fullEvent,
      sequence,
    });
    
    return fullEvent;
  }

  async *eventReplay(stream: string, query?: EventQuery): AsyncIterable<Event> {
    const streamEvents = this.events.get(stream) || [];
    let filteredEvents = streamEvents.map(e => e.event);
    
    // Apply filters
    if (query?.type) {
      filteredEvents = filteredEvents.filter(e => e.type === query.type);
    }
    
    if (query?.from) {
      filteredEvents = filteredEvents.filter(e => e.timestamp >= query.from!);
    }
    
    if (query?.to) {
      filteredEvents = filteredEvents.filter(e => e.timestamp < query.to!);
    }
    
    // Apply pagination
    const offset = query?.offset || 0;
    const limit = Math.min(query?.limit || 1000, 10000);
    
    const paginatedEvents = filteredEvents.slice(offset, offset + limit);
    
    for (const event of paginatedEvents) {
      yield { ...event }; // Return a copy
    }
  }

  async eventGetSnapshot<T>(stream: string, type: string): Promise<T | null> {
    const key = `${stream}:${type}`;
    const snapshot = this.snapshots.get(key);
    return snapshot ? snapshot.data as T : null;
  }

  async eventSaveSnapshot<T>(stream: string, type: string, data: T, eventId: string): Promise<void> {
    const key = `${stream}:${type}`;
    const snapshot: SnapshotEntry<T> = {
      data,
      eventId,
      createdAt: Date.now(),
    };
    this.snapshots.set(key, snapshot);
  }

  async eventListStreams(): Promise<string[]> {
    return Array.from(this.events.keys()).sort();
  }

  // Query operations (limited in memory backend)
  async querySql<T>(query: string, params: any[] = []): Promise<T[]> {
    throw new Error("SQL queries are not supported in memory backend. Use KV and event operations instead.");
  }

  // Transaction operations (simplified for memory)
  async transactionBegin(): Promise<void> {
    this.transactionDepth++;
    
    if (this.transactionDepth === 1) {
      // Take snapshots of current state
      const kvSnapshot = new Map(this.kvStore);
      const eventsSnapshot = new Map(
        Array.from(this.events.entries()).map(([k, v]) => [k, [...v]])
      );
      const snapshotsSnapshot = new Map(this.snapshots);
      
      this.transactionStack.push(() => {
        this.kvStore = kvSnapshot;
        this.events = eventsSnapshot;
        this.snapshots = snapshotsSnapshot;
      });
    }
  }

  async transactionCommit(): Promise<void> {
    this.transactionDepth--;
    if (this.transactionDepth === 0) {
      this.transactionStack.pop(); // Discard rollback function
    }
  }

  async transactionRollback(): Promise<void> {
    this.transactionDepth--;
    if (this.transactionDepth === 0) {
      const rollback = this.transactionStack.pop();
      if (rollback) {
        rollback();
      }
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
    let cleaned = 0;
    
    for (const [key, entry] of this.kvStore.entries()) {
      if (entry.expiresAt && now >= entry.expiresAt) {
        this.kvStore.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.debug(`Cleaned up ${cleaned} expired KV entries`);
    }
  }

  async close(): Promise<void> {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
    this.kvStore.clear();
    this.events.clear();
    this.snapshots.clear();
    this.transactionStack.length = 0;
  }
}