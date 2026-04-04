/**
 * Integration tests: stats/store.ts pagination and trigger history methods — no Docker required.
 *
 * Several StatsStore query methods are only invoked from HTTP routes that are
 * exercised via pagination tests (which require Docker). This test exercises them
 * directly using a SQLite-backed store populated with synthetic run records and
 * webhook receipts.
 *
 * Methods tested:
 *   - queryRunsByAgentPaginated() — FIFO ordering, limit/offset, empty for unknown agent
 *   - countRunsByAgent() — zero for unknown agent, correct count when populated
 *   - queryTriggerHistory() — all 6 filter branches:
 *       base case (no filters), agentName, triggerType, agentName+triggerType,
 *       includeDeadLetters, triggerType=webhook+includeDeadLetters
 *   - countTriggerHistory() — all 6 matching branches
 *
 * Covers:
 *   - stats/store.ts: queryRunsByAgentPaginated() — empty for unknown agent
 *   - stats/store.ts: queryRunsByAgentPaginated() — returns runs for known agent
 *   - stats/store.ts: queryRunsByAgentPaginated() — limit restricts result count
 *   - stats/store.ts: queryRunsByAgentPaginated() — offset skips earlier rows
 *   - stats/store.ts: queryRunsByAgentPaginated() — ordered by started_at DESC
 *   - stats/store.ts: countRunsByAgent() — zero for unknown agent
 *   - stats/store.ts: countRunsByAgent() — correct count for populated agent
 *   - stats/store.ts: queryTriggerHistory() — base case (no filters): all runs
 *   - stats/store.ts: queryTriggerHistory() — agentName filter
 *   - stats/store.ts: queryTriggerHistory() — triggerType filter
 *   - stats/store.ts: queryTriggerHistory() — agentName + triggerType combined
 *   - stats/store.ts: queryTriggerHistory() — includeDeadLetters=true without triggerType
 *   - stats/store.ts: queryTriggerHistory() — triggerType=webhook + includeDeadLetters includes DL receipts
 *   - stats/store.ts: countTriggerHistory() — base case returns total runs since
 *   - stats/store.ts: countTriggerHistory() — agentName filter
 *   - stats/store.ts: countTriggerHistory() — triggerType filter
 *   - stats/store.ts: countTriggerHistory() — agentName + triggerType combined
 *   - stats/store.ts: countTriggerHistory() — includeDeadLetters without triggerType
 *   - stats/store.ts: countTriggerHistory() — triggerType=webhook + includeDeadLetters
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
  const dir = mkdtempSync(join(tmpdir(), "al-stats-pagination-test-"));
  return join(dir, "stats.db");
}

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    instanceId: randomUUID(),
    agentName: "agent-a",
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

function makeReceipt(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    source: "github",
    timestamp: Date.now(),
    matchedAgents: 0,
    status: "dead-letter" as const,
    deadLetterReason: "no_match" as const,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// queryRunsByAgentPaginated
// ─────────────────────────────────────────────────────────────────────────────

describe("integration: StatsStore.queryRunsByAgentPaginated() (no Docker required)", { timeout: 30_000 }, () => {
  it("returns empty array for unknown agent", () => {
    const store = new StatsStore(makeTempDbPath());
    const rows = store.queryRunsByAgentPaginated("unknown-agent", 10, 0);
    expect(rows).toEqual([]);
    store.close();
  });

  it("returns runs for known agent", () => {
    const store = new StatsStore(makeTempDbPath());
    store.recordRun(makeRun({ agentName: "my-agent" }));
    store.recordRun(makeRun({ agentName: "my-agent" }));
    store.recordRun(makeRun({ agentName: "other-agent" }));

    const rows = store.queryRunsByAgentPaginated("my-agent", 10, 0);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.agent_name).toBe("my-agent");
    }
    store.close();
  });

  it("limit restricts the result count", () => {
    const store = new StatsStore(makeTempDbPath());
    for (let i = 0; i < 5; i++) {
      store.recordRun(makeRun({ agentName: "limited-agent" }));
    }

    const rows = store.queryRunsByAgentPaginated("limited-agent", 2, 0);
    expect(rows).toHaveLength(2);
    store.close();
  });

  it("offset skips earlier rows (pagination)", () => {
    const store = new StatsStore(makeTempDbPath());
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const id = randomUUID();
      ids.push(id);
      store.recordRun(makeRun({ agentName: "paged-agent", instanceId: id, startedAt: Date.now() + i }));
    }

    const page1 = store.queryRunsByAgentPaginated("paged-agent", 2, 0);
    const page2 = store.queryRunsByAgentPaginated("paged-agent", 2, 2);

    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(2);

    // No duplicates between pages
    const page1Ids = new Set(page1.map((r: any) => r.instance_id));
    const page2Ids = new Set(page2.map((r: any) => r.instance_id));
    for (const id of page2Ids) {
      expect(page1Ids.has(id)).toBe(false);
    }
    store.close();
  });

  it("returns rows ordered by started_at DESC (newest first)", () => {
    const store = new StatsStore(makeTempDbPath());
    const base = Date.now();
    store.recordRun(makeRun({ agentName: "sorted-agent", instanceId: "id-1", startedAt: base + 1000 }));
    store.recordRun(makeRun({ agentName: "sorted-agent", instanceId: "id-2", startedAt: base + 2000 }));
    store.recordRun(makeRun({ agentName: "sorted-agent", instanceId: "id-3", startedAt: base + 3000 }));

    const rows = store.queryRunsByAgentPaginated("sorted-agent", 10, 0);
    expect(rows).toHaveLength(3);
    // Newest first
    expect(rows[0].instance_id).toBe("id-3");
    expect(rows[1].instance_id).toBe("id-2");
    expect(rows[2].instance_id).toBe("id-1");
    store.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// countRunsByAgent
// ─────────────────────────────────────────────────────────────────────────────

describe("integration: StatsStore.countRunsByAgent() (no Docker required)", { timeout: 30_000 }, () => {
  it("returns 0 for unknown agent", () => {
    const store = new StatsStore(makeTempDbPath());
    expect(store.countRunsByAgent("unknown-agent")).toBe(0);
    store.close();
  });

  it("returns correct count for populated agent", () => {
    const store = new StatsStore(makeTempDbPath());
    store.recordRun(makeRun({ agentName: "counted-agent" }));
    store.recordRun(makeRun({ agentName: "counted-agent" }));
    store.recordRun(makeRun({ agentName: "counted-agent" }));
    store.recordRun(makeRun({ agentName: "other-agent" }));

    expect(store.countRunsByAgent("counted-agent")).toBe(3);
    expect(store.countRunsByAgent("other-agent")).toBe(1);
    store.close();
  });

  it("returns 0 after all runs are pruned", () => {
    const store = new StatsStore(makeTempDbPath());
    // Add a run from far in the past
    store.recordRun(makeRun({ agentName: "pruned-agent", startedAt: 1000 }));
    expect(store.countRunsByAgent("pruned-agent")).toBe(1);
    store.prune(0); // prune everything older than 0 days = prune all
    expect(store.countRunsByAgent("pruned-agent")).toBe(0);
    store.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// queryTriggerHistory — all branches
// ─────────────────────────────────────────────────────────────────────────────

describe("integration: StatsStore.queryTriggerHistory() (no Docker required)", { timeout: 30_000 }, () => {
  function makeStore() {
    const store = new StatsStore(makeTempDbPath());
    const base = Date.now() - 10_000;

    // Two runs for agent-a, manual
    store.recordRun(makeRun({ agentName: "agent-a", triggerType: "manual", startedAt: base + 100, result: "completed" }));
    store.recordRun(makeRun({ agentName: "agent-a", triggerType: "manual", startedAt: base + 200, result: "completed" }));
    // One run for agent-a, webhook
    store.recordRun(makeRun({ agentName: "agent-a", triggerType: "webhook", startedAt: base + 300, result: "completed" }));
    // One run for agent-b, manual
    store.recordRun(makeRun({ agentName: "agent-b", triggerType: "manual", startedAt: base + 400, result: "completed" }));
    // One dead-letter webhook receipt
    store.recordWebhookReceipt(makeReceipt({ timestamp: base + 500 }));

    return { store, base };
  }

  it("base case (no filters) returns all runs since 0, ordered desc", () => {
    const { store, base } = makeStore();
    const rows = store.queryTriggerHistory({ since: 0, limit: 50, offset: 0, includeDeadLetters: false });
    // 4 runs total (dead-letter receipt is excluded when includeDeadLetters=false)
    expect(rows.length).toBe(4);
    // Ordered desc (newest first)
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].ts).toBeGreaterThanOrEqual(rows[i].ts);
    }
    store.close();
  });

  it("agentName filter returns only runs for that agent", () => {
    const { store } = makeStore();
    const rows = store.queryTriggerHistory({ since: 0, limit: 50, offset: 0, includeDeadLetters: false, agentName: "agent-b" });
    expect(rows.length).toBe(1);
    expect(rows[0].agentName).toBe("agent-b");
    store.close();
  });

  it("triggerType filter returns only runs of that type", () => {
    const { store } = makeStore();
    const rows = store.queryTriggerHistory({ since: 0, limit: 50, offset: 0, includeDeadLetters: false, triggerType: "webhook" });
    // 1 webhook run for agent-a
    expect(rows.length).toBe(1);
    expect(rows[0].triggerType).toBe("webhook");
    store.close();
  });

  it("agentName + triggerType combined filter returns matching runs", () => {
    const { store } = makeStore();
    const rows = store.queryTriggerHistory({ since: 0, limit: 50, offset: 0, includeDeadLetters: false, agentName: "agent-a", triggerType: "manual" });
    // 2 manual runs for agent-a
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.agentName).toBe("agent-a");
      expect(row.triggerType).toBe("manual");
    }
    store.close();
  });

  it("includeDeadLetters=true (no triggerType) includes dead-letter receipts", () => {
    const { store } = makeStore();
    const withDL = store.queryTriggerHistory({ since: 0, limit: 50, offset: 0, includeDeadLetters: true });
    const withoutDL = store.queryTriggerHistory({ since: 0, limit: 50, offset: 0, includeDeadLetters: false });

    // One extra entry (the dead-letter receipt)
    expect(withDL.length).toBe(withoutDL.length + 1);

    // At least one entry should be a dead-letter result
    const hasDeadLetter = withDL.some((r: any) => r.result === "dead-letter");
    expect(hasDeadLetter).toBe(true);
    store.close();
  });

  it("triggerType=webhook + includeDeadLetters includes dead-letter receipts", () => {
    const { store } = makeStore();
    const rows = store.queryTriggerHistory({ since: 0, limit: 50, offset: 0, includeDeadLetters: true, triggerType: "webhook" });
    // 1 webhook run + 1 dead-letter receipt = 2 total
    expect(rows.length).toBe(2);
    const deadLetters = rows.filter((r: any) => r.result === "dead-letter");
    expect(deadLetters.length).toBe(1);
    store.close();
  });

  it("since filter excludes old runs", () => {
    const { store, base } = makeStore();
    // Only include runs after the first two (base+100 and base+200 are excluded)
    const rows = store.queryTriggerHistory({ since: base + 250, limit: 50, offset: 0, includeDeadLetters: false });
    // base+300 (agent-a webhook) and base+400 (agent-b manual) pass the filter
    expect(rows.length).toBe(2);
    store.close();
  });

  it("limit and offset paginate results", () => {
    const { store } = makeStore();
    const page1 = store.queryTriggerHistory({ since: 0, limit: 2, offset: 0, includeDeadLetters: false });
    const page2 = store.queryTriggerHistory({ since: 0, limit: 2, offset: 2, includeDeadLetters: false });
    expect(page1.length).toBe(2);
    expect(page2.length).toBe(2);

    // No overlap
    const page1Ids = new Set(page1.map((r: any) => r.instanceId));
    for (const row of page2) {
      expect(page1Ids.has(row.instanceId)).toBe(false);
    }
    store.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// countTriggerHistory — all branches
// ─────────────────────────────────────────────────────────────────────────────

describe("integration: StatsStore.countTriggerHistory() (no Docker required)", { timeout: 30_000 }, () => {
  function makeStore() {
    const store = new StatsStore(makeTempDbPath());
    const base = Date.now() - 10_000;

    store.recordRun(makeRun({ agentName: "agent-a", triggerType: "manual", startedAt: base + 100 }));
    store.recordRun(makeRun({ agentName: "agent-a", triggerType: "manual", startedAt: base + 200 }));
    store.recordRun(makeRun({ agentName: "agent-a", triggerType: "webhook", startedAt: base + 300 }));
    store.recordRun(makeRun({ agentName: "agent-b", triggerType: "manual", startedAt: base + 400 }));
    store.recordWebhookReceipt(makeReceipt({ timestamp: base + 500 }));

    return { store, base };
  }

  it("base case (no agent/type filter, no dead letters) counts all runs since", () => {
    const { store } = makeStore();
    expect(store.countTriggerHistory(0, false)).toBe(4);
    store.close();
  });

  it("agentName filter counts only runs for that agent", () => {
    const { store } = makeStore();
    expect(store.countTriggerHistory(0, false, "agent-a")).toBe(3);
    expect(store.countTriggerHistory(0, false, "agent-b")).toBe(1);
    expect(store.countTriggerHistory(0, false, "unknown-agent")).toBe(0);
    store.close();
  });

  it("triggerType filter counts only runs of that type", () => {
    const { store } = makeStore();
    expect(store.countTriggerHistory(0, false, undefined, "manual")).toBe(3);
    expect(store.countTriggerHistory(0, false, undefined, "webhook")).toBe(1);
    expect(store.countTriggerHistory(0, false, undefined, "schedule")).toBe(0);
    store.close();
  });

  it("agentName + triggerType combined filter", () => {
    const { store } = makeStore();
    expect(store.countTriggerHistory(0, false, "agent-a", "manual")).toBe(2);
    expect(store.countTriggerHistory(0, false, "agent-a", "webhook")).toBe(1);
    expect(store.countTriggerHistory(0, false, "agent-b", "webhook")).toBe(0);
    store.close();
  });

  it("includeDeadLetters=true (no triggerType) counts runs + dead-letter receipts", () => {
    const { store } = makeStore();
    const withDL = store.countTriggerHistory(0, true);
    const withoutDL = store.countTriggerHistory(0, false);
    // One extra dead-letter receipt
    expect(withDL).toBe(withoutDL + 1);
    store.close();
  });

  it("triggerType=webhook + includeDeadLetters counts webhook runs + dead-letter receipts", () => {
    const { store } = makeStore();
    const count = store.countTriggerHistory(0, true, undefined, "webhook");
    // 1 webhook run + 1 dead-letter receipt = 2
    expect(count).toBe(2);
    store.close();
  });

  it("since filter excludes old records", () => {
    const { store, base } = makeStore();
    // Only count runs after base+250 (2 runs pass)
    expect(store.countTriggerHistory(base + 250, false)).toBe(2);
    store.close();
  });
});
