/**
 * StateStore — persistent key-value store with namespaces and TTL.
 *
 * Provides a unified storage interface for scheduler state that survives
 * process restarts:
 *   - Container registry (secret → registration)
 *   - Locks (resource → holder)
 *   - Call entries (inter-agent communication)
 *   - Work queues (buffered webhook/call events)
 *
 * Uses SQLite (zero-config file in project dir).
 */

export interface StateStore {
  /** Get a value by namespace and key. Returns null if not found or expired. */
  get<T>(ns: string, key: string): Promise<T | null>;

  /** Set a value. Optional TTL in seconds. */
  set<T>(ns: string, key: string, value: T, opts?: { ttl?: number }): Promise<void>;

  /** Delete a single entry. */
  delete(ns: string, key: string): Promise<void>;

  /** Delete all entries in a namespace. */
  deleteAll(ns: string): Promise<void>;

  /** List all non-expired entries in a namespace. */
  list<T>(ns: string): Promise<Array<{ key: string; value: T }>>;

  /** Close the store and release resources. */
  close(): Promise<void>;
}

// --- Factory ---

export interface SqliteStoreOpts {
  type: "sqlite";
  /** Path to the .db file (created if missing). */
  path: string;
}

export type StateStoreOpts = SqliteStoreOpts;

/**
 * Create a StateStore from configuration.
 *
 * Uses dynamic imports so native modules (better-sqlite3)
 * are only loaded when actually needed.
 */
export async function createStateStore(opts: StateStoreOpts): Promise<StateStore> {
  const { SqliteStateStore } = await import("./state-store-sqlite.js");
  return new SqliteStateStore(opts.path);
}
