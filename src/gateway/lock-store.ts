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

export class LockStore {
  private locks = new Map<string, LockEntry>();
  private holderLocks = new Map<string, string>(); // holder -> resourceKey
  private sweepTimer: ReturnType<typeof setInterval> | undefined;
  private defaultTTL: number;

  constructor(defaultTTLSeconds = 1800, sweepIntervalSeconds = 30) {
    this.defaultTTL = defaultTTLSeconds * 1000;
    this.sweepTimer = setInterval(() => this.sweep(), sweepIntervalSeconds * 1000);
    if (this.sweepTimer.unref) this.sweepTimer.unref();
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
    }

    if (existing) {
      if (Date.now() >= existing.expiresAt) {
        // Expired — evict
        this.holderLocks.delete(existing.holder);
        this.locks.delete(resourceKey);
      } else if (existing.holder !== holder) {
        return { ok: false, holder: existing.holder, heldSince: existing.heldSince };
      }
      // Same holder re-acquiring — refresh below
    }

    const now = Date.now();
    const ttl = ttlSeconds ? ttlSeconds * 1000 : this.defaultTTL;
    this.locks.set(resourceKey, {
      resourceKey,
      holder,
      heldSince: now,
      expiresAt: now + ttl,
    });
    this.holderLocks.set(holder, resourceKey);
    return { ok: true };
  }

  release(resourceKey: string, holder: string): ReleaseResult {
    const existing = this.locks.get(resourceKey);

    if (!existing || Date.now() >= existing.expiresAt) {
      this.locks.delete(resourceKey);
      if (this.holderLocks.get(holder) === resourceKey) this.holderLocks.delete(holder);
      return { ok: false, reason: "lock not found" };
    }

    if (existing.holder !== holder) {
      return { ok: false, reason: `held by ${existing.holder}` };
    }

    this.locks.delete(resourceKey);
    this.holderLocks.delete(holder);
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
    return { ok: true, expiresAt: existing.expiresAt };
  }

  releaseAll(holder: string): number {
    let count = 0;
    for (const [rk, entry] of this.locks) {
      if (entry.holder === holder) {
        this.locks.delete(rk);
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
      }
    }
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
