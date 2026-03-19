import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LockStore } from "../../src/gateway/lock-store.js";
import type { StateStore } from "../../src/shared/state-store.js";

// Minimal in-memory StateStore for testing persistence without SQLite.
function makeStore(): StateStore {
  const data = new Map<string, { value: unknown; expiresAt?: number }>();
  const k = (ns: string, key: string) => `${ns}:${key}`;
  return {
    async get<T>(ns: string, key: string): Promise<T | null> {
      const entry = data.get(k(ns, key));
      if (!entry) return null;
      if (entry.expiresAt !== undefined && Math.floor(Date.now() / 1000) > entry.expiresAt) {
        data.delete(k(ns, key));
        return null;
      }
      return entry.value as T;
    },
    async set<T>(ns: string, key: string, value: T, opts?: { ttl?: number }): Promise<void> {
      data.set(k(ns, key), {
        value,
        expiresAt: opts?.ttl ? Math.floor(Date.now() / 1000) + opts.ttl : undefined,
      });
    },
    async delete(ns: string, key: string): Promise<void> {
      data.delete(k(ns, key));
    },
    async deleteAll(ns: string): Promise<void> {
      for (const key of data.keys()) {
        if (key.startsWith(`${ns}:`)) data.delete(key);
      }
    },
    async list<T>(ns: string): Promise<Array<{ key: string; value: T }>> {
      const prefix = `${ns}:`;
      const nowSec = Math.floor(Date.now() / 1000);
      const results: Array<{ key: string; value: T }> = [];
      for (const [key, entry] of data) {
        if (!key.startsWith(prefix)) continue;
        if (entry.expiresAt !== undefined && nowSec > entry.expiresAt) continue;
        results.push({ key: key.slice(prefix.length), value: entry.value as T });
      }
      return results;
    },
    async close(): Promise<void> {},
  };
}

