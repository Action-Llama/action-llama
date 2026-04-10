/**
 * Integration tests: control/routes/dashboard-api.ts toTriggerDetail() DB-backed path — no Docker required.
 *
 * The GET /api/dashboard/triggers/:sessionId endpoint has two branches:
 *   1. Instance is currently running in StatusTracker → toRunningTriggerDetail() [already tested]
 *   2. Instance is found in StatsStore DB → toTriggerDetail() [THIS FILE]
 *
 * toTriggerDetail() has several sub-branches based on trigger type:
 *   a. Non-webhook, non-agent trigger (e.g. "manual") → base fields only
 *   b. trigger_type="webhook" + webhook_receipt_id + statsStore → adds webhook enrichment
 *   c. trigger_type="webhook" + webhook_receipt_id but receipt not found → just base
 *   d. trigger_type="agent" + statsStore + call edge found → adds callerAgent/callerInstance/callDepth
 *   e. trigger_type="agent" + statsStore but no call edge → just base
 *   f. Instance not found in DB and not running → 404 { trigger: null }
 *
 * Covers:
 *   - control/routes/dashboard-api.ts: toTriggerDetail() — manual trigger type returns base fields
 *   - control/routes/dashboard-api.ts: toTriggerDetail() — schedule trigger type returns base fields
 *   - control/routes/dashboard-api.ts: toTriggerDetail() — webhook type with valid receipt → enriched
 *   - control/routes/dashboard-api.ts: toTriggerDetail() — webhook type receipt not found → base only
 *   - control/routes/dashboard-api.ts: toTriggerDetail() — agent type with call edge → callerAgent/callDepth
 *   - control/routes/dashboard-api.ts: toTriggerDetail() — agent type without call edge → base only
 *   - control/routes/dashboard-api.ts: GET /api/dashboard/triggers/:sessionId — unknown sessionId → 404
 *   - control/routes/dashboard-api.ts: GET /api/dashboard/triggers/:sessionId — triggerContext preserved
 *   - stats/store.ts: queryRunBySessionId() — found and not found
 *   - stats/store.ts: queryCallEdgeByTargetSession() — agent trigger enrichment
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { StatusTracker } from "@action-llama/action-llama/internals/status-tracker";

const { Hono } = await import(
  /* @vite-ignore */
  "/tmp/repo/node_modules/hono/dist/index.js"
);

const {
  registerDashboardApiRoutes,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/control/routes/dashboard-api.js"
);

const {
  StatsStore,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/stats/store.js"
);

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDb(): { store: InstanceType<typeof StatsStore>; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "al-dash-trigger-test-"));
  const dbPath = join(dir, "stats.db");
  const store = new StatsStore(dbPath);
  return { store, dbPath };
}

function makeApp(
  tracker: StatusTracker,
  statsStore?: InstanceType<typeof StatsStore>,
) {
  const app = new Hono();
  registerDashboardApiRoutes(app, tracker, undefined, statsStore);
  return app;
}

