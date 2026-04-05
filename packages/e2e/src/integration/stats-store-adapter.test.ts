/**
 * Integration tests: shared/persistence/adapters/stats-store.ts StatsStoreAdapter — no Docker required.
 *
 * StatsStoreAdapter implements the StatsStore interface using the unified
 * persistence layer. It stores run records as events on the "stats" event stream
 * and provides query methods that execute raw SQL against the SQLite database.
 *
 * Public API:
 *   - recordRun(run)         — fire-and-forget event write
 *   - recordCallEdge(edge)   — fire-and-forget, returns numeric callId
 *   - updateCallEdge(id, updates) — fire-and-forget edge update
 *   - queryRunsByAgentPaginated(agent, limit, offset) — paginated runs
 *   - countRunsByAgent(agent) — count runs for agent
 *   - queryRunByInstanceId(instanceId) — lookup by instance
 *   - queryRuns(query)       — general run query
 *   - queryAgentSummary(query) — per-agent aggregated stats
 *   - queryGlobalSummary(since) — overall aggregated stats
 *   - queryCallGraph(query)  — call edge graph
 *   - prune(olderThanDays)   — fire-and-forget cleanup
 *   - close()                — no-op
 *
 * Tests exercise all public methods on an in-memory SQLite database
 * (Drizzle migrations applied automatically by SqliteBackend).
 *
 * Covers:
 *   - shared/persistence/adapters/stats-store.ts: StatsStoreAdapter constructor
 *   - shared/persistence/adapters/stats-store.ts: close() no-op
 *   - shared/persistence/adapters/stats-store.ts: recordRun() fire-and-forget
 *   - shared/persistence/adapters/stats-store.ts: recordCallEdge() returns callId
 *   - shared/persistence/adapters/stats-store.ts: recordCallEdge() increments counter
 *   - shared/persistence/adapters/stats-store.ts: updateCallEdge() fire-and-forget
 *   - shared/persistence/adapters/stats-store.ts: queryRuns() empty → []
 *   - shared/persistence/adapters/stats-store.ts: queryRuns() with agent filter → []
 *   - shared/persistence/adapters/stats-store.ts: queryRuns() with since filter → []
 *   - shared/persistence/adapters/stats-store.ts: queryRunsByAgentPaginated() → []
 *   - shared/persistence/adapters/stats-store.ts: countRunsByAgent() → 0
 *   - shared/persistence/adapters/stats-store.ts: queryRunByInstanceId() → undefined
 *   - shared/persistence/adapters/stats-store.ts: queryAgentSummary() empty → []
 *   - shared/persistence/adapters/stats-store.ts: queryGlobalSummary() empty → zero-or-null counts
 *   - shared/persistence/adapters/stats-store.ts: queryCallGraph() empty → []
 *   - shared/persistence/adapters/stats-store.ts: prune() returns {runs:0, callEdges:0}
 */

import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const { createPersistenceStore } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/shared/persistence/index.js"
);

const { StatsStoreAdapter } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/shared/persistence/adapters/stats-store.js"
);

// ── Setup ──────────────────────────────────────────────────────────────────

const tmpDir = mkdtempSync(join(tmpdir(), "stats-adapter-test-"));
const persistence = await createPersistenceStore({
  type: "sqlite",
  path: join(tmpDir, "stats-test.db"),
});
const adapter = new StatsStoreAdapter(persistence);

afterAll(() => {
  adapter.close();
});

// ── Sample records ─────────────────────────────────────────────────────────

function makeRunRecord(overrides: Record<string, any> = {}) {
  return {
    instanceId: "inst-" + Math.random().toString(36).slice(2, 10),
    agentName: "test-agent",
    triggerType: "schedule",
    triggerSource: undefined,
    result: "completed",
    exitCode: 0,
    startedAt: Date.now() - 5000,
    durationMs: 5000,
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 150,
    costUsd: 0.001,
    turnCount: 1,
    ...overrides,
  };
}

