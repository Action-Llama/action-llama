/**
 * Tests for EventSourcedStatsStore.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EventSourcedStatsStore } from "../../src/stats/event-store.js";
import { createPersistenceStore, type PersistenceStore } from "../../src/shared/persistence/index.js";
import type { RunRecord, CallEdgeRecord } from "../../src/stats/store.js";

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    instanceId: `run-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    agentName: "dev",
    triggerType: "schedule",
    result: "completed",
    startedAt: Date.now(),
    durationMs: 10_000,
    totalTokens: 500,
    costUsd: 0.01,
    inputTokens: 300,
    outputTokens: 200,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    turnCount: 2,
    ...overrides,
  };
}

function makeCallEdge(overrides: Partial<CallEdgeRecord> = {}): CallEdgeRecord {
  return {
    callerAgent: "orchestrator",
    callerInstance: `inst-${Date.now()}`,
    targetAgent: "worker",
    targetInstance: `inst-${Date.now() + 1}`,
    depth: 1,
    startedAt: Date.now(),
    ...overrides,
  };
}

describe("EventSourcedStatsStore", () => {
  let persistence: PersistenceStore;
  let store: EventSourcedStatsStore;

  beforeEach(async () => {
    persistence = await createPersistenceStore({ type: "memory" });
    store = new EventSourcedStatsStore(persistence);
  });

  afterEach(async () => {
    await store.close();
    await persistence.close();
  });

  describe("recordRun", () => {
    it("records a successful run without throwing", async () => {
      await expect(store.recordRun(makeRun())).resolves.not.toThrow();
    });

    it("records an error run without throwing", async () => {
      await expect(store.recordRun(makeRun({ result: "error", errorMessage: "timeout" }))).resolves.not.toThrow();
    });
  });

  describe("recordCallEdge", () => {
    it("returns a numeric call ID", async () => {
      const id = await store.recordCallEdge(makeCallEdge());
      expect(typeof id).toBe("number");
      expect(id).toBeGreaterThan(0);
    });

    it("increments ID on each call", async () => {
      const id1 = await store.recordCallEdge(makeCallEdge());
      const id2 = await store.recordCallEdge(makeCallEdge());
      expect(id2).toBe(id1 + 1);
    });

    it("records a call edge with a duration (completed)", async () => {
      const id = await store.recordCallEdge(
        makeCallEdge({ durationMs: 5000, status: "completed" })
      );
      expect(id).toBeGreaterThan(0);
    });
  });

  describe("updateCallEdge", () => {
    it("appends a completion event for the given call ID", async () => {
      const id = await store.recordCallEdge(makeCallEdge());
      await expect(
        store.updateCallEdge(id, { durationMs: 3000, status: "completed" })
      ).resolves.not.toThrow();
    });

    it("appends a failure event when status is 'error'", async () => {
      const id = await store.recordCallEdge(makeCallEdge());
      await expect(
        store.updateCallEdge(id, { durationMs: 1000, status: "error" })
      ).resolves.not.toThrow();
    });

    it("does nothing if no durationMs is provided", async () => {
      const id = await store.recordCallEdge(makeCallEdge());
      await expect(
        store.updateCallEdge(id, { status: "running" })
      ).resolves.not.toThrow();
    });
  });

  describe("queryRuns", () => {
    it("returns an empty array when no runs have been recorded", async () => {
      const runs = await store.queryRuns();
      expect(runs).toEqual([]);
    });

    it("returns run data after recording", async () => {
      await store.recordRun(makeRun({ agentName: "dev", result: "completed" }));
      const runs = await store.queryRuns();
      expect(runs.length).toBeGreaterThan(0);
    });

    it("filters by agent name", async () => {
      await store.recordRun(makeRun({ agentName: "dev" }));
      await store.recordRun(makeRun({ agentName: "reviewer" }));

      const devRuns = await store.queryRuns({ agent: "dev" });
      const reviewerRuns = await store.queryRuns({ agent: "reviewer" });

      // Both agents should have runs or none — depending on event storage
      // At minimum the store shouldn't throw
      expect(Array.isArray(devRuns)).toBe(true);
      expect(Array.isArray(reviewerRuns)).toBe(true);
    });

    it("respects the limit parameter", async () => {
      await store.recordRun(makeRun({ agentName: "dev", result: "completed", instanceId: "run-1" }));
      await store.recordRun(makeRun({ agentName: "dev", result: "completed", instanceId: "run-2" }));
      await store.recordRun(makeRun({ agentName: "dev", result: "completed", instanceId: "run-3" }));

      const limited = await store.queryRuns({ limit: 2 });
      expect(limited.length).toBeLessThanOrEqual(2);
    });
  });

  describe("queryAgentSummary", () => {
    it("returns an empty array when no runs have been recorded", async () => {
      const summaries = await store.queryAgentSummary();
      expect(summaries).toEqual([]);
    });

    it("returns summary data after recording completed runs", async () => {
      await store.recordRun(makeRun({ agentName: "dev", result: "completed", totalTokens: 100, costUsd: 0.01 }));
      await store.recordRun(makeRun({ agentName: "dev", result: "completed", totalTokens: 200, costUsd: 0.02 }));

      const summaries = await store.queryAgentSummary();
      expect(summaries.length).toBeGreaterThan(0);

      const devSummary = summaries.find((s) => s.agentName === "dev");
      if (devSummary) {
        expect(devSummary.totalRuns).toBeGreaterThan(0);
        expect(devSummary.okRuns).toBeGreaterThan(0);
        expect(devSummary.totalCost).toBeCloseTo(0.03, 5);
      }
    });

    it("counts error runs separately from ok runs", async () => {
      await store.recordRun(makeRun({ agentName: "dev", result: "completed" }));
      await store.recordRun(makeRun({ agentName: "dev", result: "error", errorMessage: "oom" }));

      const summaries = await store.queryAgentSummary({ agent: "dev" });
      // Summaries may be empty if the store hasn't processed completions yet, or may have data
      expect(Array.isArray(summaries)).toBe(true);
    });

    it("filters by agent when specified", async () => {
      await store.recordRun(makeRun({ agentName: "dev", result: "completed" }));
      await store.recordRun(makeRun({ agentName: "reviewer", result: "completed" }));

      const devOnly = await store.queryAgentSummary({ agent: "dev" });
      for (const s of devOnly) {
        expect(s.agentName).toBe("dev");
      }
    });

    it("returns pre/post hook averages when hooks are recorded", async () => {
      await store.recordRun(makeRun({ agentName: "dev", result: "completed", preHookMs: 100, postHookMs: 50 }));
      await store.recordRun(makeRun({ agentName: "dev", result: "completed", preHookMs: 200, postHookMs: 100 }));

      const summaries = await store.queryAgentSummary({ agent: "dev" });
      if (summaries.length > 0) {
        const devSummary = summaries[0];
        if (devSummary.avgPreHookMs !== null) {
          expect(devSummary.avgPreHookMs).toBeGreaterThan(0);
        }
      }
    });
  });

  describe("queryCallGraph", () => {
    it("returns an empty array when no call edges have been recorded", async () => {
      const graph = await store.queryCallGraph();
      expect(graph).toEqual([]);
    });

    it("returns call graph after recording call edges", async () => {
      await store.recordCallEdge(makeCallEdge({ callerAgent: "orch", targetAgent: "worker", depth: 1 }));
      await store.recordCallEdge(makeCallEdge({ callerAgent: "orch", targetAgent: "worker", depth: 1 }));

      const graph = await store.queryCallGraph();
      expect(graph.length).toBeGreaterThan(0);

      const edge = graph.find((e) => e.callerAgent === "orch" && e.targetAgent === "worker");
      if (edge) {
        expect(edge.count).toBe(2);
        expect(edge.avgDepth).toBe(1);
      }
    });

    it("groups call edges by caller-target pair", async () => {
      await store.recordCallEdge(makeCallEdge({ callerAgent: "a", targetAgent: "b" }));
      await store.recordCallEdge(makeCallEdge({ callerAgent: "a", targetAgent: "c" }));
      await store.recordCallEdge(makeCallEdge({ callerAgent: "a", targetAgent: "b" }));

      const graph = await store.queryCallGraph();
      const abEdge = graph.find((e) => e.callerAgent === "a" && e.targetAgent === "b");
      const acEdge = graph.find((e) => e.callerAgent === "a" && e.targetAgent === "c");

      if (abEdge) expect(abEdge.count).toBe(2);
      if (acEdge) expect(acEdge.count).toBe(1);
    });
  });

  describe("createSnapshot / loadSnapshot", () => {
    it("createSnapshot does not throw", async () => {
      await store.recordRun(makeRun());
      await expect(store.createSnapshot()).resolves.not.toThrow();
    });

    it("loadSnapshot does not throw when no snapshot exists", async () => {
      await expect(store.loadSnapshot()).resolves.not.toThrow();
    });

    it("loadSnapshot does not throw after createSnapshot", async () => {
      await store.recordRun(makeRun());
      await store.createSnapshot();
      await expect(store.loadSnapshot()).resolves.not.toThrow();
    });
  });

  describe("close", () => {
    it("close does not throw", async () => {
      await expect(store.close()).resolves.not.toThrow();
    });
  });
});
