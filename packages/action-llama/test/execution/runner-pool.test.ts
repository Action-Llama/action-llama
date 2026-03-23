import { describe, it, expect, vi, beforeEach } from "vitest";
import { RunnerPool } from "../../src/execution/runner-pool.js";

interface MockRunner {
  isRunning: boolean;
  instanceId: string;
  run: Function;
  abort?: Function;
}

describe("RunnerPool", () => {
  let pool: RunnerPool;
  let runner1: MockRunner;
  let runner2: MockRunner;
  let runner3: MockRunner;

  beforeEach(() => {
    runner1 = { isRunning: false, instanceId: "agent-aabbcc01", run: vi.fn() };
    runner2 = { isRunning: false, instanceId: "agent-aabbcc02", run: vi.fn() };
    runner3 = { isRunning: false, instanceId: "agent-aabbcc03", run: vi.fn() };
  });

  describe("constructor", () => {
    it("allows empty pool for disabled agents (scale = 0)", () => {
      pool = new RunnerPool([]);
      expect(pool.size).toBe(0);
      expect(pool.getAvailableRunner()).toBeNull();
      expect(pool.getNextRunner()).toBeNull();
      expect(pool.hasRunningJobs).toBe(false);
      expect(pool.runningJobCount).toBe(0);
    });

    it("creates pool with single runner", () => {
      pool = new RunnerPool([runner1]);
      expect(pool.size).toBe(1);
    });

    it("creates pool with multiple runners", () => {
      pool = new RunnerPool([runner1, runner2, runner3]);
      expect(pool.size).toBe(3);
    });
  });

  describe("getAvailableRunner", () => {
    beforeEach(() => {
      pool = new RunnerPool([runner1, runner2, runner3]);
    });

    it("returns available runner when all are idle", () => {
      const available = pool.getAvailableRunner();
      expect(available).toBeTruthy();
      expect([runner1, runner2, runner3]).toContain(available);
    });

    it("returns available runner when some are busy", () => {
      runner1.isRunning = true;
      runner2.isRunning = true;

      const available = pool.getAvailableRunner();
      expect(available).toBe(runner3);
    });

    it("returns null when all runners are busy", () => {
      runner1.isRunning = true;
      runner2.isRunning = true;
      runner3.isRunning = true;

      const available = pool.getAvailableRunner();
      expect(available).toBeNull();
    });
  });

  describe("getAllAvailableRunners", () => {
    beforeEach(() => {
      pool = new RunnerPool([runner1, runner2, runner3]);
    });

    it("returns all runners when all are idle", () => {
      const available = pool.getAllAvailableRunners();
      expect(available).toHaveLength(3);
      expect(available).toContain(runner1);
      expect(available).toContain(runner2);
      expect(available).toContain(runner3);
    });

    it("returns only available runners when some are busy", () => {
      runner1.isRunning = true;
      runner2.isRunning = true;

      const available = pool.getAllAvailableRunners();
      expect(available).toHaveLength(1);
      expect(available).toContain(runner3);
    });

    it("returns empty array when all runners are busy", () => {
      runner1.isRunning = true;
      runner2.isRunning = true;
      runner3.isRunning = true;

      const available = pool.getAllAvailableRunners();
      expect(available).toHaveLength(0);
    });

    it("returns empty array for empty pool", () => {
      const emptyPool = new RunnerPool([]);
      const available = emptyPool.getAllAvailableRunners();
      expect(available).toHaveLength(0);
    });
  });

  describe("getNextRunner", () => {
    beforeEach(() => {
      pool = new RunnerPool([runner1, runner2, runner3]);
    });

    it("returns runners in round-robin order", () => {
      expect(pool.getNextRunner()).toBe(runner1);
      expect(pool.getNextRunner()).toBe(runner2);
      expect(pool.getNextRunner()).toBe(runner3);
      expect(pool.getNextRunner()).toBe(runner1); // wraps around
    });

    it("returns busy runners if they are next in rotation", () => {
      runner2.isRunning = true;
      
      expect(pool.getNextRunner()).toBe(runner1);
      expect(pool.getNextRunner()).toBe(runner2); // still returns busy runner
      expect(pool.getNextRunner()).toBe(runner3);
    });
  });

  describe("status properties", () => {
    beforeEach(() => {
      pool = new RunnerPool([runner1, runner2, runner3]);
    });

    it("hasRunningJobs returns false when all idle", () => {
      expect(pool.hasRunningJobs).toBe(false);
    });

    it("hasRunningJobs returns true when any running", () => {
      runner2.isRunning = true;
      expect(pool.hasRunningJobs).toBe(true);
    });

    it("runningJobCount returns correct count", () => {
      expect(pool.runningJobCount).toBe(0);
      
      runner1.isRunning = true;
      expect(pool.runningJobCount).toBe(1);
      
      runner3.isRunning = true;
      expect(pool.runningJobCount).toBe(2);
    });

    it("size returns total runner count", () => {
      expect(pool.size).toBe(3);
    });

    it("allRunners returns copy of runners array", () => {
      const runners = pool.allRunners;
      expect(runners).toEqual([runner1, runner2, runner3]);
      expect(runners).not.toBe(pool.allRunners); // should be a new array each time
    });
  });

  describe("killAll", () => {
    it("returns 0 for empty pool", () => {
      pool = new RunnerPool([]);
      expect(pool.killAll()).toBe(0);
    });

    it("calls abort on all running runners", () => {
      runner1.isRunning = true;
      runner1.abort = vi.fn();
      runner2.isRunning = true;
      runner2.abort = vi.fn();
      runner3.isRunning = false;
      runner3.abort = vi.fn();

      pool = new RunnerPool([runner1, runner2, runner3]);
      const killed = pool.killAll();

      expect(killed).toBe(2);
      expect(runner1.abort).toHaveBeenCalled();
      expect(runner2.abort).toHaveBeenCalled();
      expect(runner3.abort).not.toHaveBeenCalled();
    });

    it("skips runners without abort method", () => {
      runner1.isRunning = true;
      // runner1 has no abort
      runner2.isRunning = true;
      runner2.abort = vi.fn();

      pool = new RunnerPool([runner1, runner2]);
      const killed = pool.killAll();

      expect(killed).toBe(1);
      expect(runner2.abort).toHaveBeenCalled();
    });

    it("returns 0 when no runners are running", () => {
      runner1.abort = vi.fn();
      runner2.abort = vi.fn();
      pool = new RunnerPool([runner1, runner2]);

      expect(pool.killAll()).toBe(0);
      expect(runner1.abort).not.toHaveBeenCalled();
      expect(runner2.abort).not.toHaveBeenCalled();
    });
  });

  describe("killInstance", () => {
    it("finds and aborts a running runner by instanceId", () => {
      runner2.isRunning = true;
      runner2.abort = vi.fn();
      pool = new RunnerPool([runner1, runner2, runner3]);

      expect(pool.killInstance("agent-aabbcc02")).toBe(true);
      expect(runner2.abort).toHaveBeenCalled();
    });

    it("returns false for unknown instanceId", () => {
      pool = new RunnerPool([runner1, runner2]);
      expect(pool.killInstance("nonexistent")).toBe(false);
    });

    it("returns false when runner exists but is not running", () => {
      runner1.abort = vi.fn();
      pool = new RunnerPool([runner1]);

      expect(pool.killInstance("agent-aabbcc01")).toBe(false);
      expect(runner1.abort).not.toHaveBeenCalled();
    });

    it("handles runner without abort method", () => {
      runner1.isRunning = true;
      // no abort method
      pool = new RunnerPool([runner1]);

      expect(pool.killInstance("agent-aabbcc01")).toBe(true);
    });
  });

  describe("single runner pool", () => {
    beforeEach(() => {
      pool = new RunnerPool([runner1]);
    });

    it("getAvailableRunner works with single runner", () => {
      expect(pool.getAvailableRunner()).toBe(runner1);

      runner1.isRunning = true;
      expect(pool.getAvailableRunner()).toBeNull();
    });

    it("getNextRunner always returns the same runner", () => {
      expect(pool.getNextRunner()).toBe(runner1);
      expect(pool.getNextRunner()).toBe(runner1);
      expect(pool.getNextRunner()).toBe(runner1);
    });
  });
});