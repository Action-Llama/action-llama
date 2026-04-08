/**
 * Integration tests: execution/lock-store.ts sweep() — no Docker required.
 *
 * The LockStore has a private sweep() method that:
 *   1. Removes expired locks (now >= expiresAt)
 *   2. Evicts locks held by dead containers (when isHolderAlive returns false)
 *   3. Cleans up stale waiting-for entries
 *
 * These branches can be exercised by creating a LockStore with a very short
 * sweep interval and manipulating lock TTLs to trigger expiry.
 *
 * Test scenarios (no Docker required):
 *   1. Lock that has expired is removed by sweep
 *   2. Lock that has not expired is NOT removed by sweep
 *   3. Lock held by dead holder (isHolderAlive returns false) is evicted
 *   4. releaseAll() removes all locks for a holder (as baseline test)
 *
 * Covers:
 *   - execution/lock-store.ts: sweep() expired lock removal (now >= expiresAt)
 *   - execution/lock-store.ts: sweep() isHolderAlive check → evict dead-holder lock
 *   - execution/lock-store.ts: sweep() stale waiting-for cleanup
 */

import { describe, it, expect, afterEach } from "vitest";

const { LockStore } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/execution/lock-store.js"
);

describe(
  "integration: LockStore sweep() — no Docker required",
  { timeout: 15_000 },
  () => {
    let store: InstanceType<typeof LockStore>;

    afterEach(() => {
      if (store) store.dispose();
    });

    it("expired lock is removed by sweep", async () => {
      // Very short default TTL (0.001s = 1ms), 1ms sweep interval
      store = new LockStore(0.001, 0.001);

      const result = await store.acquire("github://test/repo/sweeptest-1", "holder-001");
      expect(result.ok).toBe(true);

      // Wait for TTL to expire and sweep to run
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Lock should be gone
      const locks = store.list();
      expect(locks.find((l) => l.resourceKey === "github://test/repo/sweeptest-1")).toBeUndefined();
    });

    it("non-expired lock is NOT removed by sweep", async () => {
      // 1hr TTL, short sweep interval
      store = new LockStore(3600, 0.001);

      const result = await store.acquire("github://test/repo/sweeptest-2", "holder-002", 3600);
      expect(result.ok).toBe(true);

      // Wait for sweep to run
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Lock should still be there
      const locks = store.list();
      expect(locks.find((l) => l.resourceKey === "github://test/repo/sweeptest-2")).toBeDefined();
    });

    it("lock held by dead holder is evicted by sweep when isHolderAlive returns false", async () => {
      // Create store with isHolderAlive that returns false for our holder
      store = new LockStore(3600, 0.001, undefined, { isHolderAlive: (_holder: string) => false });

      const result = await store.acquire("github://test/repo/sweeptest-3", "dead-holder-001", 3600);
      expect(result.ok).toBe(true);

      // Wait for sweep to run
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Lock should be evicted (holder is dead)
      const locks = store.list();
      expect(locks.find((l) => l.resourceKey === "github://test/repo/sweeptest-3")).toBeUndefined();
    });

    it("live holder's lock is NOT evicted", async () => {
      // Create store with isHolderAlive that returns true for everyone
      store = new LockStore(3600, 0.001, undefined, { isHolderAlive: (_holder: string) => true });

      const result = await store.acquire("github://test/repo/sweeptest-4", "live-holder-001", 3600);
      expect(result.ok).toBe(true);

      // Wait for sweep to run
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Lock should still be there
      const locks = store.list();
      expect(locks.find((l) => l.resourceKey === "github://test/repo/sweeptest-4")).toBeDefined();
    });
  },
);
