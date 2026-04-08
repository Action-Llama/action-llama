/**
 * Integration tests: control/routes/stats.ts registerStatsRoutes() with populated data — no Docker required.
 *
 * The existing stats endpoint tests (stats-endpoints-empty.test.ts,
 * stats-with-status-tracker.test.ts) only test routes with an empty StatsStore
 * or via the full integration harness. This test constructs a Hono app with
 * registerStatsRoutes() directly, populating a real StatsStore to exercise
 * the data-path branches of each route.
 *
 * Routes tested with populated data:
 *   1. GET /api/stats/agents/:name/runs — populated store → runs[] + total
 *   2. GET /api/stats/agents/:name/runs?page=2&limit=1 — pagination params reflected
 *   3. GET /api/stats/agents/:name/runs/:instanceId — known instanceId → run object
 *   4. GET /api/stats/agents/:name/runs/:instanceId — unknown instanceId → { run: null }
 *   5. GET /api/stats/webhooks/:receiptId — known receipt → receipt object
 *   6. GET /api/stats/webhooks/:receiptId — unknown ID → 404 { receipt: null }
 *   7. GET /api/stats/triggers — populated store → triggers[] + total
 *   8. GET /api/stats/triggers?agent=<name> — agent filter narrows results
 *   9. GET /api/stats/triggers?all=1 — includeDeadLetters path
 *  10. GET /api/stats/agents/:name/runs — no statsStore → empty response
 *  11. getWebhookSourcesBatch() — empty input → {}; populated → id→source map
 *
 * Covers:
 *   - control/routes/stats.ts: GET /api/stats/agents/:name/runs — runs + total with data
 *   - control/routes/stats.ts: GET /api/stats/agents/:name/runs — page/limit reflected
 *   - control/routes/stats.ts: GET /api/stats/agents/:name/runs/:instanceId — found
 *   - control/routes/stats.ts: GET /api/stats/agents/:name/runs/:instanceId — null
 *   - control/routes/stats.ts: GET /api/stats/webhooks/:receiptId — found
 *   - control/routes/stats.ts: GET /api/stats/webhooks/:receiptId — 404 not found
 *   - control/routes/stats.ts: GET /api/stats/triggers — triggers + total with data
 *   - control/routes/stats.ts: GET /api/stats/triggers?agent — agent filter applied
 *   - control/routes/stats.ts: GET /api/stats/triggers?all=1 — dead-letter included
 *   - control/routes/stats.ts: GET /api/stats/agents/:name/runs — no statsStore → empty
 *   - stats/store.ts: getWebhookSourcesBatch() — empty input → {}
 *   - stats/store.ts: getWebhookSourcesBatch() — returns id→source map for known receipts
 *   - stats/store.ts: getWebhookSourcesBatch() — omits unknown IDs
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

const { Hono } = await import(
  /* @vite-ignore */
  "/tmp/repo/node_modules/hono/dist/index.js"
);

const {
  registerStatsRoutes,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/control/routes/stats.js"
);

const {
  StatsStore,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/stats/store.js"
);

function makeTempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "al-stats-routes-test-"));
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
    matchedAgents: 1,
    status: "processed" as const,
    ...overrides,
  };
}

