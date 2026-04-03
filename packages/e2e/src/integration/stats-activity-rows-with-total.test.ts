/**
 * Integration tests: stats/store.ts queryActivityRowsWithTotal() — no Docker required.
 *
 * queryActivityRowsWithTotal() is the primary activity query used by the stats
 * API endpoint GET /api/stats/activity. It returns both paginated rows AND a
 * total count via a single DB pass (SQL window function COUNT(*) OVER()).
 *
 * This function was previously only exercised via the HTTP API endpoint in tests
 * that required Docker — this test exercises it directly with a StatsStore.
 *
 * Scenarios tested:
 *   - Empty store returns { rows: [], total: 0 }
 *   - Single run returned with correct fields
 *   - Pagination: limit+offset applied correctly, total reflects full count
 *   - agentName filter excludes other agents
 *   - triggerType filter (manual/schedule/webhook)
 *   - dbStatuses filter includes only specified result values
 *   - dead-letter rows included when includeDeadLetters=true
 *   - dead-letter rows excluded when includeDeadLetters=false
 *   - dead-letter not included when agentName filter set
 *   - summary field preserved in rows
 *   - Empty dbStatuses array (after stripping dead-letter) returns no runs
 *
 * Covers:
 *   - stats/store.ts: queryActivityRowsWithTotal() — empty store path
 *   - stats/store.ts: queryActivityRowsWithTotal() — single run, correct fields
 *   - stats/store.ts: queryActivityRowsWithTotal() — limit+offset pagination, total
 *   - stats/store.ts: queryActivityRowsWithTotal() — agentName filter
 *   - stats/store.ts: queryActivityRowsWithTotal() — triggerType filter
 *   - stats/store.ts: queryActivityRowsWithTotal() — dbStatuses filter
 *   - stats/store.ts: queryActivityRowsWithTotal() — includeDeadLetters=true adds DL rows
 *   - stats/store.ts: queryActivityRowsWithTotal() — includeDeadLetters=false excludes DL
 *   - stats/store.ts: queryActivityRowsWithTotal() — agentName filter suppresses dead-letters
 *   - stats/store.ts: queryActivityRowsWithTotal() — summary field propagated
 *   - stats/store.ts: queryActivityRowsWithTotal() — empty dbStatuses returns 0 rows/total
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
  const dir = mkdtempSync(join(tmpdir(), "al-activity-test-"));
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
    ...overrides,
  };
}

describe("stats/store.ts queryActivityRowsWithTotal() (no Docker required)", { timeout: 10_000 }, () => {

  it("empty store returns { rows: [], total: 0 }", () => {
    const store = new StatsStore(makeTempDbPath());
    const result = store.queryActivityRowsWithTotal({
      limit: 50,
      offset: 0,
      includeDeadLetters: true,
    });
    expect(result).toEqual({ rows: [], total: 0 });
    store.close();
  });

  it("single run returned with correct fields", () => {
    const store = new StatsStore(makeTempDbPath());
    const instanceId = randomUUID();
    store.recordRun(makeRun({ instanceId, agentName: "my-agent", triggerType: "schedule", result: "completed" }));

    const { rows, total } = store.queryActivityRowsWithTotal({ limit: 50, offset: 0, includeDeadLetters: false });
    expect(total).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].instanceId).toBe(instanceId);
    expect(rows[0].agentName).toBe("my-agent");
    expect(rows[0].triggerType).toBe("schedule");
    expect(rows[0].result).toBe("completed");
    store.close();
  });

  it("pagination: limit limits rows returned, total reflects full count", () => {
    const store = new StatsStore(makeTempDbPath());
    for (let i = 0; i < 5; i++) {
      store.recordRun(makeRun({ startedAt: Date.now() + i }));
    }

    const page1 = store.queryActivityRowsWithTotal({ limit: 2, offset: 0, includeDeadLetters: false });
    expect(page1.total).toBe(5);
    expect(page1.rows).toHaveLength(2);

    const page2 = store.queryActivityRowsWithTotal({ limit: 2, offset: 2, includeDeadLetters: false });
    expect(page2.total).toBe(5);
    expect(page2.rows).toHaveLength(2);

    const page3 = store.queryActivityRowsWithTotal({ limit: 2, offset: 4, includeDeadLetters: false });
    expect(page3.total).toBe(5);
    expect(page3.rows).toHaveLength(1);

    store.close();
  });

  it("agentName filter excludes other agents", () => {
    const store = new StatsStore(makeTempDbPath());
    store.recordRun(makeRun({ agentName: "alpha" }));
    store.recordRun(makeRun({ agentName: "alpha" }));
    store.recordRun(makeRun({ agentName: "beta" }));

    const result = store.queryActivityRowsWithTotal({ limit: 50, offset: 0, agentName: "alpha", includeDeadLetters: false });
    expect(result.total).toBe(2);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((r: { agentName: string }) => r.agentName === "alpha")).toBe(true);
    store.close();
  });

  it("triggerType filter returns only matching rows", () => {
    const store = new StatsStore(makeTempDbPath());
    store.recordRun(makeRun({ triggerType: "manual" }));
    store.recordRun(makeRun({ triggerType: "schedule" }));
    store.recordRun(makeRun({ triggerType: "webhook" }));

    const manual = store.queryActivityRowsWithTotal({ limit: 50, offset: 0, triggerType: "manual", includeDeadLetters: false });
    expect(manual.total).toBe(1);
    expect(manual.rows[0].triggerType).toBe("manual");

    const schedule = store.queryActivityRowsWithTotal({ limit: 50, offset: 0, triggerType: "schedule", includeDeadLetters: false });
    expect(schedule.total).toBe(1);
    expect(schedule.rows[0].triggerType).toBe("schedule");

    store.close();
  });

  it("dbStatuses filter includes only specified result values", () => {
    const store = new StatsStore(makeTempDbPath());
    store.recordRun(makeRun({ result: "completed" }));
    store.recordRun(makeRun({ result: "error" }));
    store.recordRun(makeRun({ result: "completed" }));

    const errored = store.queryActivityRowsWithTotal({
      limit: 50, offset: 0,
      dbStatuses: ["error"],
      includeDeadLetters: false,
    });
    expect(errored.total).toBe(1);
    expect(errored.rows[0].result).toBe("error");

    const completed = store.queryActivityRowsWithTotal({
      limit: 50, offset: 0,
      dbStatuses: ["completed"],
      includeDeadLetters: false,
    });
    expect(completed.total).toBe(2);

    store.close();
  });

  it("dead-letter rows included when includeDeadLetters=true", () => {
    const store = new StatsStore(makeTempDbPath());
    store.recordRun(makeRun());
    store.recordWebhookReceipt({
      id: randomUUID(),
      source: "github",
      timestamp: Date.now(),
      matchedAgents: 0,
      status: "dead-letter",
      deadLetterReason: "no_match",
    });

    const withDL = store.queryActivityRowsWithTotal({ limit: 50, offset: 0, includeDeadLetters: true });
    expect(withDL.total).toBe(2);

    const withoutDL = store.queryActivityRowsWithTotal({ limit: 50, offset: 0, includeDeadLetters: false });
    expect(withoutDL.total).toBe(1);

    store.close();
  });

  it("dead-letter rows not included when agentName filter is set", () => {
    const store = new StatsStore(makeTempDbPath());
    store.recordRun(makeRun({ agentName: "my-agent" }));
    store.recordWebhookReceipt({
      id: randomUUID(),
      source: "github",
      timestamp: Date.now(),
      matchedAgents: 0,
      status: "dead-letter",
      deadLetterReason: "no_match",
    });

    // Even with includeDeadLetters=true, agentName filter should suppress DL rows
    const result = store.queryActivityRowsWithTotal({
      limit: 50,
      offset: 0,
      agentName: "my-agent",
      includeDeadLetters: true,
    });
    expect(result.total).toBe(1);
    expect(result.rows[0].agentName).toBe("my-agent");

    store.close();
  });

  it("summary field is propagated in rows", () => {
    const store = new StatsStore(makeTempDbPath());
    const instanceId = randomUUID();
    store.recordRun(makeRun({ instanceId }));
    store.updateRunSummary(instanceId, "Agent completed successfully");

    const { rows } = store.queryActivityRowsWithTotal({ limit: 50, offset: 0, includeDeadLetters: false });
    expect(rows).toHaveLength(1);
    expect(rows[0].summary).toBe("Agent completed successfully");
    store.close();
  });

  it("empty dbStatuses array (after stripping dead-letter) returns 0 rows with total 0", () => {
    const store = new StatsStore(makeTempDbPath());
    store.recordRun(makeRun({ result: "completed" }));

    // dbStatuses=[] means no run statuses match → only dead-letters if includeDeadLetters
    const result = store.queryActivityRowsWithTotal({
      limit: 50,
      offset: 0,
      dbStatuses: [],  // empty array, after stripping 'dead-letter' = no runs
      includeDeadLetters: false,
    });
    expect(result.rows).toHaveLength(0);
    expect(result.total).toBe(0);

    store.close();
  });

  it("rows sorted by timestamp descending (newest first)", () => {
    const store = new StatsStore(makeTempDbPath());
    const now = Date.now();
    store.recordRun(makeRun({ startedAt: now - 2000 }));
    store.recordRun(makeRun({ startedAt: now - 1000 }));
    store.recordRun(makeRun({ startedAt: now }));

    const { rows, total } = store.queryActivityRowsWithTotal({ limit: 50, offset: 0, includeDeadLetters: false });
    expect(total).toBe(3);
    // Should be newest first
    expect(rows[0].ts).toBeGreaterThan(rows[1].ts);
    expect(rows[1].ts).toBeGreaterThan(rows[2].ts);

    store.close();
  });
});
