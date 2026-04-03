/**
 * Integration tests: execution/lock-store.ts LockStore — no Docker required.
 *
 * LockStore is an in-memory lock manager used by the scheduler to coordinate
 * resource access between running agent containers (via rlock/runlock/rlock-heartbeat).
 * It maintains a wait-for graph for deadlock detection.
 *
 * The class has been tested only indirectly through Docker-based tests
 * (lock-route-errors.test.ts, lock-deadlock.test.ts). This test exercises
 * the LockStore API directly without Docker, covering all state transitions
 * and error paths of acquire/release/heartbeat.
 *
 * Test scenarios (no Docker required):
 *   1. acquire: valid URI → ok:true, lock is held
 *   2. acquire: invalid URI → ok:false (reason includes "Invalid URI")
 *   3. acquire: same holder re-acquires → ok:true (refresh)
 *   4. acquire: different holder → ok:false with holder info (conflict)
 *   5. acquire: expired lock is auto-evicted, new holder acquires ok
 *   6. acquire: deadlock cycle → ok:false with deadlock:true and cycle array
 *   7. release: success → ok:true, lock gone from list
 *   8. release: wrong holder → ok:false with reason
 *   9. release: lock not found → ok:false "lock not found"
 *  10. release: invalid URI → ok:false
 *  11. heartbeat: success → ok:true with expiresAt
 *  12. heartbeat: lock not found → ok:false "lock not found"
 *  13. heartbeat: wrong holder → ok:false
 *  14. heartbeat: invalid URI → ok:false
 *  15. releaseAll: releases all locks for holder, returns count
 *  16. list: returns all active locks
 *  17. list: filtered by holder
 *  18. validateResourceKey: accepts various valid URI schemes (github://, https://, file://)
 *  19. validateResourceKey: rejects no-scheme strings
 *  20. dispose: clears all internal state
 *
 * Covers:
 *   - execution/lock-store.ts: acquire() all branches
 *   - execution/lock-store.ts: release() all branches
 *   - execution/lock-store.ts: heartbeat() all branches
 *   - execution/lock-store.ts: releaseAll()
 *   - execution/lock-store.ts: list() filtered and unfiltered
 *   - execution/lock-store.ts: validateResourceKey() valid/invalid paths
 *   - execution/lock-store.ts: detectCycle() deadlock path
 *   - execution/lock-store.ts: dispose()
 */

import { describe, it, expect, afterEach } from "vitest";

const { LockStore } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/execution/lock-store.js"
);

