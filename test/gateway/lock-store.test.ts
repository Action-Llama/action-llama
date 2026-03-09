import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LockStore } from "../../src/gateway/lock-store.js";

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
