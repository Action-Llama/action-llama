import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { StatsStore } from "../../src/stats/store.js";
import type { RunRecord, CallEdgeRecord, WebhookReceipt } from "../../src/stats/store.js";

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

  // --- Webhook receipt tests ---

  function makeReceipt(overrides: Partial<WebhookReceipt> = {}): WebhookReceipt {
    return {
      id: `receipt-${Math.random().toString(36).slice(2, 10)}`,
      source: "github",
      eventSummary: "issues.labeled",
      timestamp: Date.now(),
      headers: JSON.stringify({ "x-github-event": "issues" }),
      body: JSON.stringify({ action: "labeled" }),
      matchedAgents: 0,
      status: "processed",
      ...overrides,
    };
  }

  it("records and retrieves a webhook receipt by id", () => {
    const store = createStore();
    const receipt = makeReceipt({ id: "r-1" });
    store.recordWebhookReceipt(receipt);

    const found = store.getWebhookReceipt("r-1");
    expect(found).toBeDefined();
    expect(found!.id).toBe("r-1");
    expect(found!.source).toBe("github");
    expect(found!.eventSummary).toBe("issues.labeled");
    expect(found!.status).toBe("processed");
    store.close();
  });

  it("finds a webhook receipt by delivery ID", () => {
    const store = createStore();
    store.recordWebhookReceipt(makeReceipt({ id: "r-2", deliveryId: "gh-delivery-abc" }));
    store.recordWebhookReceipt(makeReceipt({ id: "r-3", deliveryId: "gh-delivery-def" }));

    const found = store.findWebhookReceiptByDeliveryId("gh-delivery-abc");
    expect(found).toBeDefined();
    expect(found!.id).toBe("r-2");

    const notFound = store.findWebhookReceiptByDeliveryId("nonexistent");
    expect(notFound).toBeUndefined();
    store.close();
  });

  it("updates webhook receipt status", () => {
    const store = createStore();
    store.recordWebhookReceipt(makeReceipt({ id: "r-4", status: "processed", matchedAgents: 0 }));

    store.updateWebhookReceiptStatus("r-4", 2, "processed");
    const updated = store.getWebhookReceipt("r-4");
    expect(updated!.matchedAgents).toBe(2);
    expect(updated!.status).toBe("processed");

    store.updateWebhookReceiptStatus("r-4", 0, "dead-letter", "no_match");
    const deadLetter = store.getWebhookReceipt("r-4");
    expect(deadLetter!.status).toBe("dead-letter");
    expect(deadLetter!.deadLetterReason).toBe("no_match");
    store.close();
  });

  it("runs table has webhook_receipt_id column", () => {
    const store = createStore();
    store.recordRun(makeRun({ webhookReceiptId: "r-5" }));

    const rows = store.queryRuns({ since: 0 });
    expect(rows[0].webhook_receipt_id).toBe("r-5");
    store.close();
  });

  it("queryTriggerHistory returns union of runs and dead-letter receipts", () => {
    const store = createStore();
    const now = Date.now();

    // Insert 2 runs
    store.recordRun(makeRun({ startedAt: now - 2000, agentName: "a" }));
    store.recordRun(makeRun({ startedAt: now - 1000, agentName: "b" }));

    // Insert 1 dead-letter receipt
    store.recordWebhookReceipt(makeReceipt({
      id: "dl-1",
      timestamp: now - 500,
      status: "dead-letter",
      deadLetterReason: "no_match",
    }));

    // Insert 1 processed receipt (should NOT appear in trigger history)
    store.recordWebhookReceipt(makeReceipt({
      id: "ok-1",
      timestamp: now - 300,
      status: "processed",
      matchedAgents: 1,
    }));

    const rows = store.queryTriggerHistory({ since: 0, limit: 10, offset: 0, includeDeadLetters: true });
    expect(rows).toHaveLength(3); // 2 runs + 1 dead-letter
    // Ordered by ts DESC
    expect(rows[0].result).toBe("dead-letter");
    expect(rows[1].agentName).toBe("b");
    expect(rows[2].agentName).toBe("a");
    store.close();
  });

  it("queryTriggerHistory excludes dead letters when not requested", () => {
    const store = createStore();
    const now = Date.now();

    store.recordRun(makeRun({ startedAt: now }));
    store.recordWebhookReceipt(makeReceipt({
      id: "dl-2",
      timestamp: now - 100,
      status: "dead-letter",
      deadLetterReason: "validation_failed",
    }));

    const withDL = store.queryTriggerHistory({ since: 0, limit: 10, offset: 0, includeDeadLetters: true });
    expect(withDL).toHaveLength(2);

    const withoutDL = store.queryTriggerHistory({ since: 0, limit: 10, offset: 0, includeDeadLetters: false });
    expect(withoutDL).toHaveLength(1);
    store.close();
  });

  it("countTriggerHistory counts correctly", () => {
    const store = createStore();
    const now = Date.now();

    store.recordRun(makeRun({ startedAt: now }));
    store.recordRun(makeRun({ startedAt: now }));
    store.recordWebhookReceipt(makeReceipt({
      id: "dl-3",
      timestamp: now,
      status: "dead-letter",
      deadLetterReason: "no_match",
    }));

    expect(store.countTriggerHistory(0, true)).toBe(3);
    expect(store.countTriggerHistory(0, false)).toBe(2);
    store.close();
  });

  it("prune removes old webhook receipts", () => {
    const store = createStore();
    const now = Date.now();
    const oldTime = now - 100 * 86400_000; // 100 days ago

    store.recordWebhookReceipt(makeReceipt({ id: "old-r", timestamp: oldTime }));
    store.recordWebhookReceipt(makeReceipt({ id: "new-r", timestamp: now }));

    const pruned = store.prune(90);
    expect(pruned.receipts).toBe(1);

    expect(store.getWebhookReceipt("old-r")).toBeUndefined();
    expect(store.getWebhookReceipt("new-r")).toBeDefined();
    store.close();
  });

  it("queries call edge by target instance", () => {
    const store = createStore();
    const now = Date.now();
    const edgeId = store.recordCallEdge({
      callerAgent: "orchestrator",
      callerInstance: "orch-abc",
      targetAgent: "reviewer",
      depth: 1,
      startedAt: now,
      status: "pending",
    });
    store.updateCallEdge(edgeId, { targetInstance: "rev-xyz", status: "completed", durationMs: 5000 });

    const edge = store.queryCallEdgeByTargetInstance("rev-xyz");
    expect(edge).toBeDefined();
    expect(edge!.caller_agent).toBe("orchestrator");
    expect(edge!.caller_instance).toBe("orch-abc");
    expect(edge!.target_agent).toBe("reviewer");
    expect(edge!.target_instance).toBe("rev-xyz");
    store.close();
  });

  it("queryCallEdgeByTargetInstance returns undefined for missing target", () => {
    const store = createStore();
    const result = store.queryCallEdgeByTargetInstance("nonexistent");
    expect(result).toBeUndefined();
    store.close();
  });

  it("dedupe: findWebhookReceiptByDeliveryId returns existing receipt", () => {
    const store = createStore();
    store.recordWebhookReceipt(makeReceipt({
      id: "dedup-1",
      deliveryId: "unique-delivery-123",
      matchedAgents: 2,
      status: "processed",
    }));

    // Simulating what the route handler does: check before inserting
    const existing = store.findWebhookReceiptByDeliveryId("unique-delivery-123");
    expect(existing).toBeDefined();
    expect(existing!.id).toBe("dedup-1");
    expect(existing!.matchedAgents).toBe(2);

    // No duplicate should exist
    const noMatch = store.findWebhookReceiptByDeliveryId("different-delivery");
    expect(noMatch).toBeUndefined();
    store.close();
  });
});