function makeCallEdgeRecord(overrides: Record<string, any> = {}) {
  return {
    callerAgent: "caller-agent",
    callerInstance: "caller-inst-001",
    targetAgent: "target-agent",
    targetInstance: "target-inst-001",
    depth: 1,
    startedAt: Date.now() - 3000,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("integration: StatsStoreAdapter (no Docker required)", { timeout: 15_000 }, () => {
  it("constructor creates instance without error", () => {
    expect(adapter).toBeDefined();
    expect(adapter).toBeInstanceOf(StatsStoreAdapter);
  });

  it("close() is a no-op that does not throw", () => {
    expect(() => adapter.close()).not.toThrow();
  });

  it("recordRun() accepts a completed RunRecord without throwing", () => {
    expect(() => adapter.recordRun(makeRunRecord())).not.toThrow();
  });

  it("recordRun() accepts an errored RunRecord without throwing", () => {
    const run = makeRunRecord({ result: "error", exitCode: 1, errorMessage: "Something went wrong" });
    expect(() => adapter.recordRun(run)).not.toThrow();
  });

  it("recordCallEdge() returns a numeric callId", () => {
    const callId = adapter.recordCallEdge(makeCallEdgeRecord());
    expect(typeof callId).toBe("number");
    expect(callId).toBeGreaterThan(0);
  });

  it("recordCallEdge() returns incrementing callIds for successive calls", () => {
    const id1 = adapter.recordCallEdge(makeCallEdgeRecord());
    const id2 = adapter.recordCallEdge(makeCallEdgeRecord());
    expect(id2).toBeGreaterThan(id1);
  });

  it("updateCallEdge() does not throw", () => {
    const callId = adapter.recordCallEdge(makeCallEdgeRecord());
    expect(() => adapter.updateCallEdge(callId, { durationMs: 1000, status: "completed" })).not.toThrow();
  });

  it("queryRuns() returns empty array from an empty database", async () => {
    const results = await adapter.queryRuns({});
    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(0);
  });

  it("queryRuns() with agent filter returns empty array", async () => {
    const results = await adapter.queryRuns({ agent: "nonexistent-agent" });
    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(0);
  });

  it("queryRuns() with since filter returns empty array", async () => {
    const futureTimestamp = Date.now() + 1_000_000;
    const results = await adapter.queryRuns({ since: futureTimestamp });
    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(0);
  });

  it("queryRunsByAgentPaginated() returns empty array from empty database", async () => {
    const results = await adapter.queryRunsByAgentPaginated("test-agent", 10, 0);
    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(0);
  });

  it("countRunsByAgent() returns 0 from empty database", async () => {
    const count = await adapter.countRunsByAgent("test-agent");
    expect(count).toBe(0);
  });

  it("queryRunByInstanceId() returns undefined for unknown instanceId", async () => {
    const result = await adapter.queryRunByInstanceId("nonexistent-inst-id");
    expect(result).toBeUndefined();
  });

  it("queryAgentSummary() returns empty array from an empty database", async () => {
    const results = await adapter.queryAgentSummary({});
    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(0);
  });

  it("queryAgentSummary() with agent filter returns empty array", async () => {
    const results = await adapter.queryAgentSummary({ agent: "test-agent" });
    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(0);
  });

  it("queryGlobalSummary() returns zero or null counts from an empty database", async () => {
    const summary = await adapter.queryGlobalSummary();
    expect(summary).toBeDefined();
    // SQL COUNT(*) on empty set returns 0
    expect(summary.totalRuns).toBe(0);
    // SQL SUM() on empty set returns NULL — accept both null and 0
    const isZeroOrNull = (v: any) => v === 0 || v === null || v == null;
    expect(isZeroOrNull(summary.okRuns)).toBe(true);
    expect(isZeroOrNull(summary.errorRuns)).toBe(true);
    expect(isZeroOrNull(summary.totalTokens)).toBe(true);
    expect(isZeroOrNull(summary.totalCost)).toBe(true);
  });

  it("queryGlobalSummary() with future since returns zero totalRuns", async () => {
    const summary = await adapter.queryGlobalSummary(Date.now() + 1_000_000);
    expect(summary.totalRuns).toBe(0);
  });

  it("queryCallGraph() returns empty array from an empty database", async () => {
    const results = await adapter.queryCallGraph({});
    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(0);
  });

  it("prune() returns { runs: 0, callEdges: 0 } as synchronous dummy values", () => {
    const result = adapter.prune(30);
    expect(result).toEqual({ runs: 0, callEdges: 0 });
  });
});
