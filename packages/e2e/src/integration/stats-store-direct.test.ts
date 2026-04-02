/**
 * Integration tests: stats/store.ts StatsStore query methods — no Docker required.
 *
 * The StatsStore wraps a SQLite database and provides CRUD + query operations
 * for run records, call edges, and webhook receipts. Many of these methods are
 * only invoked when agents actually run (Docker required), so they lack direct
 * coverage in non-Docker integration tests.
 *
 * This test file populates a StatsStore with synthetic data and exercises the
 * query/summary methods directly.
 *
 * Methods tested:
 *   - recordRun() + queryAgentSummary() — per-agent stats with since filter
 *   - queryGlobalSummary() — aggregated stats (totalRuns/okRuns/errorRuns/tokens)
 *   - recordCallEdge() + updateCallEdge() + queryCallGraph() — call graph edges
 *   - recordWebhookReceipt() + getWebhookDetailsBatch() — batch webhook lookups
 *   - updateRunSummary() + queryRunByInstanceId() — run summary update
 *   - queryRuns() — runs with since/agent/limit filters
 *   - prune() — deletes old records, returns change counts
 *
 * Covers:
 *   - stats/store.ts: StatsStore.queryAgentSummary() — with/without agent filter, since filter
 *   - stats/store.ts: StatsStore.queryGlobalSummary() — empty + populated + since filter
 *   - stats/store.ts: StatsStore.recordCallEdge() — insert, returns lastInsertRowid
 *   - stats/store.ts: StatsStore.updateCallEdge() — status/durationMs/targetInstance update
 *   - stats/store.ts: StatsStore.queryCallGraph() — aggregated edge summary
 *   - stats/store.ts: StatsStore.getWebhookDetailsBatch() — empty + populated + missing id
 *   - stats/store.ts: StatsStore.updateRunSummary() — summary field persisted
 *   - stats/store.ts: StatsStore.queryRuns() — with/without agent/since/limit
 *   - stats/store.ts: StatsStore.prune() — deletes old runs/edges/receipts
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

const { StatsStore } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/stats/store.js"
);

function makeTempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "al-stats-store-test-"));
  return join(dir, "stats.db");
}

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    instanceId: randomUUID(),
    agentName: "test-agent",
    triggerType: "manual",
    result: "completed",
    startedAt: Date.now(),
    durationMs: 1000,
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 150,
    costUsd: 0.001,
    turnCount: 3,
    ...overrides,
  };
}

describe("integration: stats/store.ts StatsStore query methods (no Docker required)", { timeout: 30_000 }, () => {

  // -------------------------------------------------------------------------
  // queryAgentSummary
  // -------------------------------------------------------------------------

  it("queryAgentSummary returns empty array when no runs exist", () => {
    const store = new StatsStore(makeTempDbPath());
    const summaries = store.queryAgentSummary();
    expect(summaries).toEqual([]);
    store.close();
  });

  it("queryAgentSummary aggregates runs per agent correctly", () => {
    const store = new StatsStore(makeTempDbPath());

    // Two completed runs and one error run for agent-a
    store.recordRun(makeRun({ agentName: "agent-a", result: "completed", durationMs: 1000, totalTokens: 100 }));
    store.recordRun(makeRun({ agentName: "agent-a", result: "completed", durationMs: 2000, totalTokens: 200 }));
    store.recordRun(makeRun({ agentName: "agent-a", result: "error", durationMs: 500, totalTokens: 50 }));
    // One run for agent-b
    store.recordRun(makeRun({ agentName: "agent-b", result: "completed", durationMs: 3000, totalTokens: 300 }));

    const all = store.queryAgentSummary();
    expect(all.length).toBe(2);

    const agentA = all.find((s: { agentName: string }) => s.agentName === "agent-a");
    expect(agentA).toBeDefined();
    expect(agentA.totalRuns).toBe(3);
    expect(agentA.okRuns).toBe(2);
    expect(agentA.errorRuns).toBe(1);
    expect(agentA.totalTokens).toBe(350);

    const agentB = all.find((s: { agentName: string }) => s.agentName === "agent-b");
    expect(agentB).toBeDefined();
    expect(agentB.totalRuns).toBe(1);
    expect(agentB.okRuns).toBe(1);
    expect(agentB.errorRuns).toBe(0);

    store.close();
  });

  it("queryAgentSummary with agent filter returns only that agent", () => {
    const store = new StatsStore(makeTempDbPath());
    store.recordRun(makeRun({ agentName: "agent-x", result: "completed" }));
    store.recordRun(makeRun({ agentName: "agent-y", result: "completed" }));

    const result = store.queryAgentSummary({ agent: "agent-x" });
    expect(result.length).toBe(1);
    expect(result[0].agentName).toBe("agent-x");

    store.close();
  });

  it("queryAgentSummary with since filter excludes older runs", () => {
    const store = new StatsStore(makeTempDbPath());
    const now = Date.now();

    store.recordRun(makeRun({ agentName: "agent-old", result: "completed", startedAt: now - 10_000 }));
    store.recordRun(makeRun({ agentName: "agent-new", result: "completed", startedAt: now }));

    const recent = store.queryAgentSummary({ since: now - 5_000 });
    // Only the recent run should appear
    expect(recent.some((s: { agentName: string }) => s.agentName === "agent-old")).toBe(false);
    expect(recent.some((s: { agentName: string }) => s.agentName === "agent-new")).toBe(true);

    store.close();
  });

  // -------------------------------------------------------------------------
  // queryGlobalSummary
  // -------------------------------------------------------------------------

  it("queryGlobalSummary returns zeros for empty store", () => {
    const store = new StatsStore(makeTempDbPath());
    const summary = store.queryGlobalSummary();
    expect(summary.totalRuns).toBe(0);
    expect(summary.okRuns).toBe(0);
    expect(summary.errorRuns).toBe(0);
    expect(summary.totalTokens).toBe(0);
    expect(summary.totalCost).toBe(0);
    store.close();
  });

  it("queryGlobalSummary aggregates across all agents", () => {
    const store = new StatsStore(makeTempDbPath());
    store.recordRun(makeRun({ agentName: "a1", result: "completed", totalTokens: 100, costUsd: 0.01 }));
    store.recordRun(makeRun({ agentName: "a2", result: "error", totalTokens: 50, costUsd: 0.005 }));
    store.recordRun(makeRun({ agentName: "a1", result: "rerun", totalTokens: 200, costUsd: 0.02 }));

    const summary = store.queryGlobalSummary();
    expect(summary.totalRuns).toBe(3);
    expect(summary.okRuns).toBe(2); // completed + rerun
    expect(summary.errorRuns).toBe(1);
    expect(summary.totalTokens).toBe(350);
    expect(typeof summary.totalCost).toBe("number");
    expect(summary.totalCost).toBeGreaterThan(0);

    store.close();
  });

  it("queryGlobalSummary with since filter excludes old runs", () => {
    const store = new StatsStore(makeTempDbPath());
    const now = Date.now();

    store.recordRun(makeRun({ result: "completed", startedAt: now - 100_000, totalTokens: 999 }));
    store.recordRun(makeRun({ result: "completed", startedAt: now, totalTokens: 1 }));

    const summary = store.queryGlobalSummary(now - 5_000);
    expect(summary.totalRuns).toBe(1);
    expect(summary.totalTokens).toBe(1);

    store.close();
  });

  // -------------------------------------------------------------------------
  // recordCallEdge + updateCallEdge + queryCallGraph
  // -------------------------------------------------------------------------

  it("recordCallEdge returns a positive integer row ID", () => {
    const store = new StatsStore(makeTempDbPath());
    const id = store.recordCallEdge({
      callerAgent: "caller",
      callerInstance: randomUUID(),
      targetAgent: "callee",
      depth: 1,
      startedAt: Date.now(),
    });
    expect(typeof id).toBe("number");
    expect(id).toBeGreaterThan(0);
    store.close();
  });

  it("updateCallEdge updates durationMs and status", () => {
    const store = new StatsStore(makeTempDbPath());
    const targetInstance = randomUUID();
    const id = store.recordCallEdge({
      callerAgent: "caller",
      callerInstance: randomUUID(),
      targetAgent: "callee",
      depth: 1,
      startedAt: Date.now(),
    });

    store.updateCallEdge(id, { durationMs: 5000, status: "completed", targetInstance });

    // Verify via queryCallEdgeByTargetInstance
    const edge = store.queryCallEdgeByTargetInstance(targetInstance);
    expect(edge).toBeDefined();
    expect(edge.duration_ms).toBe(5000);
    expect(edge.status).toBe("completed");
    expect(edge.target_instance).toBe(targetInstance);

    store.close();
  });

  it("queryCallGraph returns empty array when no call edges exist", () => {
    const store = new StatsStore(makeTempDbPath());
    const graph = store.queryCallGraph();
    expect(graph).toEqual([]);
    store.close();
  });

  it("queryCallGraph aggregates call edges by caller+target pair", () => {
    const store = new StatsStore(makeTempDbPath());
    const now = Date.now();

    // Three edges from orchestrator → worker
    store.recordCallEdge({ callerAgent: "orchestrator", callerInstance: randomUUID(), targetAgent: "worker", depth: 1, startedAt: now, durationMs: 1000 });
    store.recordCallEdge({ callerAgent: "orchestrator", callerInstance: randomUUID(), targetAgent: "worker", depth: 1, startedAt: now, durationMs: 2000 });
    store.recordCallEdge({ callerAgent: "orchestrator", callerInstance: randomUUID(), targetAgent: "worker", depth: 1, startedAt: now, durationMs: 3000 });

    // One edge from orchestrator → reporter
    store.recordCallEdge({ callerAgent: "orchestrator", callerInstance: randomUUID(), targetAgent: "reporter", depth: 1, startedAt: now });

    const graph = store.queryCallGraph();
    expect(graph.length).toBe(2);

    // The first result (most calls) should be orchestrator→worker
    const workerEdge = graph.find((e: { callerAgent: string; targetAgent: string }) =>
      e.callerAgent === "orchestrator" && e.targetAgent === "worker"
    );
    expect(workerEdge).toBeDefined();
    expect(workerEdge.count).toBe(3);
    expect(typeof workerEdge.avgDepth).toBe("number");
    expect(workerEdge.avgDurationMs).toBeCloseTo(2000, 0);

    store.close();
  });

  it("queryCallGraph with since filter excludes old edges", () => {
    const store = new StatsStore(makeTempDbPath());
    const now = Date.now();

    store.recordCallEdge({ callerAgent: "a", callerInstance: randomUUID(), targetAgent: "b", depth: 1, startedAt: now - 100_000 });
    store.recordCallEdge({ callerAgent: "a", callerInstance: randomUUID(), targetAgent: "b", depth: 1, startedAt: now });

    const filtered = store.queryCallGraph({ since: now - 5_000 });
    expect(filtered.length).toBe(1);
    expect(filtered[0].count).toBe(1);

    store.close();
  });

  // -------------------------------------------------------------------------
  // getWebhookDetailsBatch
  // -------------------------------------------------------------------------

  it("getWebhookDetailsBatch returns empty object for empty ids array", () => {
    const store = new StatsStore(makeTempDbPath());
    const result = store.getWebhookDetailsBatch([]);
    expect(result).toEqual({});
    store.close();
  });

  it("getWebhookDetailsBatch returns source and eventSummary for known receipts", () => {
    const store = new StatsStore(makeTempDbPath());
    const id1 = randomUUID();
    const id2 = randomUUID();

    store.recordWebhookReceipt({
      id: id1,
      source: "github",
      eventSummary: "push to main",
      timestamp: Date.now(),
      matchedAgents: 1,
      status: "processed",
    });
    store.recordWebhookReceipt({
      id: id2,
      source: "slack",
      // no eventSummary
      timestamp: Date.now(),
      matchedAgents: 0,
      status: "dead-letter",
      deadLetterReason: "no_match",
    });

    const details = store.getWebhookDetailsBatch([id1, id2]);
    expect(details[id1]).toBeDefined();
    expect(details[id1].source).toBe("github");
    expect(details[id1].eventSummary).toBe("push to main");

    expect(details[id2]).toBeDefined();
    expect(details[id2].source).toBe("slack");
    expect(details[id2].eventSummary).toBeUndefined();

    store.close();
  });

  it("getWebhookDetailsBatch omits entries for unknown IDs", () => {
    const store = new StatsStore(makeTempDbPath());
    const knownId = randomUUID();
    const unknownId = randomUUID();

    store.recordWebhookReceipt({
      id: knownId,
      source: "github",
      timestamp: Date.now(),
      matchedAgents: 1,
      status: "processed",
    });

    const details = store.getWebhookDetailsBatch([knownId, unknownId]);
    expect(details[knownId]).toBeDefined();
    expect(details[unknownId]).toBeUndefined();

    store.close();
  });

  // -------------------------------------------------------------------------
  // updateRunSummary
  // -------------------------------------------------------------------------

  it("updateRunSummary stores summary text on the run record", () => {
    const store = new StatsStore(makeTempDbPath());
    const instanceId = randomUUID();
    store.recordRun(makeRun({ instanceId }));

    // Before update — summary column may be null/undefined
    const before = store.queryRunByInstanceId(instanceId);
    expect(before).toBeDefined();
    expect(before.summary ?? null).toBeNull();

    store.updateRunSummary(instanceId, "The agent completed the task successfully.");

    const after = store.queryRunByInstanceId(instanceId);
    expect(after.summary).toBe("The agent completed the task successfully.");

    store.close();
  });

  it("updateRunSummary no-ops gracefully for unknown instanceId", () => {
    const store = new StatsStore(makeTempDbPath());
    // Should not throw
    expect(() => store.updateRunSummary(randomUUID(), "summary text")).not.toThrow();
    store.close();
  });

  // -------------------------------------------------------------------------
  // queryRuns
  // -------------------------------------------------------------------------

  it("queryRuns returns all runs when no filter applied", () => {
    const store = new StatsStore(makeTempDbPath());
    store.recordRun(makeRun({ agentName: "a" }));
    store.recordRun(makeRun({ agentName: "b" }));
    store.recordRun(makeRun({ agentName: "c" }));

    const runs = store.queryRuns();
    expect(runs.length).toBe(3);

    store.close();
  });

  it("queryRuns with agent filter returns only that agent's runs", () => {
    const store = new StatsStore(makeTempDbPath());
    store.recordRun(makeRun({ agentName: "alpha" }));
    store.recordRun(makeRun({ agentName: "alpha" }));
    store.recordRun(makeRun({ agentName: "beta" }));

    const runs = store.queryRuns({ agent: "alpha" });
    expect(runs.length).toBe(2);
    expect(runs.every((r: { agent_name: string }) => r.agent_name === "alpha")).toBe(true);

    store.close();
  });

  it("queryRuns with since filter excludes older runs", () => {
    const store = new StatsStore(makeTempDbPath());
    const now = Date.now();
    store.recordRun(makeRun({ startedAt: now - 100_000 }));
    store.recordRun(makeRun({ startedAt: now }));

    const recent = store.queryRuns({ since: now - 5_000 });
    expect(recent.length).toBe(1);

    store.close();
  });

  it("queryRuns with limit caps the result count", () => {
    const store = new StatsStore(makeTempDbPath());
    for (let i = 0; i < 10; i++) {
      store.recordRun(makeRun());
    }

    const limited = store.queryRuns({ limit: 3 });
    expect(limited.length).toBe(3);

    store.close();
  });

  // -------------------------------------------------------------------------
  // prune — returns change counts including callEdges and receipts
  // -------------------------------------------------------------------------

  it("prune deletes runs, callEdges, and receipts older than threshold", () => {
    const store = new StatsStore(makeTempDbPath());
    const now = Date.now();
    const old = now - 10 * 24 * 60 * 60 * 1000; // 10 days ago

    // Insert old and new records
    store.recordRun(makeRun({ startedAt: old }));
    store.recordRun(makeRun({ startedAt: now }));

    store.recordCallEdge({ callerAgent: "a", callerInstance: randomUUID(), targetAgent: "b", depth: 1, startedAt: old });
    store.recordCallEdge({ callerAgent: "a", callerInstance: randomUUID(), targetAgent: "b", depth: 1, startedAt: now });

    store.recordWebhookReceipt({ id: randomUUID(), source: "github", timestamp: old, matchedAgents: 1, status: "processed" });
    store.recordWebhookReceipt({ id: randomUUID(), source: "github", timestamp: now, matchedAgents: 1, status: "processed" });

    // Prune records older than 5 days
    const result = store.prune(5);
    expect(result.runs).toBe(1);
    expect(result.callEdges).toBe(1);
    expect(result.receipts).toBe(1);

    // New records survive
    const remaining = store.queryRuns();
    expect(remaining.length).toBe(1);

    store.close();
  });

  it("prune returns zeros when no records are old enough", () => {
    const store = new StatsStore(makeTempDbPath());
    store.recordRun(makeRun({ startedAt: Date.now() }));

    const result = store.prune(30); // 30-day threshold, everything is recent
    expect(result.runs).toBe(0);
    expect(result.callEdges).toBe(0);
    expect(result.receipts).toBe(0);

    store.close();
  });
});
