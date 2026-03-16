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
  private holderLocks = new Map<string, string>(); // holder -> resourceKey
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
        this.holderLocks.set(value.holder, value.resourceKey);
      }
    }
  }

  acquire(resourceKey: string, holder: string, ttlSeconds?: number): AcquireResult {
    const existing = this.locks.get(resourceKey);

    // Check if this holder already holds a different lock
    const existingHolderKey = this.holderLocks.get(holder);
    if (existingHolderKey && existingHolderKey !== resourceKey) {
      const existingHolderLock = this.locks.get(existingHolderKey);
      if (existingHolderLock && Date.now() < existingHolderLock.expiresAt) {
        return {
          ok: false,
          reason: `already holding lock on ${existingHolderLock.resourceKey} — release it first`,
        };
      }
      // Expired — clean up
      this.locks.delete(existingHolderKey);
      this.holderLocks.delete(holder);
      this.persistDelete(existingHolderKey, holder);
    }

    if (existing) {
      if (Date.now() >= existing.expiresAt) {
        // Expired — evict
        this.holderLocks.delete(existing.holder);
        this.locks.delete(resourceKey);
        this.persistDelete(resourceKey, existing.holder);
      } else if (existing.holder !== holder) {
        return { ok: false, holder: existing.holder, heldSince: existing.heldSince };
      }
      // Same holder re-acquiring — refresh below
    }

    const now = Date.now();
    const ttl = ttlSeconds ? ttlSeconds * 1000 : this.defaultTTL;
    const entry: LockEntry = { resourceKey, holder, heldSince: now, expiresAt: now + ttl };
    this.locks.set(resourceKey, entry);
    this.holderLocks.set(holder, resourceKey);
    this.persistSet(entry);
    return { ok: true };
  }

  release(resourceKey: string, holder: string): ReleaseResult {
    const existing = this.locks.get(resourceKey);

    if (!existing || Date.now() >= existing.expiresAt) {
      this.locks.delete(resourceKey);
      if (this.holderLocks.get(holder) === resourceKey) this.holderLocks.delete(holder);
      this.persistDelete(resourceKey, holder);
      return { ok: false, reason: "lock not found" };
    }

    if (existing.holder !== holder) {
      return { ok: false, reason: `held by ${existing.holder}` };
    }

    this.locks.delete(resourceKey);
    this.holderLocks.delete(holder);
    this.persistDelete(resourceKey, holder);
    return { ok: true };
  }

  heartbeat(resourceKey: string, holder: string, ttlSeconds?: number): HeartbeatResult {
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
    for (const [rk, entry] of this.locks) {
      if (entry.holder === holder) {
        this.locks.delete(rk);
        this.persistDelete(rk, holder);
        count++;
      }
    }
    this.holderLocks.delete(holder);
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

  private sweep(): void {
    const now = Date.now();
    for (const [rk, entry] of this.locks) {
      if (now >= entry.expiresAt) {
        this.holderLocks.delete(entry.holder);
        this.locks.delete(rk);
        this.persistDelete(rk, entry.holder);
      }
    }
  }

  private persistSet(entry: LockEntry): void {
    const ttlSec = Math.max(1, Math.ceil((entry.expiresAt - Date.now()) / 1000));
    this.store?.set(NS_LOCKS, entry.resourceKey, entry, { ttl: ttlSec }).catch(() => {});
    this.store?.set(NS_HOLDERS, entry.holder, entry.resourceKey, { ttl: ttlSec }).catch(() => {});
  }

  private persistDelete(resourceKey: string, holder: string): void {
    this.store?.delete(NS_LOCKS, resourceKey).catch(() => {});
    this.store?.delete(NS_HOLDERS, holder).catch(() => {});
  }

  dispose(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
    this.locks.clear();
    this.holderLocks.clear();
  }
}