describe("integration: LockStore (no Docker required)", () => {
  let store: InstanceType<typeof LockStore>;

  afterEach(() => {
    if (store) store.dispose();
  });

  // ── acquire() ─────────────────────────────────────────────────────────────

  describe("acquire()", () => {
    it("acquires a lock for a valid URI and returns ok:true", () => {
      store = new LockStore(1800, 3600); // large sweep interval
      const result = store.acquire("github://owner/repo/issues/1", "container-A");
      expect(result.ok).toBe(true);
    });

    it("returns ok:false for an invalid URI (no scheme)", () => {
      store = new LockStore(1800, 3600);
      const result = store.acquire("not-a-valid-uri", "container-A");
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("Invalid");
    });

    it("returns ok:false for a bare string (no scheme)", () => {
      store = new LockStore(1800, 3600);
      const result = store.acquire("just-a-string", "container-B");
      expect(result.ok).toBe(false);
    });

    it("allows same holder to re-acquire the same resource (refresh)", () => {
      store = new LockStore(1800, 3600);
      store.acquire("github://owner/repo/issues/2", "container-A");
      const result = store.acquire("github://owner/repo/issues/2", "container-A");
      expect(result.ok).toBe(true);
    });

    it("returns ok:false when a different holder holds the lock", () => {
      store = new LockStore(1800, 3600);
      store.acquire("file:///shared/resource", "holder-1");
      const result = store.acquire("file:///shared/resource", "holder-2");
      expect(result.ok).toBe(false);
      expect(result.holder).toBe("holder-1");
      expect(typeof result.heldSince).toBe("number");
    });

    it("auto-evicts expired lock and allows new holder to acquire", () => {
      // Use 0.001s TTL to create expired lock immediately
      store = new LockStore(1800, 3600);
      store.acquire("https://example.com/resource", "old-holder", 0.001); // ~1ms TTL
      // Wait for expiry
      return new Promise<void>((resolve) => setTimeout(() => {
        const result = store.acquire("https://example.com/resource", "new-holder");
        expect(result.ok).toBe(true);
        resolve();
      }, 50));
    });

    it("detects deadlock cycle and returns ok:false with deadlock:true", () => {
      store = new LockStore(1800, 3600);
      // holder-A holds resource-1
      store.acquire("github://test/repo/1", "holder-A");
      // holder-B holds resource-2
      store.acquire("github://test/repo/2", "holder-B");
      // holder-A tries to acquire resource-2 → blocked by holder-B (recorded in waitingFor)
      const result1 = store.acquire("github://test/repo/2", "holder-A");
      expect(result1.ok).toBe(false);
      expect(result1.deadlock).toBeUndefined(); // No cycle yet — A waits for B who doesn't wait for anything

      // holder-B tries to acquire resource-1 → held by holder-A who is waiting for B → deadlock!
      const result2 = store.acquire("github://test/repo/1", "holder-B");
      expect(result2.ok).toBe(false);
      expect(result2.deadlock).toBe(true);
      expect(Array.isArray(result2.cycle)).toBe(true);
      expect(result2.cycle!.length).toBeGreaterThan(0);
    });

    it("accepts various valid URI schemes", () => {
      store = new LockStore(1800, 3600);
      const schemes = [
        "github://owner/repo/issues/42",
        "https://example.com/lock",
        "http://localhost/resource",
        "file:///tmp/lock",
        "custom-scheme://my-resource",
      ];
      for (const uri of schemes) {
        const result = store.acquire(uri, `holder-${uri.substring(0, 5)}`);
        expect(result.ok).toBe(true);
      }
    });
  });

  // ── release() ────────────────────────────────────────────────────────────

  describe("release()", () => {
    it("releases a held lock and returns ok:true", () => {
      store = new LockStore(1800, 3600);
      store.acquire("github://test/1", "holder-A");
      const result = store.release("github://test/1", "holder-A");
      expect(result.ok).toBe(true);
      // Lock should no longer be in list
      expect(store.list().find((l: { resourceKey: string }) => l.resourceKey === "github://test/1")).toBeUndefined();
    });

    it("returns ok:false when a different holder tries to release", () => {
      store = new LockStore(1800, 3600);
      store.acquire("github://test/2", "holder-A");
      const result = store.release("github://test/2", "holder-B");
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("holder-A");
      // Lock should still be there
      expect(store.list().find((l: { resourceKey: string }) => l.resourceKey === "github://test/2")).toBeDefined();
    });

    it("returns ok:false 'lock not found' for an unlocked resource", () => {
      store = new LockStore(1800, 3600);
      const result = store.release("github://test/nonexistent", "holder-A");
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("lock not found");
    });

    it("returns ok:false for an invalid URI", () => {
      store = new LockStore(1800, 3600);
      const result = store.release("not-a-uri", "holder-A");
      expect(result.ok).toBe(false);
    });
  });

  // ── heartbeat() ───────────────────────────────────────────────────────────

  describe("heartbeat()", () => {
    it("extends the lock TTL and returns ok:true with expiresAt", () => {
      store = new LockStore(1800, 3600);
      store.acquire("github://test/heartbeat-1", "holder-A");
      const before = Date.now() + 1800 * 1000;
      const result = store.heartbeat("github://test/heartbeat-1", "holder-A");
      expect(result.ok).toBe(true);
      expect(typeof result.expiresAt).toBe("number");
      expect(result.expiresAt!).toBeGreaterThan(before - 5000);
    });

    it("returns ok:false 'lock not found' for an unacquired resource", () => {
      store = new LockStore(1800, 3600);
      const result = store.heartbeat("github://test/no-lock", "holder-A");
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("lock not found");
    });

    it("returns ok:false when a different holder tries to heartbeat", () => {
      store = new LockStore(1800, 3600);
      store.acquire("github://test/hb-2", "holder-A");
      const result = store.heartbeat("github://test/hb-2", "holder-B");
      expect(result.ok).toBe(false);
    });

    it("returns ok:false for an invalid URI", () => {
      store = new LockStore(1800, 3600);
      const result = store.heartbeat("invalid-uri", "holder-A");
      expect(result.ok).toBe(false);
    });
  });

  // ── releaseAll() ─────────────────────────────────────────────────────────

  describe("releaseAll()", () => {
    it("releases all locks held by a holder and returns count", () => {
      store = new LockStore(1800, 3600);
      store.acquire("github://test/a", "holder-X");
      store.acquire("github://test/b", "holder-X");
      store.acquire("github://test/c", "holder-X");
      const count = store.releaseAll("holder-X");
      expect(count).toBe(3);
      expect(store.list("holder-X").length).toBe(0);
    });

    it("does not affect locks held by other holders", () => {
      store = new LockStore(1800, 3600);
      store.acquire("github://test/shared-1", "holder-X");
      store.acquire("github://test/shared-2", "holder-Y");
      store.releaseAll("holder-X");
      const allLocks = store.list();
      expect(allLocks.find((l: { holder: string }) => l.holder === "holder-Y")).toBeDefined();
    });

    it("returns 0 for a holder with no locks", () => {
      store = new LockStore(1800, 3600);
      const count = store.releaseAll("holder-with-no-locks");
      expect(count).toBe(0);
    });
  });

  // ── list() ───────────────────────────────────────────────────────────────

  describe("list()", () => {
    it("returns all active locks across all holders", () => {
      store = new LockStore(1800, 3600);
      store.acquire("github://test/list-1", "holder-A");
      store.acquire("github://test/list-2", "holder-B");
      store.acquire("github://test/list-3", "holder-A");
      const all = store.list();
      expect(all.length).toBe(3);
    });

    it("returns only locks for a specific holder when filter provided", () => {
      store = new LockStore(1800, 3600);
      store.acquire("github://test/filter-1", "holder-A");
      store.acquire("github://test/filter-2", "holder-B");
      store.acquire("github://test/filter-3", "holder-A");
      const holderALocks = store.list("holder-A");
      expect(holderALocks.length).toBe(2);
      for (const lock of holderALocks) {
        expect(lock.holder).toBe("holder-A");
      }
    });

    it("returns empty array when no locks exist", () => {
      store = new LockStore(1800, 3600);
      expect(store.list()).toEqual([]);
    });

    it("excludes released locks from list", () => {
      store = new LockStore(1800, 3600);
      store.acquire("github://test/exclusive", "holder-A");
      store.release("github://test/exclusive", "holder-A");
      expect(store.list().length).toBe(0);
    });

    it("each lock entry has resourceKey, holder, heldSince, expiresAt", () => {
      store = new LockStore(1800, 3600);
      store.acquire("github://owner/repo/42", "container-123");
      const locks = store.list();
      expect(locks.length).toBe(1);
      const lock = locks[0];
      expect(lock.resourceKey).toBe("github://owner/repo/42");
      expect(lock.holder).toBe("container-123");
      expect(typeof lock.heldSince).toBe("number");
      expect(typeof lock.expiresAt).toBe("number");
      expect(lock.expiresAt).toBeGreaterThan(lock.heldSince);
    });
  });

  // ── dispose() ────────────────────────────────────────────────────────────

  describe("dispose()", () => {
    it("clears all locks so list() returns empty", () => {
      store = new LockStore(1800, 3600);
      store.acquire("github://test/dispose-1", "holder-A");
      store.acquire("github://test/dispose-2", "holder-B");
      store.dispose();
      expect(store.list()).toEqual([]);
    });

    it("is safe to call multiple times without throwing", () => {
      store = new LockStore(1800, 3600);
      store.dispose();
      expect(() => store.dispose()).not.toThrow();
    });
  });
});
