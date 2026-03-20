import type { StateStore } from "../shared/state-store.js";

export interface LockEntry {
  resourceKey: string;
  holder: string;
  heldSince: number;
  expiresAt: number;
}

export interface AcquireResult {
  ok: boolean;
  holder?: string;
  heldSince?: number;
  reason?: string;
  deadlock?: boolean;
  cycle?: string[];
}

export interface ReleaseResult {
  ok: boolean;
  reason?: string;
}

export interface HeartbeatResult {
  ok: boolean;
  reason?: string;
  expiresAt?: number;
}

const NS_LOCKS = "locks";
const NS_HOLDERS = "lock-holders";

export class LockStore {
  private locks = new Map<string, LockEntry>();
  private holderLocks = new Map<string, Set<string>>(); // holder -> resourceKeys
  private waitingFor = new Map<string, string>(); // holder -> resourceKey they failed to acquire
  private sweepTimer: ReturnType<typeof setInterval> | undefined;
  private defaultTTL: number;
  private store?: StateStore;

  constructor(defaultTTLSeconds = 1800, sweepIntervalSeconds = 30, store?: StateStore) {
    this.defaultTTL = defaultTTLSeconds * 1000;
    this.store = store;
    this.sweepTimer = setInterval(() => this.sweep(), sweepIntervalSeconds * 1000);
    if (this.sweepTimer.unref) this.sweepTimer.unref();
  }

  /** Hydrate in-memory state from the persistent store. */
  async init(): Promise<void> {
    if (!this.store) return;
    const entries = await this.store.list<LockEntry>(NS_LOCKS);
    const now = Date.now();
    for (const { value } of entries) {
      if (now < value.expiresAt) {
        this.locks.set(value.resourceKey, value);
        this.addHolderLock(value.holder, value.resourceKey);
      }
    }
  }

  acquire(resourceKey: string, holder: string, ttlSeconds?: number): AcquireResult {
    // Validate that resourceKey is a valid URI
    const validation = this.validateResourceKey(resourceKey);
    if (!validation.ok) {
      return { ok: false, reason: validation.error };
    }

    const existing = this.locks.get(resourceKey);

    if (existing) {
      if (Date.now() >= existing.expiresAt) {
        // Expired — evict
        this.removeHolderLock(existing.holder, resourceKey);
        this.locks.delete(resourceKey);
        this.persistDelete(resourceKey, existing.holder);
      } else if (existing.holder !== holder) {
        // Resource held by another — check for deadlock cycle
        const cycle = this.detectCycle(holder, resourceKey);
        if (cycle) {
          this.waitingFor.set(holder, resourceKey);
          return {
            ok: false,
            reason: `possible deadlock: ${[...cycle, cycle[0]].join(" \u2192 ")}`,
            deadlock: true,
            cycle,
          };
        }
        this.waitingFor.set(holder, resourceKey);
        return { ok: false, holder: existing.holder, heldSince: existing.heldSince };
      }
      // Same holder re-acquiring — refresh below
    }

    // Acquired — clear waiting state
    this.waitingFor.delete(holder);

    const now = Date.now();
    const ttl = ttlSeconds ? ttlSeconds * 1000 : this.defaultTTL;
    const entry: LockEntry = { resourceKey, holder, heldSince: now, expiresAt: now + ttl };
    this.locks.set(resourceKey, entry);
    this.addHolderLock(holder, resourceKey);
    this.persistSet(entry);
    return { ok: true };
  }

  release(resourceKey: string, holder: string): ReleaseResult {
    // Validate that resourceKey is a valid URI
    const validation = this.validateResourceKey(resourceKey);
    if (!validation.ok) {
      return { ok: false, reason: validation.error };
    }

    const existing = this.locks.get(resourceKey);

    if (!existing || Date.now() >= existing.expiresAt) {
      this.locks.delete(resourceKey);
      this.removeHolderLock(holder, resourceKey);
      this.persistDelete(resourceKey, holder);
      return { ok: false, reason: "lock not found" };
    }

    if (existing.holder !== holder) {
      return { ok: false, reason: `held by ${existing.holder}` };
    }

    this.locks.delete(resourceKey);
    this.removeHolderLock(holder, resourceKey);
    this.persistDelete(resourceKey, holder);
    return { ok: true };
  }

  heartbeat(resourceKey: string, holder: string, ttlSeconds?: number): HeartbeatResult {
    // Validate that resourceKey is a valid URI
    const validation = this.validateResourceKey(resourceKey);
    if (!validation.ok) {
      return { ok: false, reason: validation.error };
    }

    const existing = this.locks.get(resourceKey);

    if (!existing || Date.now() >= existing.expiresAt) {
      this.locks.delete(resourceKey);
      return { ok: false, reason: "lock not found" };
    }

    if (existing.holder !== holder) {
      return { ok: false, reason: `held by ${existing.holder}` };
    }

    const ttl = ttlSeconds ? ttlSeconds * 1000 : this.defaultTTL;
    existing.expiresAt = Date.now() + ttl;
    this.persistSet(existing);
    return { ok: true, expiresAt: existing.expiresAt };
  }

