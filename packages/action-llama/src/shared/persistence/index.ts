/**
 * Unified persistence layer combining key-value storage, event sourcing, and query capabilities.
 * 
 * Replaces the fragmented StateStore/StatsStore/WorkQueue pattern with a single abstraction
 * that supports namespaces, TTL, and append-only event storage for features like replay,
 * audit, and high availability.
 */

export interface Event {
  /** Unique event identifier */
  id: string;
  /** Event type/category */
  type: string;
  /** Event data payload */
  data: any;
  /** Event metadata (source, correlation id, etc.) */
  metadata?: Record<string, any>;
  /** Event timestamp (milliseconds since epoch) */
  timestamp: number;
  /** Event version for schema evolution */
  version: number;
}

export interface EventQuery {
  /** Event type filter */
  type?: string;
  /** Start timestamp (inclusive) */
  from?: number;
  /** End timestamp (exclusive) */
  to?: number;
  /** Maximum number of events to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

export interface EventStream {
  /** Append an event to the stream */
  append(event: Omit<Event, 'id' | 'timestamp'>): Promise<Event>;
  
  /** Replay events from the stream */
  replay(query?: EventQuery): AsyncIterable<Event>;
  
  /** Get the latest snapshot for a given type */
  getSnapshot<T>(type: string): Promise<T | null>;
  
  /** Save a snapshot to optimize future replays */
  saveSnapshot<T>(type: string, data: T, eventId: string): Promise<void>;
  
  /** Subscribe to new events (optional - for real-time features) */
  subscribe?(callback: (event: Event) => void): () => void;
}

export interface PersistenceStore {
  /** Key-value operations with namespacing */
  kv: {
    /** Get a value by namespace and key */
    get<T>(namespace: string, key: string): Promise<T | null>;
    
    /** Set a value with optional TTL */
    set<T>(namespace: string, key: string, value: T, opts?: { ttl?: number }): Promise<void>;
    
    /** Delete a single key */
    delete(namespace: string, key: string): Promise<void>;
    
    /** Delete all keys in a namespace */
    deleteAll(namespace: string): Promise<void>;
    
    /** List all non-expired entries in a namespace */
    list<T>(namespace: string): Promise<Array<{ key: string; value: T }>>;
  };
  
  /** Event sourcing operations */
  events: {
    /** Get or create an event stream */
    stream(name: string): EventStream;
    
    /** List available streams */
    listStreams(): Promise<string[]>;
  };
  
  /** Query operations for analytics */
  query: {
    /** Execute a SQL query for analytics (backend-specific) */
    sql<T>(query: string, params?: any[]): Promise<T[]>;
  };
  
  /** Transaction operations */
  transaction<T>(fn: (store: PersistenceStore) => Promise<T>): Promise<T>;
  
  /** Close the store and release resources */
  close(): Promise<void>;
}

export interface PersistenceBackend {
  /** Initialize the backend (create tables, etc.) */
  init(): Promise<void>;
  
  /** Implement the key-value operations */
  kvGet<T>(namespace: string, key: string): Promise<T | null>;
  kvSet<T>(namespace: string, key: string, value: T, ttlMs?: number): Promise<void>;
  kvDelete(namespace: string, key: string): Promise<void>;
  kvDeleteAll(namespace: string): Promise<void>;
  kvList<T>(namespace: string): Promise<Array<{ key: string; value: T }>>;
  
  /** Implement the event operations */
  eventAppend(stream: string, event: Omit<Event, 'id' | 'timestamp'>): Promise<Event>;
  eventReplay(stream: string, query?: EventQuery): AsyncIterable<Event>;
  eventGetSnapshot<T>(stream: string, type: string): Promise<T | null>;
  eventSaveSnapshot<T>(stream: string, type: string, data: T, eventId: string): Promise<void>;
  eventListStreams(): Promise<string[]>;
  
  /** Implement query operations */
  querySql<T>(query: string, params?: any[]): Promise<T[]>;
  
  /** Implement transaction operations */
  transactionBegin(): Promise<void>;
  transactionCommit(): Promise<void>;
  transactionRollback(): Promise<void>;
  transactionRun<T>(fn: () => Promise<T>): Promise<T>;
  
  /** Close and cleanup */
  close(): Promise<void>;
}

export interface PersistenceConfig {
  type: "sqlite" | "memory";
  path?: string; // for sqlite
  maxSize?: number; // for memory backend
}

/**
 * Create a persistence store from configuration.
 */
export async function createPersistenceStore(config: PersistenceConfig): Promise<PersistenceStore> {
  let backend: PersistenceBackend;
  
  switch (config.type) {
    case "sqlite":
      const { SqliteBackend } = await import("./backends/sqlite.js");
      backend = new SqliteBackend(config.path || ":memory:");
      break;
    case "memory":
      const { MemoryBackend } = await import("./backends/memory.js");
      backend = new MemoryBackend(config.maxSize);
      break;
    default:
      throw new Error(`Unsupported persistence backend: ${config.type}`);
  }
  
  await backend.init();
  return new PersistenceStoreImpl(backend);
}

/**
 * Implementation of PersistenceStore that delegates to a backend.
 */
class PersistenceStoreImpl implements PersistenceStore {
  private streams = new Map<string, EventStream>();
  
  constructor(private backend: PersistenceBackend) {}
  
  get kv() {
    return {
      get: <T>(namespace: string, key: string) => this.backend.kvGet<T>(namespace, key),
      set: <T>(namespace: string, key: string, value: T, opts?: { ttl?: number }) => 
        this.backend.kvSet(namespace, key, value, opts?.ttl ? opts.ttl * 1000 : undefined),
      delete: (namespace: string, key: string) => this.backend.kvDelete(namespace, key),
      deleteAll: (namespace: string) => this.backend.kvDeleteAll(namespace),
      list: <T>(namespace: string) => this.backend.kvList<T>(namespace),
    };
  }
  
  get events() {
    return {
      stream: (name: string) => {
        if (!this.streams.has(name)) {
          this.streams.set(name, new EventStreamImpl(name, this.backend));
        }
        return this.streams.get(name)!;
      },
      listStreams: () => this.backend.eventListStreams(),
    };
  }
  
  get query() {
    return {
      sql: <T>(query: string, params?: any[]) => this.backend.querySql<T>(query, params),
    };
  }
  
  async transaction<T>(fn: (store: PersistenceStore) => Promise<T>): Promise<T> {
    return this.backend.transactionRun(() => fn(this));
  }
  
  async close(): Promise<void> {
    await this.backend.close();
    this.streams.clear();
  }
}

/**
 * Implementation of EventStream that delegates to a backend.
 */
class EventStreamImpl implements EventStream {
  constructor(
    private name: string,
    private backend: PersistenceBackend
  ) {}
  
  append(event: Omit<Event, 'id' | 'timestamp'>): Promise<Event> {
    return this.backend.eventAppend(this.name, event);
  }
  
  replay(query?: EventQuery): AsyncIterable<Event> {
    return this.backend.eventReplay(this.name, query);
  }
  
  getSnapshot<T>(type: string): Promise<T | null> {
    return this.backend.eventGetSnapshot<T>(this.name, type);
  }
  
  saveSnapshot<T>(type: string, data: T, eventId: string): Promise<void> {
    return this.backend.eventSaveSnapshot(this.name, type, data, eventId);
  }
}