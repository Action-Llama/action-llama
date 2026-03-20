import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { StatsStore } from "../../src/stats/store.js";
import type { RunRecord, CallEdgeRecord } from "../../src/stats/store.js";

describe("StatsStore", () => {
  const dirs: string[] = [];

  function createStore(): StatsStore {
    const dir = mkdtempSync(join(tmpdir(), "al-stats-"));
    dirs.push(dir);
    return new StatsStore(join(dir, "stats.db"));
  }

  function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
    return {
      instanceId: "agent-abc123",
      agentName: "reporter",
      triggerType: "schedule",
      result: "completed",
      startedAt: Date.now(),
      durationMs: 30000,
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 200,
      cacheWriteTokens: 100,
      totalTokens: 1800,
      costUsd: 0.05,
      turnCount: 3,
      ...overrides,
    };
  }

  afterEach(() => {
    for (const dir of dirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it("records and queries a run", () => {
    const store = createStore();
    const run = makeRun();
    store.recordRun(run);

    const rows = store.queryRuns({ since: 0 });
    expect(rows).toHaveLength(1);
    expect(rows[0].agent_name).toBe("reporter");
    expect(rows[0].instance_id).toBe("agent-abc123");
    expect(rows[0].trigger_type).toBe("schedule");
    expect(rows[0].result).toBe("completed");
    expect(rows[0].total_tokens).toBe(1800);
    expect(rows[0].cost_usd).toBeCloseTo(0.05);
    store.close();
  });

  it("queries runs filtered by agent", () => {
    const store = createStore();
    store.recordRun(makeRun({ agentName: "reporter" }));
    store.recordRun(makeRun({ agentName: "reviewer" }));
    store.recordRun(makeRun({ agentName: "reporter" }));

    const rows = store.queryRuns({ agent: "reporter", since: 0 });
    expect(rows).toHaveLength(2);
    expect(rows.every((r: any) => r.agent_name === "reporter")).toBe(true);
    store.close();
  });

  it("respects limit in queryRuns", () => {
    const store = createStore();
    for (let i = 0; i < 10; i++) {
      store.recordRun(makeRun({ startedAt: Date.now() - i * 1000 }));
    }

    const rows = store.queryRuns({ since: 0, limit: 3 });
    expect(rows).toHaveLength(3);
    store.close();
  });

  it("queryRuns respects since filter", () => {
    const store = createStore();
    const now = Date.now();
    store.recordRun(makeRun({ startedAt: now - 86400_000 * 2 })); // 2 days ago
    store.recordRun(makeRun({ startedAt: now - 3600_000 })); // 1 hour ago
    store.recordRun(makeRun({ startedAt: now }));

    const rows = store.queryRuns({ since: now - 86400_000 }); // last 24h
    expect(rows).toHaveLength(2);
    store.close();
  });

  it("computes agent summary", () => {
    const store = createStore();
    const now = Date.now();
    store.recordRun(makeRun({ agentName: "reporter", result: "completed", durationMs: 20000, totalTokens: 1000, costUsd: 0.05, startedAt: now }));
    store.recordRun(makeRun({ agentName: "reporter", result: "completed", durationMs: 40000, totalTokens: 2000, costUsd: 0.10, startedAt: now }));
    store.recordRun(makeRun({ agentName: "reporter", result: "error", durationMs: 10000, totalTokens: 500, costUsd: 0.02, startedAt: now }));

    const summaries = store.queryAgentSummary({ since: 0 });
    expect(summaries).toHaveLength(1);
    const s = summaries[0];
    expect(s.totalRuns).toBe(3);
    expect(s.okRuns).toBe(2);
    expect(s.errorRuns).toBe(1);
    expect(s.totalTokens).toBe(3500);
    expect(s.totalCost).toBeCloseTo(0.17);
    store.close();
  });

  it("computes global summary", () => {
    const store = createStore();
    const now = Date.now();
    store.recordRun(makeRun({ agentName: "a", result: "completed", totalTokens: 1000, costUsd: 0.10, startedAt: now }));
    store.recordRun(makeRun({ agentName: "b", result: "error", totalTokens: 500, costUsd: 0.05, startedAt: now }));

    const global = store.queryGlobalSummary(0);
    expect(global.totalRuns).toBe(2);
    expect(global.okRuns).toBe(1);
    expect(global.errorRuns).toBe(1);
    expect(global.totalTokens).toBe(1500);
    expect(global.totalCost).toBeCloseTo(0.15);
    store.close();
  });

  it("records and queries call edges", () => {
    const store = createStore();
    const now = Date.now();
    const id = store.recordCallEdge({
      callerAgent: "orchestrator",
      callerInstance: "orch-abc",
      targetAgent: "reviewer",
      depth: 1,
      startedAt: now,
      status: "pending",
    });
    expect(typeof id).toBe("number");
    expect(id).toBeGreaterThan(0);

    store.updateCallEdge(id, { durationMs: 45000, status: "completed", targetInstance: "rev-xyz" });

    const edges = store.queryCallGraph({ since: 0 });
    expect(edges).toHaveLength(1);
    expect(edges[0].callerAgent).toBe("orchestrator");
    expect(edges[0].targetAgent).toBe("reviewer");
    expect(edges[0].count).toBe(1);
    store.close();
  });

  it("aggregates call graph correctly", () => {
    const store = createStore();
    const now = Date.now();

    for (let i = 0; i < 5; i++) {
      const id = store.recordCallEdge({
        callerAgent: "orchestrator",
        callerInstance: `orch-${i}`,
        targetAgent: "reviewer",
        depth: 1,
        startedAt: now,
      });
      store.updateCallEdge(id, { durationMs: 10000 + i * 1000, status: "completed" });
    }

    const edges = store.queryCallGraph({ since: 0 });
    expect(edges).toHaveLength(1);
    expect(edges[0].count).toBe(5);
    expect(edges[0].avgDepth).toBeCloseTo(1);
    expect(edges[0].avgDurationMs).toBeCloseTo(12000);
    store.close();
  });

  it("prunes old data", () => {
    const store = createStore();
    const now = Date.now();
    const oldTime = now - 100 * 86400_000; // 100 days ago

    store.recordRun(makeRun({ startedAt: oldTime }));
    store.recordRun(makeRun({ startedAt: now }));
    store.recordCallEdge({
      callerAgent: "a",
      callerInstance: "a-1",
      targetAgent: "b",
      depth: 1,
      startedAt: oldTime,
    });
    store.recordCallEdge({
      callerAgent: "a",
      callerInstance: "a-2",
      targetAgent: "b",
      depth: 1,
      startedAt: now,
    });

    const pruned = store.prune(90);
    expect(pruned.runs).toBe(1);
    expect(pruned.callEdges).toBe(1);

    // Only recent data remains
    expect(store.queryRuns({ since: 0 })).toHaveLength(1);
    expect(store.queryCallGraph({ since: 0 })).toHaveLength(1);
    store.close();
  });

  it("records hook timing", () => {
    const store = createStore();
    store.recordRun(makeRun({ preHookMs: 1200, postHookMs: 800 }));

    const rows = store.queryRuns({ since: 0 });
    expect(rows[0].pre_hook_ms).toBe(1200);
    expect(rows[0].post_hook_ms).toBe(800);
    store.close();
  });

  it("handles null optional fields", () => {
    const store = createStore();
    store.recordRun(makeRun({
      triggerSource: undefined,
      exitCode: undefined,
      errorMessage: undefined,
      preHookMs: undefined,
      postHookMs: undefined,
    }));

    const rows = store.queryRuns({ since: 0 });
    expect(rows[0].trigger_source).toBeNull();
    expect(rows[0].exit_code).toBeNull();
    expect(rows[0].error_message).toBeNull();
    expect(rows[0].pre_hook_ms).toBeNull();
    expect(rows[0].post_hook_ms).toBeNull();
    store.close();
  });

  it("returns empty summary for no data", () => {
    const store = createStore();
    const global = store.queryGlobalSummary(0);
    expect(global.totalRuns).toBe(0);
    expect(global.totalTokens).toBe(0);
    expect(global.totalCost).toBe(0);

    const summaries = store.queryAgentSummary({ since: 0 });
    expect(summaries).toHaveLength(0);
    store.close();
  });

  it("queries runs paginated by agent", () => {
    const store = createStore();
    const now = Date.now();
    for (let i = 0; i < 15; i++) {
      store.recordRun(makeRun({ agentName: "reporter", startedAt: now - i * 1000, instanceId: `reporter-${i}` }));
    }
    store.recordRun(makeRun({ agentName: "reviewer", startedAt: now }));

    // Page 1
    const page1 = store.queryRunsByAgentPaginated("reporter", 5, 0);
    expect(page1).toHaveLength(5);
    expect(page1[0].instance_id).toBe("reporter-0"); // most recent first

    // Page 2
    const page2 = store.queryRunsByAgentPaginated("reporter", 5, 5);
    expect(page2).toHaveLength(5);
    expect(page2[0].instance_id).toBe("reporter-5");

    // Page 4 (partial)
    const page4 = store.queryRunsByAgentPaginated("reporter", 5, 15);
    expect(page4).toHaveLength(0);

    store.close();
  });

  it("counts runs by agent", () => {
    const store = createStore();
    store.recordRun(makeRun({ agentName: "reporter" }));
    store.recordRun(makeRun({ agentName: "reporter" }));
    store.recordRun(makeRun({ agentName: "reviewer" }));

    expect(store.countRunsByAgent("reporter")).toBe(2);
    expect(store.countRunsByAgent("reviewer")).toBe(1);
    expect(store.countRunsByAgent("nonexistent")).toBe(0);
    store.close();
  });

  it("queries single run by instance ID", () => {
    const store = createStore();
    store.recordRun(makeRun({ instanceId: "reporter-abc123", agentName: "reporter" }));
    store.recordRun(makeRun({ instanceId: "reviewer-xyz789", agentName: "reviewer" }));

    const run = store.queryRunByInstanceId("reporter-abc123");
    expect(run).toBeDefined();
    expect(run.agent_name).toBe("reporter");

    const missing = store.queryRunByInstanceId("nonexistent");
    expect(missing).toBeUndefined();
    store.close();
  });

  it("counts rerun as ok in summary", () => {
    const store = createStore();
    store.recordRun(makeRun({ result: "rerun", startedAt: Date.now() }));

    const summaries = store.queryAgentSummary({ since: 0 });
    expect(summaries[0].okRuns).toBe(1);
    expect(summaries[0].errorRuns).toBe(0);
    store.close();
  });
});