describe("LockStore", () => {
  let store: LockStore;

  beforeEach(() => {
    // Long sweep interval so it doesn't interfere with tests
    store = new LockStore(300, 9999);
  });

  afterEach(() => {
    store.dispose();
  });

  describe("acquire", () => {
    it("succeeds when lock is free", () => {
      const result = store.acquire("github issue acme/app#42", "agent-a");
      expect(result).toEqual({ ok: true });
    });

    it("returns conflict when lock is held by another agent", () => {
      store.acquire("github issue acme/app#42", "agent-a");
      const result = store.acquire("github issue acme/app#42", "agent-b");
      expect(result.ok).toBe(false);
      expect(result.holder).toBe("agent-a");
      expect(result.heldSince).toBeTypeOf("number");
    });

    it("allows same holder to re-acquire (idempotent)", () => {
      store.acquire("github issue acme/app#42", "agent-a");
      const result = store.acquire("github issue acme/app#42", "agent-a");
      expect(result).toEqual({ ok: true });
    });

    it("allows acquire after lock expires", () => {
      vi.useFakeTimers();
      try {
        store.acquire("github issue acme/app#42", "agent-a", 1);
        vi.advanceTimersByTime(1500);
        const result = store.acquire("github issue acme/app#42", "agent-b");
        expect(result).toEqual({ ok: true });
      } finally {
        vi.useRealTimers();
      }
    });

    it("uses custom TTL when provided", () => {
      vi.useFakeTimers();
      try {
        store.acquire("github issue acme/app#42", "agent-a", 2);
        vi.advanceTimersByTime(1500);
        // Still locked at 1.5s
        const conflict = store.acquire("github issue acme/app#42", "agent-b");
        expect(conflict.ok).toBe(false);
        vi.advanceTimersByTime(1000);
        // Expired at 2.5s
        const success = store.acquire("github issue acme/app#42", "agent-b");
        expect(success.ok).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it("treats different resource keys independently", () => {
      store.acquire("github issue acme/app#42", "agent-a");
      // Different agent can lock a different resource
      const result = store.acquire("github pr acme/app#42", "agent-b");
      expect(result).toEqual({ ok: true });
    });

    it("treats different keys independently", () => {
      store.acquire("github issue acme/app#42", "agent-a");
      // Different agent can lock a different key
      const result = store.acquire("github issue acme/app#99", "agent-b");
      expect(result).toEqual({ ok: true });
    });

    it("rejects when holder already holds a different lock", () => {
      store.acquire("github issue acme/app#1", "agent-a");
      const result = store.acquire("github issue acme/app#2", "agent-a");
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("already holding lock");
      expect(result.reason).toContain("acme/app#1");
    });

    it("allows acquiring a different lock after releasing the first", () => {
      store.acquire("github issue acme/app#1", "agent-a");
      store.release("github issue acme/app#1", "agent-a");
      const result = store.acquire("github issue acme/app#2", "agent-a");
      expect(result).toEqual({ ok: true });
    });

    it("allows acquiring a different lock after the first expires", () => {
      vi.useFakeTimers();
      try {
        store.acquire("github issue acme/app#1", "agent-a", 1);
        vi.advanceTimersByTime(1500);
        const result = store.acquire("github issue acme/app#2", "agent-a");
        expect(result).toEqual({ ok: true });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("release", () => {
    it("succeeds for the lock owner", () => {
      store.acquire("github issue acme/app#42", "agent-a");
      const result = store.release("github issue acme/app#42", "agent-a");
      expect(result).toEqual({ ok: true });
    });

    it("fails for non-owner", () => {
      store.acquire("github issue acme/app#42", "agent-a");
      const result = store.release("github issue acme/app#42", "agent-b");
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("agent-a");
    });

    it("fails for non-existent lock", () => {
      const result = store.release("github issue acme/app#99", "agent-a");
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("lock not found");
    });

    it("allows re-acquire after release", () => {
      store.acquire("github issue acme/app#42", "agent-a");
      store.release("github issue acme/app#42", "agent-a");
      const result = store.acquire("github issue acme/app#42", "agent-b");
      expect(result).toEqual({ ok: true });
    });
  });

  describe("heartbeat", () => {
    it("extends the TTL on a held lock", () => {
      vi.useFakeTimers();
      try {
        store.acquire("github issue acme/app#42", "agent-a", 2);
        vi.advanceTimersByTime(1500);
        // Heartbeat resets TTL
        const result = store.heartbeat("github issue acme/app#42", "agent-a", 5);
        expect(result.ok).toBe(true);
        expect(result.expiresAt).toBeTypeOf("number");
        // Should still be locked 3 seconds later (within new 5s TTL)
        vi.advanceTimersByTime(3000);
        const conflict = store.acquire("github issue acme/app#42", "agent-b");
        expect(conflict.ok).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it("fails for non-owner", () => {
      store.acquire("github issue acme/app#42", "agent-a");
      const result = store.heartbeat("github issue acme/app#42", "agent-b");
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("agent-a");
    });

    it("fails for non-existent lock", () => {
      const result = store.heartbeat("github issue acme/app#42", "agent-a");
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("lock not found");
    });

    it("fails for expired lock", () => {
      vi.useFakeTimers();
      try {
        store.acquire("github issue acme/app#42", "agent-a", 1);
        vi.advanceTimersByTime(1500);
        const result = store.heartbeat("github issue acme/app#42", "agent-a");
        expect(result.ok).toBe(false);
        expect(result.reason).toBe("lock not found");
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("releaseAll", () => {
    it("releases the lock held by an agent", () => {
      store.acquire("github issue acme/app#1", "agent-a");
      const count = store.releaseAll("agent-a");
      expect(count).toBe(1);
      expect(store.acquire("github issue acme/app#1", "agent-b").ok).toBe(true);
    });

    it("does not release locks held by other agents", () => {
      store.acquire("github issue acme/app#1", "agent-a");
      store.acquire("github issue acme/app#2", "agent-b");
      store.releaseAll("agent-a");
      const conflict = store.acquire("github issue acme/app#2", "agent-a");
      expect(conflict.ok).toBe(false);
      expect(conflict.holder).toBe("agent-b");
    });

    it("returns 0 when agent holds no locks", () => {
      expect(store.releaseAll("agent-c")).toBe(0);
    });

    it("allows holder to acquire a new lock after releaseAll", () => {
      store.acquire("github issue acme/app#1", "agent-a");
      store.releaseAll("agent-a");
      const result = store.acquire("github issue acme/app#2", "agent-a");
      expect(result).toEqual({ ok: true });
    });
  });

  describe("list", () => {
    it("returns all active locks", () => {
      store.acquire("github issue acme/app#1", "agent-a");
      store.acquire("github pr acme/app#2", "agent-b");
      const all = store.list();
      expect(all).toHaveLength(2);
    });

    it("filters by holder", () => {
      store.acquire("github issue acme/app#1", "agent-a");
      store.acquire("github pr acme/app#2", "agent-b");
      const filtered = store.list("agent-a");
      expect(filtered).toHaveLength(1);
      expect(filtered[0].holder).toBe("agent-a");
    });

    it("excludes expired locks", () => {
      vi.useFakeTimers();
      try {
        store.acquire("github issue acme/app#1", "agent-a", 1);
        store.acquire("github pr acme/app#2", "agent-b", 60);
        vi.advanceTimersByTime(1500);
        const all = store.list();
        expect(all).toHaveLength(1);
        expect(all[0].resourceKey).toBe("github pr acme/app#2");
      } finally {
        vi.useRealTimers();
      }
    });

    it("returns copies, not references", () => {
      store.acquire("github issue acme/app#1", "agent-a");
      const [entry] = store.list();
      entry.holder = "tampered";
      const [fresh] = store.list();
      expect(fresh.holder).toBe("agent-a");
    });
  });

  describe("dispose", () => {
    it("clears all locks", () => {
      store.acquire("github issue acme/app#1", "agent-a");
      store.dispose();
      expect(store.list()).toHaveLength(0);
    });
  });
});

describe("LockStore — durable persistence", () => {
  it("persists an acquired lock to the backing store", async () => {
    const stateStore = makeStore();
    const ls = new LockStore(300, 9999, stateStore);

    ls.acquire("github issue acme/app#42", "agent-a");

    const entries = await stateStore.list("locks");
    expect(entries).toHaveLength(1);
    expect(entries[0].key).toBe("github issue acme/app#42");

    ls.dispose();
  });

  it("hydrates locks from the backing store on init", async () => {
    const stateStore = makeStore();

    // First instance acquires a lock then disposes
    const ls1 = new LockStore(300, 9999, stateStore);
    ls1.acquire("github issue acme/app#42", "agent-a");
    ls1.dispose();

    // Second instance sharing the same store should see the lock after init
    const ls2 = new LockStore(300, 9999, stateStore);
    await ls2.init();

    const conflict = ls2.acquire("github issue acme/app#42", "agent-b");
    expect(conflict.ok).toBe(false);
    expect(conflict.holder).toBe("agent-a");

    ls2.dispose();
  });

  it("removes a released lock from the backing store", async () => {
    const stateStore = makeStore();
    const ls = new LockStore(300, 9999, stateStore);

    ls.acquire("github issue acme/app#42", "agent-a");
    ls.release("github issue acme/app#42", "agent-a");

    const entries = await stateStore.list("locks");
    expect(entries).toHaveLength(0);

    ls.dispose();
  });

  it("new instance can acquire a lock that was released by a previous instance", async () => {
    const stateStore = makeStore();

    const ls1 = new LockStore(300, 9999, stateStore);
    ls1.acquire("github issue acme/app#42", "agent-a");
    ls1.release("github issue acme/app#42", "agent-a");
    ls1.dispose();

    const ls2 = new LockStore(300, 9999, stateStore);
    await ls2.init();

    const result = ls2.acquire("github issue acme/app#42", "agent-b");
    expect(result.ok).toBe(true);

    ls2.dispose();
  });
});