// Helper: make a Hono app with registerStatsRoutes and optional StatsStore
function makeApp(store?: any) {
  const app = new Hono();
  registerStatsRoutes(app, store);
  return app;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/stats/agents/:name/runs
// ─────────────────────────────────────────────────────────────────────────────

describe("integration: registerStatsRoutes() with populated StatsStore (no Docker required)", { timeout: 30_000 }, () => {

  it("GET /api/stats/agents/:name/runs returns runs and total for populated agent", async () => {
    const store = new StatsStore(makeTempDbPath());
    const instanceId1 = randomUUID();
    const instanceId2 = randomUUID();
    store.recordRun(makeRun({ agentName: "my-agent", instanceId: instanceId1 }));
    store.recordRun(makeRun({ agentName: "my-agent", instanceId: instanceId2 }));
    store.recordRun(makeRun({ agentName: "other-agent" }));

    const app = makeApp(store);
    const res = await app.request("/api/stats/agents/my-agent/runs");
    expect(res.status).toBe(200);
    const body = await res.json() as any;

    expect(body.total).toBe(2);
    expect(Array.isArray(body.runs)).toBe(true);
    expect(body.runs.length).toBe(2);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(10);
    store.close();
  });

  it("GET /api/stats/agents/:name/runs?page=2&limit=1 reflects pagination params", async () => {
    const store = new StatsStore(makeTempDbPath());
    store.recordRun(makeRun({ agentName: "paged-agent", startedAt: Date.now() + 100 }));
    store.recordRun(makeRun({ agentName: "paged-agent", startedAt: Date.now() + 200 }));

    const app = makeApp(store);
    const res = await app.request("/api/stats/agents/paged-agent/runs?page=2&limit=1");
    expect(res.status).toBe(200);
    const body = await res.json() as any;

    expect(body.page).toBe(2);
    expect(body.limit).toBe(1);
    expect(body.total).toBe(2);
    expect(body.runs.length).toBe(1); // Second page: 1 item
    store.close();
  });

  it("GET /api/stats/agents/:name/runs without statsStore returns empty response", async () => {
    const app = makeApp(undefined); // No stats store
    const res = await app.request("/api/stats/agents/any-agent/runs");
    expect(res.status).toBe(200);
    const body = await res.json() as any;

    expect(body.runs).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(10);
  });

  it("GET /api/stats/agents/:name/runs returns empty for unknown agent", async () => {
    const store = new StatsStore(makeTempDbPath());
    store.recordRun(makeRun({ agentName: "other-agent" }));

    const app = makeApp(store);
    const res = await app.request("/api/stats/agents/unknown-agent/runs");
    expect(res.status).toBe(200);
    const body = await res.json() as any;

    expect(body.total).toBe(0);
    expect(body.runs).toEqual([]);
    store.close();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /api/stats/agents/:name/runs/:instanceId
  // ─────────────────────────────────────────────────────────────────────────────

  it("GET /api/stats/agents/:name/runs/:instanceId returns run for known instanceId", async () => {
    const store = new StatsStore(makeTempDbPath());
    const instanceId = randomUUID();
    store.recordRun(makeRun({ agentName: "run-detail-agent", instanceId, triggerType: "schedule" }));

    const app = makeApp(store);
    const res = await app.request(`/api/stats/agents/run-detail-agent/runs/${instanceId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;

    expect(body.run).not.toBeNull();
    expect(body.run.instance_id).toBe(instanceId);
    expect(body.run.agent_name).toBe("run-detail-agent");
    expect(body.run.trigger_type).toBe("schedule");
    store.close();
  });

  it("GET /api/stats/agents/:name/runs/:instanceId returns null for unknown instanceId", async () => {
    const store = new StatsStore(makeTempDbPath());
    const app = makeApp(store);
    const res = await app.request(`/api/stats/agents/any-agent/runs/${randomUUID()}`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;

    expect(body.run).toBeNull();
    store.close();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /api/stats/webhooks/:receiptId
  // ─────────────────────────────────────────────────────────────────────────────

  it("GET /api/stats/webhooks/:receiptId returns receipt for known ID", async () => {
    const store = new StatsStore(makeTempDbPath());
    const receipt = makeReceipt({ source: "github", eventSummary: "push event" });
    store.recordWebhookReceipt(receipt);

    const app = makeApp(store);
    const res = await app.request(`/api/stats/webhooks/${receipt.id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;

    expect(body.receipt).not.toBeNull();
    expect(body.receipt.id).toBe(receipt.id);
    expect(body.receipt.source).toBe("github");
    store.close();
  });

  it("GET /api/stats/webhooks/:receiptId returns 404 for unknown ID", async () => {
    const store = new StatsStore(makeTempDbPath());
    const app = makeApp(store);
    const res = await app.request(`/api/stats/webhooks/${randomUUID()}`);
    expect(res.status).toBe(404);
    const body = await res.json() as any;

    expect(body.receipt).toBeNull();
    store.close();
  });

  it("GET /api/stats/webhooks/:receiptId returns null receipt when no statsStore", async () => {
    const app = makeApp(undefined);
    const res = await app.request(`/api/stats/webhooks/${randomUUID()}`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;

    expect(body.receipt).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /api/stats/triggers
  // ─────────────────────────────────────────────────────────────────────────────

  it("GET /api/stats/triggers returns triggers and total for populated store", async () => {
    const store = new StatsStore(makeTempDbPath());
    store.recordRun(makeRun({ agentName: "agent-a", triggerType: "manual", startedAt: Date.now() - 1000 }));
    store.recordRun(makeRun({ agentName: "agent-a", triggerType: "webhook", startedAt: Date.now() - 500 }));
    store.recordRun(makeRun({ agentName: "agent-b", triggerType: "manual", startedAt: Date.now() - 200 }));

    const app = makeApp(store);
    const res = await app.request("/api/stats/triggers");
    expect(res.status).toBe(200);
    const body = await res.json() as any;

    expect(typeof body.total).toBe("number");
    expect(body.total).toBe(3);
    expect(Array.isArray(body.triggers)).toBe(true);
    expect(body.triggers.length).toBe(3);
    store.close();
  });

  it("GET /api/stats/triggers?agent=<name> filters by agent", async () => {
    const store = new StatsStore(makeTempDbPath());
    store.recordRun(makeRun({ agentName: "target-agent", startedAt: Date.now() - 1000 }));
    store.recordRun(makeRun({ agentName: "target-agent", startedAt: Date.now() - 500 }));
    store.recordRun(makeRun({ agentName: "other-agent", startedAt: Date.now() - 200 }));

    const app = makeApp(store);
    const res = await app.request("/api/stats/triggers?agent=target-agent");
    expect(res.status).toBe(200);
    const body = await res.json() as any;

    expect(body.total).toBe(2);
    for (const trigger of body.triggers) {
      expect(trigger.agentName).toBe("target-agent");
    }
    store.close();
  });

  it("GET /api/stats/triggers?all=1 includes dead-letter webhook receipts", async () => {
    const store = new StatsStore(makeTempDbPath());
    // One completed run
    store.recordRun(makeRun({ agentName: "dl-agent", triggerType: "webhook", startedAt: Date.now() - 2000 }));
    // One dead-letter receipt
    store.recordWebhookReceipt({
      id: randomUUID(),
      source: "github",
      timestamp: Date.now() - 1000,
      matchedAgents: 0,
      status: "dead-letter",
      deadLetterReason: "no_match",
    });

    const app = makeApp(store);
    const withDL = await app.request("/api/stats/triggers?all=1");
    const withoutDL = await app.request("/api/stats/triggers");

    expect(withDL.status).toBe(200);
    expect(withoutDL.status).toBe(200);

    const bodyWith = await withDL.json() as any;
    const bodyWithout = await withoutDL.json() as any;

    // includeDeadLetters adds the dead-letter receipt
    expect(bodyWith.total).toBe(bodyWithout.total + 1);
    const dlEntries = bodyWith.triggers.filter((t: any) => t.result === "dead-letter");
    expect(dlEntries.length).toBe(1);
    store.close();
  });

  it("GET /api/stats/triggers returns limit/offset reflected in response", async () => {
    const store = new StatsStore(makeTempDbPath());
    for (let i = 0; i < 5; i++) {
      store.recordRun(makeRun({ agentName: "paged-trigger-agent", startedAt: Date.now() + i }));
    }

    const app = makeApp(store);
    const res = await app.request("/api/stats/triggers?limit=2&offset=1");
    expect(res.status).toBe(200);
    const body = await res.json() as any;

    expect(body.limit).toBe(2);
    expect(body.offset).toBe(1);
    expect(body.triggers.length).toBeLessThanOrEqual(2);
    store.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// stats/store.ts: getWebhookSourcesBatch()
// ─────────────────────────────────────────────────────────────────────────────

describe("integration: StatsStore.getWebhookSourcesBatch() (no Docker required)", { timeout: 30_000 }, () => {
  it("returns empty object for empty input", () => {
    const store = new StatsStore(makeTempDbPath());
    const result = store.getWebhookSourcesBatch([]);
    expect(result).toEqual({});
    store.close();
  });

  it("returns id→source map for known receipt IDs", () => {
    const store = new StatsStore(makeTempDbPath());
    const id1 = randomUUID();
    const id2 = randomUUID();
    store.recordWebhookReceipt(makeReceipt({ id: id1, source: "github" }));
    store.recordWebhookReceipt(makeReceipt({ id: id2, source: "linear" }));

    const result = store.getWebhookSourcesBatch([id1, id2]);
    expect(result[id1]).toBe("github");
    expect(result[id2]).toBe("linear");
    store.close();
  });

  it("omits unknown IDs from the result", () => {
    const store = new StatsStore(makeTempDbPath());
    const id1 = randomUUID();
    const unknownId = randomUUID();
    store.recordWebhookReceipt(makeReceipt({ id: id1, source: "sentry" }));

    const result = store.getWebhookSourcesBatch([id1, unknownId]);
    expect(Object.keys(result).length).toBe(1);
    expect(result[id1]).toBe("sentry");
    expect(result[unknownId]).toBeUndefined();
    store.close();
  });

  it("returns only requested IDs from a store with many receipts", () => {
    const store = new StatsStore(makeTempDbPath());
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = randomUUID();
      ids.push(id);
      store.recordWebhookReceipt(makeReceipt({ id, source: `source-${i}` }));
    }

    // Request only the first 2
    const result = store.getWebhookSourcesBatch([ids[0], ids[1]]);
    expect(Object.keys(result).length).toBe(2);
    expect(result[ids[0]]).toBe("source-0");
    expect(result[ids[1]]).toBe("source-1");
    store.close();
  });
});
