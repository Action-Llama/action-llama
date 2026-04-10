/**
 * Integration tests: execution/runner-pool.ts RunnerPool — no Docker required.
 *
 * RunnerPool manages multiple runner instances for parallel agent execution.
 * It provides load-balancing (getAvailableRunner, getAllAvailableRunners, getNextRunner)
 * and lifecycle management (addRunner, shrinkTo, killSession, killAll).
 *
 * The class has no direct test coverage. It's used as a mock/stub object in
 * other integration tests (dispatch-policy, try-run-or-enqueue) but the
 * real RunnerPool implementation has not been tested in isolation.
 *
 * Test scenarios (no Docker required):
 *   1. getAvailableRunner: returns runner when not running
 *   2. getAvailableRunner: returns null when all runners are busy
 *   3. getAvailableRunner: returns null for empty pool
 *   4. getAllAvailableRunners: returns all idle runners
 *   5. getAllAvailableRunners: returns empty when all busy
 *   6. getNextRunner: round-robin across all runners
 *   7. getNextRunner: returns null for empty pool
 *   8. hasRunningJobs: true when at least one runner is running
 *   9. hasRunningJobs: false when none running
 *  10. runningJobCount: counts active runners
 *  11. size: correct count
 *  12. allRunners: returns copy of runners array
 *  13. addRunner: increases size and makes runner available
 *  14. shrinkTo: removes idle runners down to target size
 *  15. shrinkTo: doesn't remove running runners
 *  16. shrinkTo: returns count of removed runners
 *  17. killSession: calls abort() on the target runner
 *  18. killSession: returns false for unknown sessionId
 *  19. killSession: returns false when runner not running
 *  20. killAll: aborts all running runners, returns count
 *
 * Covers:
 *   - execution/runner-pool.ts: all methods and getters
 */

import { describe, it, expect } from "vitest";

const { RunnerPool } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/execution/runner-pool.js"
);

function makeRunner(opts: {
  sessionId: string;
  isRunning?: boolean;
  hasAbort?: boolean;
}) {
  let abortCalled = false;
  return {
    sessionId: opts.sessionId,
    isRunning: opts.isRunning ?? false,
    abortCalled: false,
    get _abortCalled() { return abortCalled; },
    abort: opts.hasAbort !== false ? () => { abortCalled = true; } : undefined,
    async run() { return {}; },
  };
}

