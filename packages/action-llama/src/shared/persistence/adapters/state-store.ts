/**
 * StateStore adapter for backward compatibility.
 * 
 * Implements the old StateStore interface using the new unified persistence layer,
 * allowing gradual migration without breaking existing code.
 */

import type { StateStore } from "../../state-store.js";
import type { PersistenceStore } from "../index.js";

export class StateStoreAdapter implements StateStore {
  constructor(private persistence: PersistenceStore) {}

  async get<T>(ns: string, key: string): Promise<T | null> {
    return this.persistence.kv.get<T>(ns, key);
  }

  async set<T>(ns: string, key: string, value: T, opts?: { ttl?: number }): Promise<void> {
    return this.persistence.kv.set(ns, key, value, opts);
  }

  async delete(ns: string, key: string): Promise<void> {
    return this.persistence.kv.delete(ns, key);
  }

  async deleteAll(ns: string): Promise<void> {
    return this.persistence.kv.deleteAll(ns);
  }

  async list<T>(ns: string): Promise<Array<{ key: string; value: T }>> {
    return this.persistence.kv.list<T>(ns);
  }

  async close(): Promise<void> {
    // Don't close the underlying store since it might be shared
    // The actual store will be closed by the main application
  }
}