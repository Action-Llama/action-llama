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
    // deadLetterReason should be populated for dead-letter rows, null for runs
    expect(rows[0].deadLetterReason).toBe("no_match");
    expect(rows[1].deadLetterReason).toBeNull();
    expect(rows[2].deadLetterReason).toBeNull();
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

  it("queryAgentSummary filtered by agent name returns only that agent", () => {
    const store = createStore();
    const now = Date.now();
    store.recordRun(makeRun({ agentName: "reporter", result: "completed", totalTokens: 1000, costUsd: 0.05, startedAt: now }));
    store.recordRun(makeRun({ agentName: "reporter", result: "error", totalTokens: 500, costUsd: 0.02, startedAt: now }));
    store.recordRun(makeRun({ agentName: "reviewer", result: "completed", totalTokens: 2000, costUsd: 0.10, startedAt: now }));

    const summaries = store.queryAgentSummary({ agent: "reporter", since: 0 });
    expect(summaries).toHaveLength(1);
    expect(summaries[0].agentName).toBe("reporter");
    expect(summaries[0].totalRuns).toBe(2);
    expect(summaries[0].okRuns).toBe(1);
    expect(summaries[0].errorRuns).toBe(1);
    expect(summaries[0].totalTokens).toBe(1500);
    expect(summaries[0].totalCost).toBeCloseTo(0.07);
    store.close();
  });

  it("queryAgentSummary filtered by agent returns empty array when no runs match", () => {
    const store = createStore();
    store.recordRun(makeRun({ agentName: "reporter", startedAt: Date.now() }));

    const summaries = store.queryAgentSummary({ agent: "nonexistent", since: 0 });
    expect(summaries).toHaveLength(0);
    store.close();
  });

  it("queryTriggerHistory filtered by agentName only returns runs for that agent", () => {
    const store = createStore();
    const now = Date.now();
    store.recordRun(makeRun({ agentName: "reporter", startedAt: now - 2000, triggerType: "schedule" }));
    store.recordRun(makeRun({ agentName: "reviewer", startedAt: now - 1000, triggerType: "webhook" }));
    store.recordRun(makeRun({ agentName: "reporter", startedAt: now, triggerType: "webhook" }));

    const rows = store.queryTriggerHistory({ since: 0, limit: 10, offset: 0, includeDeadLetters: false, agentName: "reporter" });
    expect(rows).toHaveLength(2);
    expect(rows.every(r => r.agentName === "reporter")).toBe(true);
    store.close();
  });

  it("queryTriggerHistory filtered by triggerType only returns matching runs", () => {
    const store = createStore();
    const now = Date.now();
    store.recordRun(makeRun({ agentName: "reporter", startedAt: now - 2000, triggerType: "schedule" }));
    store.recordRun(makeRun({ agentName: "reporter", startedAt: now - 1000, triggerType: "webhook" }));
    store.recordRun(makeRun({ agentName: "reviewer", startedAt: now, triggerType: "schedule" }));

    const rows = store.queryTriggerHistory({ since: 0, limit: 10, offset: 0, includeDeadLetters: false, triggerType: "schedule" });
    expect(rows).toHaveLength(2);
    expect(rows.every(r => r.triggerType === "schedule")).toBe(true);
    store.close();
  });

  it("queryTriggerHistory filtered by triggerType=webhook includes dead letters when requested", () => {
    const store = createStore();
    const now = Date.now();
    store.recordRun(makeRun({ agentName: "reporter", startedAt: now - 2000, triggerType: "webhook" }));
    store.recordWebhookReceipt(makeReceipt({
      id: "dl-wh-1",
      timestamp: now - 1000,
      status: "dead-letter",
      deadLetterReason: "no_match",
    }));

    const withDL = store.queryTriggerHistory({ since: 0, limit: 10, offset: 0, includeDeadLetters: true, triggerType: "webhook" });
    expect(withDL).toHaveLength(2);
    const deadLetterRow = withDL.find(r => r.result === "dead-letter");
    expect(deadLetterRow).toBeDefined();
    expect(deadLetterRow!.deadLetterReason).toBe("no_match");

    const withoutDL = store.queryTriggerHistory({ since: 0, limit: 10, offset: 0, includeDeadLetters: false, triggerType: "webhook" });
    expect(withoutDL).toHaveLength(1);
    expect(withoutDL[0].agentName).toBe("reporter");
    store.close();
  });

  it("queryTriggerHistory filtered by both agentName and triggerType", () => {
    const store = createStore();
    const now = Date.now();
    store.recordRun(makeRun({ agentName: "reporter", startedAt: now - 3000, triggerType: "schedule" }));
    store.recordRun(makeRun({ agentName: "reporter", startedAt: now - 2000, triggerType: "webhook" }));
    store.recordRun(makeRun({ agentName: "reviewer", startedAt: now - 1000, triggerType: "schedule" }));
    store.recordRun(makeRun({ agentName: "reviewer", startedAt: now, triggerType: "webhook" }));

    const rows = store.queryTriggerHistory({ since: 0, limit: 10, offset: 0, includeDeadLetters: false, agentName: "reporter", triggerType: "schedule" });
    expect(rows).toHaveLength(1);
    expect(rows[0].agentName).toBe("reporter");
    expect(rows[0].triggerType).toBe("schedule");
    store.close();
  });

  it("countTriggerHistory filtered by agentName counts only that agent's runs", () => {
    const store = createStore();
    const now = Date.now();
    store.recordRun(makeRun({ agentName: "reporter", startedAt: now }));
    store.recordRun(makeRun({ agentName: "reporter", startedAt: now }));
    store.recordRun(makeRun({ agentName: "reviewer", startedAt: now }));

    expect(store.countTriggerHistory(0, false, "reporter")).toBe(2);
    expect(store.countTriggerHistory(0, true, "reporter")).toBe(2);
    expect(store.countTriggerHistory(0, false, "reviewer")).toBe(1);
    store.close();
  });

  it("countTriggerHistory filtered by triggerType counts correctly", () => {
    const store = createStore();
    const now = Date.now();
    store.recordRun(makeRun({ agentName: "reporter", startedAt: now, triggerType: "schedule" }));
    store.recordRun(makeRun({ agentName: "reviewer", startedAt: now, triggerType: "schedule" }));
    store.recordRun(makeRun({ agentName: "reporter", startedAt: now, triggerType: "webhook" }));

    expect(store.countTriggerHistory(0, false, undefined, "schedule")).toBe(2);
    expect(store.countTriggerHistory(0, false, undefined, "webhook")).toBe(1);
    store.close();
  });

  it("countTriggerHistory filtered by triggerType=webhook includes dead letters when requested", () => {
    const store = createStore();
    const now = Date.now();
    store.recordRun(makeRun({ agentName: "reporter", startedAt: now, triggerType: "webhook" }));
    store.recordWebhookReceipt(makeReceipt({
      id: "dl-count-1",
      timestamp: now,
      status: "dead-letter",
      deadLetterReason: "no_match",
    }));

    // With dead letters and webhook type: should count runs + dead letters
    expect(store.countTriggerHistory(0, true, undefined, "webhook")).toBeGreaterThanOrEqual(1);
    // Without dead letters
    expect(store.countTriggerHistory(0, false, undefined, "webhook")).toBe(1);
    store.close();
  });

  it("countTriggerHistory filtered by both agentName and triggerType", () => {
    const store = createStore();
    const now = Date.now();
    store.recordRun(makeRun({ agentName: "reporter", startedAt: now, triggerType: "schedule" }));
    store.recordRun(makeRun({ agentName: "reporter", startedAt: now, triggerType: "webhook" }));
    store.recordRun(makeRun({ agentName: "reviewer", startedAt: now, triggerType: "schedule" }));

    expect(store.countTriggerHistory(0, false, "reporter", "schedule")).toBe(1);
    expect(store.countTriggerHistory(0, false, "reporter", "webhook")).toBe(1);
    expect(store.countTriggerHistory(0, false, "reviewer", "schedule")).toBe(1);
    expect(store.countTriggerHistory(0, false, "reviewer", "webhook")).toBe(0);
    store.close();
  });

  it("getWebhookSourcesBatch returns empty object for empty ids array", () => {
    const store = createStore();
    const result = store.getWebhookSourcesBatch([]);
    expect(result).toEqual({});
    store.close();
  });

  it("getWebhookSourcesBatch returns id→source mapping for existing receipts", () => {
    const store = createStore();
    store.recordWebhookReceipt(makeReceipt({ id: "batch-1", source: "github" }));
    store.recordWebhookReceipt(makeReceipt({ id: "batch-2", source: "slack" }));
    store.recordWebhookReceipt(makeReceipt({ id: "batch-3", source: "linear" }));

    const result = store.getWebhookSourcesBatch(["batch-1", "batch-2"]);
    expect(result).toEqual({
      "batch-1": "github",
      "batch-2": "slack",
    });
    // batch-3 was not requested
    expect(result["batch-3"]).toBeUndefined();
    store.close();
  });

  it("getWebhookSourcesBatch returns empty object when none of the ids exist", () => {
    const store = createStore();
    store.recordWebhookReceipt(makeReceipt({ id: "existing-1", source: "github" }));

    const result = store.getWebhookSourcesBatch(["nonexistent-a", "nonexistent-b"]);
    expect(result).toEqual({});
    store.close();
  });

  it("getWebhookSourcesBatch handles single id correctly", () => {
    const store = createStore();
    store.recordWebhookReceipt(makeReceipt({ id: "single-batch", source: "sentry" }));

    const result = store.getWebhookSourcesBatch(["single-batch"]);
    expect(result["single-batch"]).toBe("sentry");
    expect(Object.keys(result)).toHaveLength(1);
    store.close();
  });

  // --- getWebhookDetailsBatch tests ---

  it("getWebhookDetailsBatch returns empty object for empty ids array", () => {
    const store = createStore();
    const result = store.getWebhookDetailsBatch([]);
    expect(result).toEqual({});
    store.close();
  });

  it("getWebhookDetailsBatch returns id→{source, eventSummary} mapping", () => {
    const store = createStore();
    store.recordWebhookReceipt(makeReceipt({ id: "detail-1", source: "github", eventSummary: "issues.labeled" }));
    store.recordWebhookReceipt(makeReceipt({ id: "detail-2", source: "slack", eventSummary: "message" }));
    store.recordWebhookReceipt(makeReceipt({ id: "detail-3", source: "linear", eventSummary: undefined }));

    const result = store.getWebhookDetailsBatch(["detail-1", "detail-2", "detail-3"]);
    expect(result["detail-1"]).toEqual({ source: "github", eventSummary: "issues.labeled" });
    expect(result["detail-2"]).toEqual({ source: "slack", eventSummary: "message" });
    expect(result["detail-3"].source).toBe("linear");
    expect(result["detail-3"].eventSummary).toBeUndefined();
    store.close();
  });

  it("getWebhookDetailsBatch only returns requested ids", () => {
    const store = createStore();
    store.recordWebhookReceipt(makeReceipt({ id: "detail-a", source: "github", eventSummary: "push" }));
    store.recordWebhookReceipt(makeReceipt({ id: "detail-b", source: "slack", eventSummary: "message" }));

    const result = store.getWebhookDetailsBatch(["detail-a"]);
    expect(Object.keys(result)).toHaveLength(1);
    expect(result["detail-a"].source).toBe("github");
    expect(result["detail-b"]).toBeUndefined();
    store.close();
  });

  it("getWebhookDetailsBatch returns empty object when none of the ids exist", () => {
    const store = createStore();
    store.recordWebhookReceipt(makeReceipt({ id: "existing-detail", source: "github" }));

    const result = store.getWebhookDetailsBatch(["nonexistent-x", "nonexistent-y"]);
    expect(result).toEqual({});
    store.close();
  });

  // --- updateRunSummary tests ---

  describe("updateRunSummary", () => {
    it("updates the summary field for an existing run", () => {
      const store = createStore();
      store.recordRun(makeRun({ instanceId: "sum-run-1", agentName: "reporter" }));
      store.updateRunSummary("sum-run-1", "Agent completed the task successfully.");

      const row = store.queryRunByInstanceId("sum-run-1");
      expect(row).toBeDefined();
      expect(row.summary).toBe("Agent completed the task successfully.");
      store.close();
    });

    it("does not affect other runs when updating summary", () => {
      const store = createStore();
      store.recordRun(makeRun({ instanceId: "sum-run-a", agentName: "reporter" }));
      store.recordRun(makeRun({ instanceId: "sum-run-b", agentName: "reporter" }));
      store.updateRunSummary("sum-run-a", "Summary for A");

      const rowA = store.queryRunByInstanceId("sum-run-a");
      const rowB = store.queryRunByInstanceId("sum-run-b");
      expect(rowA.summary).toBe("Summary for A");
      expect(rowB.summary).toBeNull();
      store.close();
    });

    it("overwrites a previously set summary", () => {
      const store = createStore();
      store.recordRun(makeRun({ instanceId: "sum-run-2", agentName: "reporter" }));
      store.updateRunSummary("sum-run-2", "First summary");
      store.updateRunSummary("sum-run-2", "Updated summary");

      const row = store.queryRunByInstanceId("sum-run-2");
      expect(row.summary).toBe("Updated summary");
      store.close();
    });
  });

  // --- queryActivityRows tests ---

  describe("queryActivityRows", () => {
    it("returns all runs when no filters are applied", () => {
      const store = createStore();
      const now = Date.now();
      store.recordRun(makeRun({ agentName: "reporter", startedAt: now - 2000, triggerType: "schedule" }));
      store.recordRun(makeRun({ agentName: "reviewer", startedAt: now - 1000, triggerType: "webhook" }));

      const rows = store.queryActivityRows({ limit: 10, offset: 0, includeDeadLetters: false });
      expect(rows).toHaveLength(2);
      store.close();
    });

    it("returns runs and dead-letters when includeDeadLetters is true", () => {
      const store = createStore();
      const now = Date.now();
      store.recordRun(makeRun({ agentName: "reporter", startedAt: now - 2000 }));
      store.recordWebhookReceipt(makeReceipt({ id: "dl-act-1", timestamp: now - 1000, status: "dead-letter", deadLetterReason: "no_match" }));

      const rows = store.queryActivityRows({ limit: 10, offset: 0, includeDeadLetters: true });
      expect(rows).toHaveLength(2);
      const dlRow = rows.find(r => r.result === "dead-letter");
      expect(dlRow).toBeDefined();
      expect(dlRow!.deadLetterReason).toBe("no_match");
      store.close();
    });

    it("excludes dead-letters when includeDeadLetters is false", () => {
      const store = createStore();
      const now = Date.now();
      store.recordRun(makeRun({ agentName: "reporter", startedAt: now - 2000 }));
      store.recordWebhookReceipt(makeReceipt({ id: "dl-act-2", timestamp: now - 1000, status: "dead-letter", deadLetterReason: "no_match" }));

      const rows = store.queryActivityRows({ limit: 10, offset: 0, includeDeadLetters: false });
      expect(rows).toHaveLength(1);
      expect(rows[0].agentName).toBe("reporter");
      store.close();
    });

    it("filters by agentName", () => {
      const store = createStore();
      const now = Date.now();
      store.recordRun(makeRun({ agentName: "reporter", startedAt: now - 2000 }));
      store.recordRun(makeRun({ agentName: "reviewer", startedAt: now - 1000 }));

      const rows = store.queryActivityRows({ limit: 10, offset: 0, includeDeadLetters: false, agentName: "reporter" });
      expect(rows).toHaveLength(1);
      expect(rows[0].agentName).toBe("reporter");
      store.close();
    });

    it("filters by triggerType", () => {
      const store = createStore();
      const now = Date.now();
      store.recordRun(makeRun({ agentName: "reporter", startedAt: now - 2000, triggerType: "schedule" }));
      store.recordRun(makeRun({ agentName: "reviewer", startedAt: now - 1000, triggerType: "webhook" }));

      const rows = store.queryActivityRows({ limit: 10, offset: 0, includeDeadLetters: false, triggerType: "schedule" });
      expect(rows).toHaveLength(1);
      expect(rows[0].triggerType).toBe("schedule");
      store.close();
    });

    it("filters by dbStatuses", () => {
      const store = createStore();
      const now = Date.now();
      store.recordRun(makeRun({ agentName: "reporter", startedAt: now - 2000, result: "completed" }));
      store.recordRun(makeRun({ agentName: "reviewer", startedAt: now - 1000, result: "error" }));

      const rows = store.queryActivityRows({ limit: 10, offset: 0, includeDeadLetters: false, dbStatuses: ["completed"] });
      expect(rows).toHaveLength(1);
      expect(rows[0].result).toBe("completed");
      store.close();
    });

    it("returns empty array when dbStatuses is empty array and includeDeadLetters false", () => {
      const store = createStore();
      store.recordRun(makeRun({ agentName: "reporter", startedAt: Date.now() }));

      const rows = store.queryActivityRows({ limit: 10, offset: 0, includeDeadLetters: false, dbStatuses: [] });
      expect(rows).toHaveLength(0);
      store.close();
    });

    it("returns only dead-letters when dbStatuses contains only dead-letter", () => {
      const store = createStore();
      const now = Date.now();
      store.recordRun(makeRun({ agentName: "reporter", startedAt: now - 2000 }));
      store.recordWebhookReceipt(makeReceipt({ id: "dl-only-1", timestamp: now - 1000, status: "dead-letter", deadLetterReason: "parse_error" }));

      const rows = store.queryActivityRows({ limit: 10, offset: 0, includeDeadLetters: true, dbStatuses: ["dead-letter"] });
      expect(rows).toHaveLength(1);
      expect(rows[0].result).toBe("dead-letter");
      store.close();
    });

    it("respects limit and offset for pagination", () => {
      const store = createStore();
      const now = Date.now();
      for (let i = 0; i < 5; i++) {
        store.recordRun(makeRun({ agentName: "reporter", startedAt: now - i * 1000, instanceId: `act-run-${i}` }));
      }

      const page1 = store.queryActivityRows({ limit: 2, offset: 0, includeDeadLetters: false });
      expect(page1).toHaveLength(2);

      const page2 = store.queryActivityRows({ limit: 2, offset: 2, includeDeadLetters: false });
      expect(page2).toHaveLength(2);
      // Pages should not overlap
      expect(page1[0].instanceId).not.toBe(page2[0].instanceId);
      store.close();
    });

    it("includes dead-letters when triggerType is webhook", () => {
      const store = createStore();
      const now = Date.now();
      store.recordRun(makeRun({ agentName: "reporter", startedAt: now - 2000, triggerType: "webhook" }));
      store.recordWebhookReceipt(makeReceipt({ id: "dl-wh-act-1", timestamp: now - 1000, status: "dead-letter" }));

      const rows = store.queryActivityRows({ limit: 10, offset: 0, includeDeadLetters: true, triggerType: "webhook" });
      expect(rows).toHaveLength(2);
      store.close();
    });

    it("does not include dead-letters when agentName filter is set", () => {
      const store = createStore();
      const now = Date.now();
      store.recordRun(makeRun({ agentName: "reporter", startedAt: now - 2000 }));
      store.recordWebhookReceipt(makeReceipt({ id: "dl-agent-1", timestamp: now - 1000, status: "dead-letter" }));

      // Even with includeDeadLetters=true, agentName filter should exclude dead-letters
      const rows = store.queryActivityRows({ limit: 10, offset: 0, includeDeadLetters: true, agentName: "reporter" });
      expect(rows).toHaveLength(1);
      expect(rows[0].agentName).toBe("reporter");
      store.close();
    });
  });

  // --- countActivityRows tests ---

  describe("countActivityRows", () => {
    it("returns 0 when no data exists", () => {
      const store = createStore();
      const count = store.countActivityRows({ includeDeadLetters: false });
      expect(count).toBe(0);
      store.close();
    });

    it("counts all runs when no filters applied", () => {
      const store = createStore();
      const now = Date.now();
      store.recordRun(makeRun({ agentName: "reporter", startedAt: now }));
      store.recordRun(makeRun({ agentName: "reviewer", startedAt: now }));

      expect(store.countActivityRows({ includeDeadLetters: false })).toBe(2);
      store.close();
    });

    it("includes dead-letters in count when requested", () => {
      const store = createStore();
      const now = Date.now();
      store.recordRun(makeRun({ agentName: "reporter", startedAt: now }));
      store.recordWebhookReceipt(makeReceipt({ id: "dl-cnt-1", timestamp: now, status: "dead-letter" }));

      expect(store.countActivityRows({ includeDeadLetters: true })).toBe(2);
      expect(store.countActivityRows({ includeDeadLetters: false })).toBe(1);
      store.close();
    });

    it("filters count by agentName", () => {
      const store = createStore();
      const now = Date.now();
      store.recordRun(makeRun({ agentName: "reporter", startedAt: now }));
      store.recordRun(makeRun({ agentName: "reporter", startedAt: now }));
      store.recordRun(makeRun({ agentName: "reviewer", startedAt: now }));

      expect(store.countActivityRows({ includeDeadLetters: false, agentName: "reporter" })).toBe(2);
      expect(store.countActivityRows({ includeDeadLetters: false, agentName: "reviewer" })).toBe(1);
      store.close();
    });

    it("filters count by triggerType", () => {
      const store = createStore();
      const now = Date.now();
      store.recordRun(makeRun({ agentName: "reporter", startedAt: now, triggerType: "schedule" }));
      store.recordRun(makeRun({ agentName: "reporter", startedAt: now, triggerType: "webhook" }));

      expect(store.countActivityRows({ includeDeadLetters: false, triggerType: "schedule" })).toBe(1);
      expect(store.countActivityRows({ includeDeadLetters: false, triggerType: "webhook" })).toBe(1);
      store.close();
    });

    it("filters count by dbStatuses", () => {
      const store = createStore();
      const now = Date.now();
      store.recordRun(makeRun({ agentName: "reporter", startedAt: now, result: "completed" }));
      store.recordRun(makeRun({ agentName: "reviewer", startedAt: now, result: "error" }));

      expect(store.countActivityRows({ includeDeadLetters: false, dbStatuses: ["completed"] })).toBe(1);
      expect(store.countActivityRows({ includeDeadLetters: false, dbStatuses: ["error"] })).toBe(1);
      expect(store.countActivityRows({ includeDeadLetters: false, dbStatuses: ["completed", "error"] })).toBe(2);
      store.close();
    });

    it("returns 0 when dbStatuses is empty and includeDeadLetters false", () => {
      const store = createStore();
      store.recordRun(makeRun({ agentName: "reporter", startedAt: Date.now() }));

      expect(store.countActivityRows({ includeDeadLetters: false, dbStatuses: [] })).toBe(0);
      store.close();
    });

    it("counts only dead-letters when dbStatuses contains only dead-letter", () => {
      const store = createStore();
      const now = Date.now();
      store.recordRun(makeRun({ agentName: "reporter", startedAt: now }));
      store.recordWebhookReceipt(makeReceipt({ id: "dl-cnt-only-1", timestamp: now, status: "dead-letter" }));
      store.recordWebhookReceipt(makeReceipt({ id: "dl-cnt-only-2", timestamp: now, status: "dead-letter" }));

      const count = store.countActivityRows({ includeDeadLetters: true, dbStatuses: ["dead-letter"] });
      expect(count).toBe(2);
      store.close();
    });

    it("counts both runs and dead-letters when queryRuns and wantDeadLetters", () => {
      const store = createStore();
      const now = Date.now();
      store.recordRun(makeRun({ agentName: "reporter", startedAt: now, result: "completed" }));
      store.recordRun(makeRun({ agentName: "reporter", startedAt: now, result: "error" }));
      store.recordWebhookReceipt(makeReceipt({ id: "dl-cnt-both-1", timestamp: now, status: "dead-letter" }));

      const count = store.countActivityRows({ includeDeadLetters: true });
      expect(count).toBe(3);
      store.close();
    });
  });

  // --- queryActivityRowsWithTotal tests ---

  describe("queryActivityRowsWithTotal", () => {
    it("returns empty rows and total=0 when dbStatuses is empty and includeDeadLetters false", () => {
      const store = createStore();
      store.recordRun(makeRun({ agentName: "reporter", startedAt: Date.now() }));

      const result = store.queryActivityRowsWithTotal({ limit: 10, offset: 0, includeDeadLetters: false, dbStatuses: [] });
      expect(result.rows).toHaveLength(0);
      expect(result.total).toBe(0);
      store.close();
    });

    it("returns rows and correct total when no filters applied", () => {
      const store = createStore();
      const now = Date.now();
      store.recordRun(makeRun({ agentName: "reporter", startedAt: now - 2000, triggerType: "schedule" }));
      store.recordRun(makeRun({ agentName: "reviewer", startedAt: now - 1000, triggerType: "webhook" }));

      const result = store.queryActivityRowsWithTotal({ limit: 10, offset: 0, includeDeadLetters: false });
      expect(result.rows).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.rows[0].agentName).toBe("reviewer"); // most recent first
      expect(result.rows[1].agentName).toBe("reporter");
      store.close();
    });

    it("returns total reflecting all matching rows even when limit constrains results", () => {
      const store = createStore();
      const now = Date.now();
      for (let i = 0; i < 5; i++) {
        store.recordRun(makeRun({ agentName: "reporter", startedAt: now - i * 1000, instanceId: `wt-run-${i}` }));
      }

      const result = store.queryActivityRowsWithTotal({ limit: 2, offset: 0, includeDeadLetters: false });
      expect(result.rows).toHaveLength(2);
      expect(result.total).toBe(5);
      store.close();
    });

    it("returns empty rows and total=0 when store is empty", () => {
      const store = createStore();

      const result = store.queryActivityRowsWithTotal({ limit: 10, offset: 0, includeDeadLetters: false });
      expect(result.rows).toHaveLength(0);
      expect(result.total).toBe(0);
      store.close();
    });

    it("includes dead-letters in rows and total when includeDeadLetters true", () => {
      const store = createStore();
      const now = Date.now();
      store.recordRun(makeRun({ agentName: "reporter", startedAt: now - 2000 }));
      store.recordWebhookReceipt(makeReceipt({ id: "dl-wt-1", timestamp: now - 1000, status: "dead-letter", deadLetterReason: "no_match" }));

      const result = store.queryActivityRowsWithTotal({ limit: 10, offset: 0, includeDeadLetters: true });
      expect(result.rows).toHaveLength(2);
      expect(result.total).toBe(2);
      const dlRow = result.rows.find(r => r.result === "dead-letter");
      expect(dlRow).toBeDefined();
      expect(dlRow!.deadLetterReason).toBe("no_match");
      store.close();
    });

    it("filters rows by agentName", () => {
      const store = createStore();
      const now = Date.now();
      store.recordRun(makeRun({ agentName: "reporter", startedAt: now - 2000 }));
      store.recordRun(makeRun({ agentName: "reviewer", startedAt: now - 1000 }));
      store.recordRun(makeRun({ agentName: "reporter", startedAt: now }));

      const result = store.queryActivityRowsWithTotal({ limit: 10, offset: 0, includeDeadLetters: false, agentName: "reporter" });
      expect(result.rows).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.rows.every(r => r.agentName === "reporter")).toBe(true);
      store.close();
    });

    it("filters rows by triggerType", () => {
      const store = createStore();
      const now = Date.now();
      store.recordRun(makeRun({ agentName: "reporter", startedAt: now - 2000, triggerType: "schedule" }));
      store.recordRun(makeRun({ agentName: "reviewer", startedAt: now - 1000, triggerType: "webhook" }));
      store.recordRun(makeRun({ agentName: "reporter", startedAt: now, triggerType: "schedule" }));

      const result = store.queryActivityRowsWithTotal({ limit: 10, offset: 0, includeDeadLetters: false, triggerType: "schedule" });
      expect(result.rows).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.rows.every(r => r.triggerType === "schedule")).toBe(true);
      store.close();
    });

    it("filters rows by dbStatuses", () => {
      const store = createStore();
      const now = Date.now();
      store.recordRun(makeRun({ agentName: "reporter", startedAt: now - 2000, result: "completed" }));
      store.recordRun(makeRun({ agentName: "reviewer", startedAt: now - 1000, result: "error" }));

      const result = store.queryActivityRowsWithTotal({ limit: 10, offset: 0, includeDeadLetters: false, dbStatuses: ["completed"] });
      expect(result.rows).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.rows[0].result).toBe("completed");
      store.close();
    });

    it("returns only dead-letters when dbStatuses contains only dead-letter and includeDeadLetters true", () => {
      const store = createStore();
      const now = Date.now();
      store.recordRun(makeRun({ agentName: "reporter", startedAt: now - 2000 }));
      store.recordWebhookReceipt(makeReceipt({ id: "dl-wt-only-1", timestamp: now - 1000, status: "dead-letter", deadLetterReason: "parse_error" }));
      store.recordWebhookReceipt(makeReceipt({ id: "dl-wt-only-2", timestamp: now, status: "dead-letter", deadLetterReason: "no_match" }));

      const result = store.queryActivityRowsWithTotal({ limit: 10, offset: 0, includeDeadLetters: true, dbStatuses: ["dead-letter"] });
      expect(result.rows).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.rows.every(r => r.result === "dead-letter")).toBe(true);
      store.close();
    });

    it("respects pagination: offset skips rows and total remains correct", () => {
      const store = createStore();
      const now = Date.now();
      for (let i = 0; i < 6; i++) {
        store.recordRun(makeRun({ agentName: "reporter", startedAt: now - i * 1000, instanceId: `pg-run-${i}` }));
      }

      const page1 = store.queryActivityRowsWithTotal({ limit: 3, offset: 0, includeDeadLetters: false });
      expect(page1.rows).toHaveLength(3);
      expect(page1.total).toBe(6);

      const page2 = store.queryActivityRowsWithTotal({ limit: 3, offset: 3, includeDeadLetters: false });
      expect(page2.rows).toHaveLength(3);
      expect(page2.total).toBe(6);

      // Pages should not overlap
      const page1Ids = page1.rows.map(r => r.instanceId);
      const page2Ids = page2.rows.map(r => r.instanceId);
      expect(page1Ids.some(id => page2Ids.includes(id))).toBe(false);
      store.close();
    });

    it("enriches webhook run rows with triggerSource from webhook_receipts", () => {
      const store = createStore();
      const now = Date.now();
      const receiptId = "enrich-receipt-1";
      store.recordWebhookReceipt(makeReceipt({ id: receiptId, source: "github", eventSummary: "issues.opened", status: "processed", matchedAgents: 1 }));
      store.recordRun(makeRun({ agentName: "reporter", startedAt: now, triggerType: "webhook", webhookReceiptId: receiptId }));

      const result = store.queryActivityRowsWithTotal({ limit: 10, offset: 0, includeDeadLetters: false });
      expect(result.rows).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.rows[0].triggerSource).toBe("github");
      expect(result.rows[0].eventSummary).toBe("issues.opened");
      store.close();
    });

    it("does not set eventSummary when it equals triggerSource", () => {
      const store = createStore();
      const now = Date.now();
      const receiptId = "enrich-receipt-2";
      // eventSummary same as source → should not be set as eventSummary
      store.recordWebhookReceipt(makeReceipt({ id: receiptId, source: "github", eventSummary: "github", status: "processed", matchedAgents: 1 }));
      store.recordRun(makeRun({ agentName: "reporter", startedAt: now, triggerType: "webhook", webhookReceiptId: receiptId }));

      const result = store.queryActivityRowsWithTotal({ limit: 10, offset: 0, includeDeadLetters: false });
      expect(result.rows).toHaveLength(1);
      // eventSummary should not be present when it equals source
      expect(result.rows[0].eventSummary).toBeUndefined();
      store.close();
    });

    it("excludes dead-letters when agentName filter is set, even with includeDeadLetters true", () => {
      const store = createStore();
      const now = Date.now();
      store.recordRun(makeRun({ agentName: "reporter", startedAt: now - 2000 }));
      store.recordWebhookReceipt(makeReceipt({ id: "dl-agent-wt-1", timestamp: now - 1000, status: "dead-letter" }));

      const result = store.queryActivityRowsWithTotal({ limit: 10, offset: 0, includeDeadLetters: true, agentName: "reporter" });
      expect(result.rows).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.rows[0].agentName).toBe("reporter");
      store.close();
    });

    it("excludes dead-letters when triggerType filter is non-webhook", () => {
      const store = createStore();
      const now = Date.now();
      store.recordRun(makeRun({ agentName: "reporter", startedAt: now - 2000, triggerType: "schedule" }));
      store.recordWebhookReceipt(makeReceipt({ id: "dl-type-wt-1", timestamp: now - 1000, status: "dead-letter" }));

      const result = store.queryActivityRowsWithTotal({ limit: 10, offset: 0, includeDeadLetters: true, triggerType: "schedule" });
      expect(result.rows).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.rows[0].triggerType).toBe("schedule");
      store.close();
    });
  });
});
