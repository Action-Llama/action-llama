import type { ContainerRegistration } from "./types.js";
import type { StateStore } from "../shared/state-store.js";

const NS = "containers";

/**
 * Container registry backed by a StateStore.
 *
 * Keeps an in-memory cache for fast synchronous lookups (used by every
 * route handler). Writes go to both the cache and the persistent store,
 * so registrations survive scheduler restarts.
 */
export class ContainerRegistry {
  private cache = new Map<string, ContainerRegistration>();
  private store?: StateStore;

  constructor(store?: StateStore) {
    this.store = store;
  }

  /** Hydrate the in-memory cache from the persistent store. */
  async init(): Promise<void> {
    if (!this.store) return;
    const entries = await this.store.list<ContainerRegistration>(NS);
    for (const { key, value } of entries) {
      this.cache.set(key, value);
    }
  }

  /** Synchronous lookup — used by route handlers on every request. */
  get(secret: string): ContainerRegistration | undefined {
    return this.cache.get(secret);
  }

  /** Register a container. Persists to store. */
  async register(secret: string, reg: ContainerRegistration): Promise<void> {
    this.cache.set(secret, reg);
    await this.store?.set(NS, secret, reg);
  }

  /** Unregister a container. Persists to store. */
  async unregister(secret: string): Promise<void> {
    this.cache.delete(secret);
    await this.store?.delete(NS, secret);
  }

  /**
   * Check if a container with the given instanceId is currently registered.
   * Used by the lock store to detect orphan locks held by dead containers.
   */
  hasInstance(instanceId: string): boolean {
    for (const reg of this.cache.values()) {
      if (reg.instanceId === instanceId) return true;
    }
    return false;
  }

  /** Return all current registrations as an array (used during startup cleanup). */
  listAll(): ContainerRegistration[] {
    return Array.from(this.cache.values());
  }

  /** Remove all registrations from both the cache and the persistent store. */
  async clear(): Promise<void> {
    for (const key of this.cache.keys()) {
      await this.store?.delete(NS, key);
    }
    this.cache.clear();
  }

  /** Number of registered containers. */
  get size(): number {
    return this.cache.size;
  }
}