  releaseAll(holder: string): number {
    let count = 0;
    const holderKeys = this.holderLocks.get(holder);
    if (holderKeys) {
      for (const rk of holderKeys) {
        this.locks.delete(rk);
        this.store?.delete(NS_LOCKS, rk).catch(() => {});
        count++;
      }
    }
    this.holderLocks.delete(holder);
    this.waitingFor.delete(holder);
    this.store?.delete(NS_HOLDERS, holder).catch(() => {});
    return count;
  }

  list(holder?: string): LockEntry[] {
    const now = Date.now();
    const result: LockEntry[] = [];
    for (const entry of this.locks.values()) {
      if (now >= entry.expiresAt) continue;
      if (holder && entry.holder !== holder) continue;
      result.push({ ...entry });
    }
    return result;
  }

  /**
   * Validate that the resource key is a valid URI.
   * 
   * Accepts common URI schemes: https://, http://, file://, github://, and any scheme
   * matching the pattern /^[a-z][a-z0-9+.-]*:/ 
   * 
   * @param resourceKey The resource key to validate
   * @returns Object with ok: true if valid, or ok: false with error message
   */
  private validateResourceKey(resourceKey: string): { ok: boolean; error?: string } {
    try {
      const url = new URL(resourceKey);
      // Check for valid URI scheme pattern: starts with letter, followed by letters/digits/+/./-, then :
      const validSchemePattern = /^[a-z][a-z0-9+.-]*$/;
      if (!validSchemePattern.test(url.protocol.slice(0, -1))) {
        return { ok: false, error: `Invalid URI scheme '${url.protocol}'. URI schemes must match pattern [a-z][a-z0-9+.-]*:` };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: `Invalid URI format: ${error instanceof Error ? error.message : 'unknown error'}` };
    }
  }

  /**
   * Detect a deadlock cycle if `holder` tries to acquire `targetResource`.
   *
   * Follows the wait-for graph: holder wants targetResource (held by B),
   * B is waiting for something (held by C), ... until we reach holder again
   * (cycle) or a dead end (no cycle).
   *
   * Returns the cycle path as alternating [holder, resource, holder, resource, ...]
   * or null if no cycle exists.
   */
  private detectCycle(holder: string, targetResource: string): string[] | null {
    const visited = new Set<string>([holder]);
    const path: string[] = [holder, targetResource];
    let currentResource = targetResource;

    for (;;) {
      const lock = this.locks.get(currentResource);
      if (!lock || Date.now() >= lock.expiresAt) return null;

      const blocker = lock.holder;
      if (blocker === holder) return path; // cycle back to the requesting holder

      if (visited.has(blocker)) return null; // cycle doesn't involve the requesting holder
      visited.add(blocker);
      path.push(blocker);

      const waitingResource = this.waitingFor.get(blocker);
      if (!waitingResource) return null;

      path.push(waitingResource);
      currentResource = waitingResource;
    }
  }

  private addHolderLock(holder: string, resourceKey: string): void {
    let keys = this.holderLocks.get(holder);
    if (!keys) {
      keys = new Set();
      this.holderLocks.set(holder, keys);
    }
    keys.add(resourceKey);
  }

  private removeHolderLock(holder: string, resourceKey: string): void {
    const keys = this.holderLocks.get(holder);
    if (keys) {
      keys.delete(resourceKey);
      if (keys.size === 0) this.holderLocks.delete(holder);
    }
  }

  private sweep(): void {
    const now = Date.now();
    for (const [rk, entry] of this.locks) {
      if (now >= entry.expiresAt) {
        this.removeHolderLock(entry.holder, rk);
        this.locks.delete(rk);
        this.persistDelete(rk, entry.holder);
      }
    }
    // Clean up stale waiting-for entries where the holder no longer holds locks
    for (const [holder] of this.waitingFor) {
      if (!this.holderLocks.has(holder)) {
        this.waitingFor.delete(holder);
      }
    }
  }

  private persistSet(entry: LockEntry): void {
    const ttlSec = Math.max(1, Math.ceil((entry.expiresAt - Date.now()) / 1000));
    this.store?.set(NS_LOCKS, entry.resourceKey, entry, { ttl: ttlSec }).catch(() => {});
    this.persistHolderIndex(entry.holder);
  }

  private persistDelete(resourceKey: string, holder: string): void {
    this.store?.delete(NS_LOCKS, resourceKey).catch(() => {});
    this.persistHolderIndex(holder);
  }

  private persistHolderIndex(holder: string): void {
    const keys = this.holderLocks.get(holder);
    if (!keys || keys.size === 0) {
      this.store?.delete(NS_HOLDERS, holder).catch(() => {});
      return;
    }
    // Use the max remaining TTL across all held locks
    let maxExpiry = 0;
    for (const rk of keys) {
      const lock = this.locks.get(rk);
      if (lock) maxExpiry = Math.max(maxExpiry, lock.expiresAt);
    }
    const ttlSec = Math.max(1, Math.ceil((maxExpiry - Date.now()) / 1000));
    this.store?.set(NS_HOLDERS, holder, [...keys], { ttl: ttlSec }).catch(() => {});
  }

  dispose(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
    this.locks.clear();
    this.holderLocks.clear();
    this.waitingFor.clear();
  }
}
