/**
 * Integration tests: execution/call-store.ts sweep() — no Docker required.
 *
 * The CallStore has a private sweep() method that:
 *   1. Removes terminal (completed/error) entries older than TERMINAL_TTL (10 min)
 *   2. Marks active (pending/running) entries older than ACTIVE_TTL (2 hours) as "error" (timed out)
 *
 * Both branches can be exercised directly by creating a CallStore with a very
 * short sweep interval and pre-populating entries with backdated timestamps.
 * We use Object.assign to mutate the private state in a way TypeScript tolerates.
 *
 * Test scenarios (no Docker required):
 *   1. Completed entry older than TERMINAL_TTL (10 min) is removed by sweep
 *   2. Completed entry younger than TERMINAL_TTL is NOT removed
 *   3. Pending entry older than ACTIVE_TTL (2 hours) is marked "error" (timed out)
 *   4. Running entry older than ACTIVE_TTL is marked "error" (timed out)
 *   5. Fresh pending entry is not changed by sweep
 *
 * Covers:
 *   - execution/call-store.ts: sweep() terminal entry removed after TERMINAL_TTL
 *   - execution/call-store.ts: sweep() terminal entry kept if within TERMINAL_TTL
 *   - execution/call-store.ts: sweep() active entry timed out after ACTIVE_TTL
 *   - execution/call-store.ts: sweep() active entry errorMessage set to "call timed out"
 *   - execution/call-store.ts: sweep() fresh active entry not affected
 */

import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";

const { CallStore } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/execution/call-store.js"
);

describe(
  "integration: CallStore sweep() — no Docker required",
  { timeout: 15_000 },
  () => {
    let store: InstanceType<typeof CallStore>;

    afterEach(() => {
      if (store) store.dispose();
    });

    /**
     * Mutate entry timestamps so that the sweep will act on them.
     * We access private state via the public get() method and then
     * modify the entry through the store's internal Map (accessed
     * via a snapshot of the internal structure).
     */
    function backdateEntry(callStore: any, callId: string, ageMs: number): void {
      const entry = callStore.calls.get(callId);
      if (entry) {
        entry.createdAt = Date.now() - ageMs;
        if (entry.completedAt) {
          entry.completedAt = Date.now() - ageMs;
        }
      }
    }

    it("completed entry older than 10 minutes is removed by sweep", async () => {
      store = new CallStore(0.001); // 1ms sweep interval
      const entry = store.create({
        callerAgent: "caller",
        callerInstanceId: "inst-01",
        targetAgent: "target",
        context: "{}",
        depth: 1,
      });
      store.complete(entry.callId, "result");

      // Backdate the entry by 11 minutes
      const ELEVEN_MINUTES = 11 * 60 * 1000;
      backdateEntry(store as any, entry.callId, ELEVEN_MINUTES);

      // Wait for sweep to run
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Entry should be gone
      expect(store.get(entry.callId)).toBeUndefined();
    });

    it("completed entry younger than 10 minutes is NOT removed by sweep", async () => {
      store = new CallStore(0.001); // 1ms sweep interval
      const entry = store.create({
        callerAgent: "caller",
        callerInstanceId: "inst-02",
        targetAgent: "target",
        context: "{}",
        depth: 1,
      });
      store.complete(entry.callId, "result");

      // Wait for sweep to run (entry is fresh, should NOT be removed)
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Entry should still be there
      expect(store.get(entry.callId)).toBeDefined();
    });

    it("pending entry older than 2 hours is timed out by sweep", async () => {
      store = new CallStore(0.001); // 1ms sweep interval
      const entry = store.create({
        callerAgent: "caller",
        callerInstanceId: "inst-03",
        targetAgent: "target",
        context: "{}",
        depth: 1,
      });

      // Backdate the entry by 3 hours
      const THREE_HOURS = 3 * 60 * 60 * 1000;
      backdateEntry(store as any, entry.callId, THREE_HOURS);

      // Wait for sweep to run
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Entry should be marked as error with timeout message
      const updated = store.get(entry.callId);
      expect(updated?.status).toBe("error");
      expect(updated?.errorMessage).toBe("call timed out");
    });

    it("running entry older than 2 hours is timed out by sweep", async () => {
      store = new CallStore(0.001); // 1ms sweep interval
      const entry = store.create({
        callerAgent: "caller",
        callerInstanceId: "inst-04",
        targetAgent: "target",
        context: "{}",
        depth: 1,
      });
      store.setRunning(entry.callId);

      // Backdate the entry by 3 hours
      const THREE_HOURS = 3 * 60 * 60 * 1000;
      backdateEntry(store as any, entry.callId, THREE_HOURS);

      // Wait for sweep to run
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Entry should be marked as error
      const updated = store.get(entry.callId);
      expect(updated?.status).toBe("error");
    });

    it("fresh pending entry is not changed by sweep", async () => {
      store = new CallStore(0.001); // 1ms sweep interval
      const entry = store.create({
        callerAgent: "caller",
        callerInstanceId: "inst-05",
        targetAgent: "target",
        context: "{}",
        depth: 1,
      });

      // Wait for sweep to run
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Entry should still be pending (not timed out)
      const current = store.get(entry.callId);
      expect(current?.status).toBe("pending");
    });
  },
);