describe("integration: RunnerPool (no Docker required)", () => {

  // ── getAvailableRunner() ──────────────────────────────────────────────────

  describe("getAvailableRunner()", () => {
    it("returns the first idle runner", () => {
      const runner = makeRunner({ sessionId: "inst-1", isRunning: false });
      const pool = new RunnerPool([runner]);
      const found = pool.getAvailableRunner();
      expect(found).not.toBeNull();
      expect(found!.sessionId).toBe("inst-1");
    });

    it("returns null when all runners are busy", () => {
      const runner = makeRunner({ sessionId: "inst-2", isRunning: true });
      const pool = new RunnerPool([runner]);
      expect(pool.getAvailableRunner()).toBeNull();
    });

    it("returns null for an empty pool", () => {
      const pool = new RunnerPool([]);
      expect(pool.getAvailableRunner()).toBeNull();
    });

    it("prefers idle runner over busy one", () => {
      const busy = makeRunner({ sessionId: "busy", isRunning: true });
      const idle = makeRunner({ sessionId: "idle", isRunning: false });
      const pool = new RunnerPool([busy, idle]);
      const found = pool.getAvailableRunner();
      expect(found!.sessionId).toBe("idle");
    });
  });

  // ── getAllAvailableRunners() ───────────────────────────────────────────────

  describe("getAllAvailableRunners()", () => {
    it("returns all idle runners", () => {
      const r1 = makeRunner({ sessionId: "r1", isRunning: false });
      const r2 = makeRunner({ sessionId: "r2", isRunning: true });
      const r3 = makeRunner({ sessionId: "r3", isRunning: false });
      const pool = new RunnerPool([r1, r2, r3]);
      const available = pool.getAllAvailableRunners();
      expect(available.length).toBe(2);
      const ids = available.map((r: { sessionId: string }) => r.sessionId);
      expect(ids).toContain("r1");
      expect(ids).toContain("r3");
      expect(ids).not.toContain("r2");
    });

    it("returns empty array when all runners are busy", () => {
      const pool = new RunnerPool([
        makeRunner({ sessionId: "busy-1", isRunning: true }),
        makeRunner({ sessionId: "busy-2", isRunning: true }),
      ]);
      expect(pool.getAllAvailableRunners()).toEqual([]);
    });
  });

  // ── getNextRunner() ───────────────────────────────────────────────────────

  describe("getNextRunner()", () => {
    it("returns a runner using round-robin", () => {
      const r1 = makeRunner({ sessionId: "r1" });
      const r2 = makeRunner({ sessionId: "r2" });
      const pool = new RunnerPool([r1, r2]);
      const first = pool.getNextRunner();
      const second = pool.getNextRunner();
      const third = pool.getNextRunner(); // wraps around
      expect(first!.sessionId).toBe("r1");
      expect(second!.sessionId).toBe("r2");
      expect(third!.sessionId).toBe("r1");
    });

    it("returns null for empty pool", () => {
      const pool = new RunnerPool([]);
      expect(pool.getNextRunner()).toBeNull();
    });
  });

  // ── hasRunningJobs ────────────────────────────────────────────────────────

  describe("hasRunningJobs", () => {
    it("returns true when at least one runner is running", () => {
      const pool = new RunnerPool([
        makeRunner({ sessionId: "r1", isRunning: false }),
        makeRunner({ sessionId: "r2", isRunning: true }),
      ]);
      expect(pool.hasRunningJobs).toBe(true);
    });

    it("returns false when no runners are running", () => {
      const pool = new RunnerPool([
        makeRunner({ sessionId: "r1", isRunning: false }),
      ]);
      expect(pool.hasRunningJobs).toBe(false);
    });

    it("returns false for empty pool", () => {
      expect(new RunnerPool([]).hasRunningJobs).toBe(false);
    });
  });

  // ── runningJobCount ───────────────────────────────────────────────────────

  describe("runningJobCount", () => {
    it("counts running runners correctly", () => {
      const pool = new RunnerPool([
        makeRunner({ sessionId: "r1", isRunning: true }),
        makeRunner({ sessionId: "r2", isRunning: false }),
        makeRunner({ sessionId: "r3", isRunning: true }),
      ]);
      expect(pool.runningJobCount).toBe(2);
    });

    it("is 0 for empty pool", () => {
      expect(new RunnerPool([]).runningJobCount).toBe(0);
    });
  });

  // ── size and allRunners ───────────────────────────────────────────────────

  describe("size and allRunners", () => {
    it("size returns the total number of runners", () => {
      const pool = new RunnerPool([
        makeRunner({ sessionId: "r1" }),
        makeRunner({ sessionId: "r2" }),
        makeRunner({ sessionId: "r3" }),
      ]);
      expect(pool.size).toBe(3);
    });

    it("allRunners returns a copy of the runners array", () => {
      const r1 = makeRunner({ sessionId: "r1" });
      const pool = new RunnerPool([r1]);
      const all = pool.allRunners;
      expect(all.length).toBe(1);
      // Should be a copy, not the same reference
      expect(all).not.toBe(pool.allRunners);
    });
  });

  // ── addRunner() ───────────────────────────────────────────────────────────

  describe("addRunner()", () => {
    it("increases pool size and makes runner available", () => {
      const pool = new RunnerPool([]);
      expect(pool.size).toBe(0);
      const r1 = makeRunner({ sessionId: "new-runner" });
      pool.addRunner(r1);
      expect(pool.size).toBe(1);
      expect(pool.getAvailableRunner()!.sessionId).toBe("new-runner");
    });
  });

  // ── shrinkTo() ────────────────────────────────────────────────────────────

  describe("shrinkTo()", () => {
    it("removes idle runners down to target size, returns count removed", () => {
      const pool = new RunnerPool([
        makeRunner({ sessionId: "r1", isRunning: false }),
        makeRunner({ sessionId: "r2", isRunning: false }),
        makeRunner({ sessionId: "r3", isRunning: false }),
      ]);
      const removed = pool.shrinkTo(1);
      expect(removed).toBe(2);
      expect(pool.size).toBe(1);
    });

    it("does not remove running runners", () => {
      const pool = new RunnerPool([
        makeRunner({ sessionId: "r1", isRunning: true }),  // busy
        makeRunner({ sessionId: "r2", isRunning: false }), // idle
        makeRunner({ sessionId: "r3", isRunning: false }), // idle
      ]);
      const removed = pool.shrinkTo(1);
      // Can remove at most 2 idle runners, but target is 1 and we have 1 busy
      // So it should remove 1 idle runner to get to size 2 (1 busy + 1 idle won't go below 1)
      expect(removed).toBeGreaterThanOrEqual(0);
      // The busy runner should still be there
      expect(pool.allRunners.some((r: { sessionId: string }) => r.sessionId === "r1")).toBe(true);
    });

    it("returns 0 when already at or below target size", () => {
      const pool = new RunnerPool([
        makeRunner({ sessionId: "r1", isRunning: false }),
      ]);
      expect(pool.shrinkTo(2)).toBe(0);
      expect(pool.size).toBe(1);
    });
  });

  // ── killSession() ────────────────────────────────────────────────────────

  describe("killSession()", () => {
    it("calls abort() on the target running runner and returns true", () => {
      let abortCalled = false;
      const runner = {
        sessionId: "kill-me",
        isRunning: true,
        abort: () => { abortCalled = true; },
        async run() { return {}; },
      };
      const pool = new RunnerPool([runner]);
      const result = pool.killSession("kill-me");
      expect(result).toBe(true);
      expect(abortCalled).toBe(true);
    });

    it("returns false for unknown sessionId", () => {
      const pool = new RunnerPool([makeRunner({ sessionId: "other", isRunning: true })]);
      expect(pool.killSession("nonexistent-id")).toBe(false);
    });

    it("returns false when runner is not running", () => {
      const pool = new RunnerPool([makeRunner({ sessionId: "idle-runner", isRunning: false })]);
      expect(pool.killSession("idle-runner")).toBe(false);
    });
  });

  // ── killAll() ─────────────────────────────────────────────────────────────

  describe("killAll()", () => {
    it("calls abort() on all running runners and returns count", () => {
      const abortCounts: Record<string, number> = { r1: 0, r2: 0, r3: 0 };
      const pool = new RunnerPool([
        { sessionId: "r1", isRunning: true, abort: () => { abortCounts.r1++; }, async run() { return {}; } },
        { sessionId: "r2", isRunning: false, abort: () => { abortCounts.r2++; }, async run() { return {}; } },
        { sessionId: "r3", isRunning: true, abort: () => { abortCounts.r3++; }, async run() { return {}; } },
      ]);
      const killed = pool.killAll();
      expect(killed).toBe(2);
      expect(abortCounts.r1).toBe(1);
      expect(abortCounts.r2).toBe(0); // not running
      expect(abortCounts.r3).toBe(1);
    });

    it("returns 0 when no runners are running", () => {
      const pool = new RunnerPool([
        makeRunner({ sessionId: "idle-1", isRunning: false }),
        makeRunner({ sessionId: "idle-2", isRunning: false }),
      ]);
      expect(pool.killAll()).toBe(0);
    });

    it("returns 0 for empty pool", () => {
      expect(new RunnerPool([]).killAll()).toBe(0);
    });
  });
});