function makeTracker(agentName = "test-agent"): StatusTracker {
  const tracker = new StatusTracker();
  tracker.registerAgent(agentName, 1);
  return tracker;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe(
  "integration: control/routes/dashboard-api.ts toTriggerDetail() DB-backed path (no Docker required)",
  { timeout: 20_000 },
  () => {
    // ── 404 path — unknown sessionId ────────────────────────────────────────

    it("returns 404 { trigger: null } when sessionId not in DB and not running", async () => {
      const tracker = makeTracker();
      const { store } = makeTmpDb();
      const app = makeApp(tracker, store);

      const res = await app.request(`/api/dashboard/triggers/${randomUUID()}`);
      expect(res.status).toBe(404);
      const body = await res.json() as { trigger: null };
      expect(body.trigger).toBeNull();
    });

    it("returns 404 when no statsStore and instance not running", async () => {
      const tracker = makeTracker();
      const app = makeApp(tracker, undefined); // no statsStore

      const res = await app.request(`/api/dashboard/triggers/${randomUUID()}`);
      expect(res.status).toBe(404);
    });

    // ── base fields path — manual trigger ────────────────────────────────────

    it("toTriggerDetail() returns base fields for manual trigger type", async () => {
      const tracker = makeTracker("my-agent");
      const { store } = makeTmpDb();
      const sessionId = randomUUID();
      const now = Date.now();

      store.recordRun({
        sessionId,
        agentName: "my-agent",
        triggerType: "manual",
        result: "completed",
        startedAt: now,
        durationMs: 1000,
      });

      const app = makeApp(tracker, store);
      const res = await app.request(`/api/dashboard/triggers/${sessionId}`);
      expect(res.status).toBe(200);

      const body = await res.json() as { trigger: Record<string, unknown> };
      expect(body.trigger).toBeDefined();
      expect(body.trigger.sessionId).toBe(sessionId);
      expect(body.trigger.agentName).toBe("my-agent");
      expect(body.trigger.triggerType).toBe("manual");
      expect(body.trigger.triggerSource).toBeNull();
      expect(body.trigger.triggerContext).toBeNull();
      expect(typeof body.trigger.startedAt).toBe("number");
      // No webhook or caller enrichment
      expect(body.trigger.webhook).toBeUndefined();
      expect(body.trigger.callerAgent).toBeUndefined();
    });

    // ── base fields path — schedule trigger ──────────────────────────────────

    it("toTriggerDetail() returns base fields for schedule trigger type", async () => {
      const tracker = makeTracker("sched-agent");
      const { store } = makeTmpDb();
      const sessionId = randomUUID();

      store.recordRun({
        sessionId,
        agentName: "sched-agent",
        triggerType: "schedule",
        result: "completed",
        startedAt: Date.now(),
        durationMs: 500,
      });

      const app = makeApp(tracker, store);
      const res = await app.request(`/api/dashboard/triggers/${sessionId}`);
      expect(res.status).toBe(200);

      const body = await res.json() as { trigger: Record<string, unknown> };
      expect(body.trigger.triggerType).toBe("schedule");
      expect(body.trigger.triggerSource).toBeNull();
      expect(body.trigger.webhook).toBeUndefined();
      expect(body.trigger.callerAgent).toBeUndefined();
    });

    // ── triggerContext preserved ──────────────────────────────────────────────

    it("toTriggerDetail() preserves triggerSource and triggerContext from DB run", async () => {
      const tracker = makeTracker("context-agent");
      const { store } = makeTmpDb();
      const sessionId = randomUUID();

      store.recordRun({
        sessionId,
        agentName: "context-agent",
        triggerType: "webhook",
        triggerSource: "github",
        result: "completed",
        startedAt: Date.now(),
        durationMs: 200,
      });

      const app = makeApp(tracker, store);
      const res = await app.request(`/api/dashboard/triggers/${sessionId}`);
      expect(res.status).toBe(200);

      const body = await res.json() as { trigger: Record<string, unknown> };
      expect(body.trigger.triggerType).toBe("webhook");
      expect(body.trigger.triggerSource).toBe("github");
    });

    // ── webhook enrichment path ───────────────────────────────────────────────

    it("toTriggerDetail() enriches with webhook fields when trigger_type=webhook and receipt found", async () => {
      const tracker = makeTracker("webhook-agent");
      const { store } = makeTmpDb();
      const sessionId = randomUUID();
      const receiptId = randomUUID();
      const now = Date.now();

      // Record a webhook receipt
      store.recordWebhookReceipt({
        id: receiptId,
        source: "github",
        deliveryId: "delivery-123",
        eventSummary: "push to main",
        timestamp: now,
        headers: JSON.stringify({ "x-github-event": "push" }),
        body: JSON.stringify({ ref: "refs/heads/main" }),
        matchedAgents: 1,
        status: "processed",
      });

      // Record a run linked to this receipt
      store.recordRun({
        sessionId,
        agentName: "webhook-agent",
        triggerType: "webhook",
        triggerSource: "github",
        result: "completed",
        startedAt: now,
        durationMs: 800,
        webhookReceiptId: receiptId,
      });

      const app = makeApp(tracker, store);
      const res = await app.request(`/api/dashboard/triggers/${sessionId}`);
      expect(res.status).toBe(200);

      const body = await res.json() as { trigger: Record<string, unknown> };
      expect(body.trigger.triggerType).toBe("webhook");
      expect(body.trigger.webhook).toBeDefined();

      const wh = body.trigger.webhook as Record<string, unknown>;
      expect(wh.receiptId).toBe(receiptId);
      expect(wh.source).toBe("github");
      expect(wh.deliveryId).toBe("delivery-123");
      expect(wh.eventSummary).toBe("push to main");
      expect(wh.matchedAgents).toBe(1);
      expect(wh.status).toBe("processed");
      // No callerAgent enrichment for webhook
      expect(body.trigger.callerAgent).toBeUndefined();
    });

    it("toTriggerDetail() returns base only when webhook_receipt_id present but receipt not found", async () => {
      const tracker = makeTracker("webhook-no-receipt");
      const { store } = makeTmpDb();
      const sessionId = randomUUID();
      const missingReceiptId = randomUUID();

      // Run references a receipt that doesn't exist in the DB
      store.recordRun({
        sessionId,
        agentName: "webhook-no-receipt",
        triggerType: "webhook",
        triggerSource: "github",
        result: "completed",
        startedAt: Date.now(),
        durationMs: 100,
        webhookReceiptId: missingReceiptId,
      });

      const app = makeApp(tracker, store);
      const res = await app.request(`/api/dashboard/triggers/${sessionId}`);
      expect(res.status).toBe(200);

      const body = await res.json() as { trigger: Record<string, unknown> };
      expect(body.trigger.triggerType).toBe("webhook");
      // Receipt not found → no webhook enrichment
      expect(body.trigger.webhook).toBeUndefined();
      expect(body.trigger.callerAgent).toBeUndefined();
    });

    // ── agent trigger enrichment path ─────────────────────────────────────────

    it("toTriggerDetail() enriches with callerAgent/callDepth when trigger_type=agent and call edge found", async () => {
      const tracker = makeTracker("callee-agent");
      const { store } = makeTmpDb();
      const targetInstanceId = randomUUID();
      const callerSessionId = randomUUID();
      const now = Date.now();

      // Record a call edge (caller → target)
      store.recordCallEdge({
        callerAgent: "caller-agent",
        callerSession: callerSessionId,
        targetAgent: "callee-agent",
        targetSession: targetInstanceId,
        depth: 2,
        startedAt: now,
        status: "completed",
      });

      // Record the target run
      store.recordRun({
        sessionId: targetInstanceId,
        agentName: "callee-agent",
        triggerType: "agent",
        triggerSource: "caller-agent",
        result: "completed",
        startedAt: now,
        durationMs: 500,
      });

      const app = makeApp(tracker, store);
      const res = await app.request(`/api/dashboard/triggers/${targetInstanceId}`);
      expect(res.status).toBe(200);

      const body = await res.json() as { trigger: Record<string, unknown> };
      expect(body.trigger.triggerType).toBe("agent");
      expect(body.trigger.callerAgent).toBe("caller-agent");
      expect(body.trigger.callerInstance).toBe(callerSessionId);
      expect(body.trigger.callDepth).toBe(2);
      // No webhook enrichment
      expect(body.trigger.webhook).toBeUndefined();
    });

    it("toTriggerDetail() returns base only when trigger_type=agent but no call edge found", async () => {
      const tracker = makeTracker("callee-no-edge");
      const { store } = makeTmpDb();
      const sessionId = randomUUID();

      // Run with agent trigger but no matching call edge
      store.recordRun({
        sessionId,
        agentName: "callee-no-edge",
        triggerType: "agent",
        triggerSource: "some-caller",
        result: "completed",
        startedAt: Date.now(),
        durationMs: 300,
      });

      const app = makeApp(tracker, store);
      const res = await app.request(`/api/dashboard/triggers/${sessionId}`);
      expect(res.status).toBe(200);

      const body = await res.json() as { trigger: Record<string, unknown> };
      expect(body.trigger.triggerType).toBe("agent");
      expect(body.trigger.triggerSource).toBe("some-caller");
      // No call edge → no callerAgent enrichment
      expect(body.trigger.callerAgent).toBeUndefined();
      expect(body.trigger.callDepth).toBeUndefined();
    });

    // ── DB path takes priority over running-instance lookup ───────────────────

    it("uses DB run when statsStore is provided, even if instance is also running in tracker", async () => {
      // This tests the code path ordering: statsStore?.queryRunBySessionId is checked first
      const tracker = makeTracker("priority-agent");
      const { store } = makeTmpDb();
      const sessionId = randomUUID();
      const now = Date.now();

      // Register as running in tracker
      tracker.registerSession({
        id: sessionId,
        agentName: "priority-agent",
        status: "running",
        startedAt: new Date(now),
        trigger: "schedule",
      });

      // Also write to DB with manual trigger type
      store.recordRun({
        sessionId,
        agentName: "priority-agent",
        triggerType: "manual",
        result: "completed",
        startedAt: now,
        durationMs: 100,
      });

      const app = makeApp(tracker, store);
      const res = await app.request(`/api/dashboard/triggers/${sessionId}`);
      expect(res.status).toBe(200);

      const body = await res.json() as { trigger: Record<string, unknown> };
      // DB path is used when run found, regardless of running status
      // The code does `const run = statsStore?.queryRunBySessionId(...)` then checks if run is falsy
      // Since run is found, it returns toTriggerDetail (which yields "manual")
      expect(body.trigger.triggerType).toBe("manual");
    });
  },
);
