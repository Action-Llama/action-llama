/**
 * Integration tests: control/routes/dashboard-api.ts GET /api/dashboard/agents/:name/instances/:id
 * with a populated StatsStore — no Docker required.
 *
 * The endpoint assembles a response from the DB run record plus optional
 * enrichment (parentEdge for agent triggers, webhookReceipt for webhook triggers).
 * These enrichment branches are only reachable when a real StatsStore is provided,
 * which is not covered by the existing no-Docker tests (they only test without statsStore).
 *
 * Branches tested:
 *   1. Run found in DB (manual trigger) → run populated, parentEdge/webhookReceipt absent
 *   2. Run found, trigger_type=agent, call edge found → parentEdge with caller info
 *   3. Run found, trigger_type=agent, no call edge → parentEdge undefined
 *   4. Run found, trigger_type=webhook, receipt found → webhookReceipt with source/summary
 *   5. Run found, trigger_type=webhook, receipt not found → webhookReceipt undefined
 *   6. Run found, instance also running in tracker → runningInstance populated
 *   7. instanceId not in DB, not running → run:null, runningInstance:null
 *
 * Covers:
 *   - control/routes/dashboard-api.ts: GET /api/dashboard/agents/:name/instances/:id — manual run in DB
 *   - control/routes/dashboard-api.ts: instances/:id — agent trigger + call edge → parentEdge
 *   - control/routes/dashboard-api.ts: instances/:id — agent trigger + no call edge → no parentEdge
 *   - control/routes/dashboard-api.ts: instances/:id — webhook trigger + receipt → webhookReceipt
 *   - control/routes/dashboard-api.ts: instances/:id — webhook trigger + no receipt → no webhookReceipt
 *   - control/routes/dashboard-api.ts: instances/:id — run found + instance running → runningInstance
 *   - control/routes/dashboard-api.ts: instances/:id — unknown instanceId → run:null runningInstance:null
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

function makeTmpStore(): InstanceType<typeof StatsStore> {
  const dir = mkdtempSync(join(tmpdir(), "al-inst-detail-test-"));
  return new StatsStore(join(dir, "stats.db"));
}

function makeTracker(agentName = "test-agent"): StatusTracker {
  const tracker = new StatusTracker();
  tracker.registerAgent(agentName, 1);
  return tracker;
}

function makeApp(
  tracker: StatusTracker,
  statsStore?: InstanceType<typeof StatsStore>,
) {
  const app = new Hono();
  registerDashboardApiRoutes(app, tracker, undefined, statsStore);
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe(
  "integration: GET /api/dashboard/agents/:name/instances/:id with DB — no Docker required",
  { timeout: 20_000 },
  () => {
    // ── unknown instanceId ─────────────────────────────────────────────────

    it("returns run:null and runningInstance:null for unknown instanceId", async () => {
      const tracker = makeTracker("my-agent");
      const store = makeTmpStore();
      const app = makeApp(tracker, store);

      const res = await app.request(
        `/api/dashboard/agents/my-agent/instances/${randomUUID()}`,
      );
      expect(res.status).toBe(200);
      const body = await res.json() as {
        run: null | undefined;
        runningInstance: null | undefined;
        parentEdge: unknown;
        webhookReceipt: unknown;
      };
      // queryRunByInstanceId returns undefined when not found; JSON serializes as null or omits key
      expect(body.run == null).toBe(true); // null or undefined
      // runningInstance is explicitly set to null (|| null) in the route
      expect(body.runningInstance).toBeNull();
      expect(body.parentEdge).toBeUndefined();
      expect(body.webhookReceipt).toBeUndefined();
    });

    // ── manual trigger in DB ─────────────────────────────────────────────────

    it("returns run populated and no enrichment for manual trigger", async () => {
      const tracker = makeTracker("my-agent");
      const store = makeTmpStore();
      const instanceId = randomUUID();

      store.recordRun({
        instanceId,
        agentName: "my-agent",
        triggerType: "manual",
        result: "completed",
        startedAt: Date.now(),
        durationMs: 500,
      });

      const app = makeApp(tracker, store);
      const res = await app.request(
        `/api/dashboard/agents/my-agent/instances/${instanceId}`,
      );
      expect(res.status).toBe(200);
      const body = await res.json() as { run: Record<string, unknown>; parentEdge: unknown; webhookReceipt: unknown };
      expect(body.run).toBeDefined();
      expect(body.run).not.toBeNull();
      // No enrichment for manual
      expect(body.parentEdge).toBeUndefined();
      expect(body.webhookReceipt).toBeUndefined();
    });

    // ── agent trigger + call edge → parentEdge ────────────────────────────────

    it("populates parentEdge when trigger_type=agent and call edge exists", async () => {
      const tracker = makeTracker("callee");
      const store = makeTmpStore();
      const targetInstanceId = randomUUID();
      const callerInstanceId = randomUUID();
      const now = Date.now();

      store.recordCallEdge({
        callerAgent: "caller-agent",
        callerInstance: callerInstanceId,
        targetAgent: "callee",
        targetInstance: targetInstanceId,
        depth: 1,
        startedAt: now,
        status: "completed",
      });

      store.recordRun({
        instanceId: targetInstanceId,
        agentName: "callee",
        triggerType: "agent",
        triggerSource: "caller-agent",
        result: "completed",
        startedAt: now,
        durationMs: 200,
      });

      const app = makeApp(tracker, store);
      const res = await app.request(
        `/api/dashboard/agents/callee/instances/${targetInstanceId}`,
      );
      expect(res.status).toBe(200);
      const body = await res.json() as { run: unknown; parentEdge: Record<string, unknown> | undefined };
      expect(body.run).not.toBeNull();
      expect(body.parentEdge).toBeDefined();
      expect(body.parentEdge!.caller_agent).toBe("caller-agent");
      expect(body.parentEdge!.caller_instance).toBe(callerInstanceId);
    });

    // ── agent trigger + no call edge → no parentEdge ──────────────────────────

    it("parentEdge is undefined when trigger_type=agent but no call edge found", async () => {
      const tracker = makeTracker("orphan-callee");
      const store = makeTmpStore();
      const instanceId = randomUUID();

      store.recordRun({
        instanceId,
        agentName: "orphan-callee",
        triggerType: "agent",
        triggerSource: "ghost-caller",
        result: "completed",
        startedAt: Date.now(),
        durationMs: 100,
      });

      const app = makeApp(tracker, store);
      const res = await app.request(
        `/api/dashboard/agents/orphan-callee/instances/${instanceId}`,
      );
      expect(res.status).toBe(200);
      const body = await res.json() as { run: unknown; parentEdge: undefined };
      expect(body.run).not.toBeNull();
      expect(body.parentEdge).toBeUndefined();
    });

    // ── webhook trigger + receipt → webhookReceipt ────────────────────────────

    it("populates webhookReceipt when trigger_type=webhook and receipt found", async () => {
      const tracker = makeTracker("webhook-agent");
      const store = makeTmpStore();
      const instanceId = randomUUID();
      const receiptId = randomUUID();
      const now = Date.now();

      store.recordWebhookReceipt({
        id: receiptId,
        source: "github",
        deliveryId: "gh-delivery-abc",
        eventSummary: "push to main branch",
        timestamp: now,
        matchedAgents: 1,
        status: "processed",
      });

      store.recordRun({
        instanceId,
        agentName: "webhook-agent",
        triggerType: "webhook",
        triggerSource: "github",
        result: "completed",
        startedAt: now,
        durationMs: 750,
        webhookReceiptId: receiptId,
      });

      const app = makeApp(tracker, store);
      const res = await app.request(
        `/api/dashboard/agents/webhook-agent/instances/${instanceId}`,
      );
      expect(res.status).toBe(200);
      const body = await res.json() as {
        run: unknown;
        webhookReceipt: Record<string, unknown> | undefined;
      };
      expect(body.run).not.toBeNull();
      expect(body.webhookReceipt).toBeDefined();
      expect(body.webhookReceipt!.source).toBe("github");
      expect(body.webhookReceipt!.deliveryId).toBe("gh-delivery-abc");
      expect(body.webhookReceipt!.eventSummary).toBe("push to main branch");
    });

    // ── webhook trigger + receipt not found → no webhookReceipt ──────────────

    it("webhookReceipt is undefined when receipt not found in DB", async () => {
      const tracker = makeTracker("webhook-no-receipt");
      const store = makeTmpStore();
      const instanceId = randomUUID();

      store.recordRun({
        instanceId,
        agentName: "webhook-no-receipt",
        triggerType: "webhook",
        triggerSource: "github",
        result: "completed",
        startedAt: Date.now(),
        durationMs: 200,
        webhookReceiptId: randomUUID(), // points to non-existent receipt
      });

      const app = makeApp(tracker, store);
      const res = await app.request(
        `/api/dashboard/agents/webhook-no-receipt/instances/${instanceId}`,
      );
      expect(res.status).toBe(200);
      const body = await res.json() as { run: unknown; webhookReceipt: undefined };
      expect(body.run).not.toBeNull();
      expect(body.webhookReceipt).toBeUndefined();
    });

    // ── run in DB + instance also running → runningInstance populated ─────────

    it("populates runningInstance when instance is both in DB and currently running", async () => {
      const tracker = makeTracker("running-agent");
      const store = makeTmpStore();
      const instanceId = randomUUID();
      const now = Date.now();

      // Add to DB
      store.recordRun({
        instanceId,
        agentName: "running-agent",
        triggerType: "manual",
        result: "running",
        startedAt: now,
        durationMs: 0,
      });

      // Also mark as running in the tracker
      tracker.registerInstance({
        id: instanceId,
        agentName: "running-agent",
        status: "running",
        startedAt: new Date(now),
        trigger: "manual",
      });

      const app = makeApp(tracker, store);
      const res = await app.request(
        `/api/dashboard/agents/running-agent/instances/${instanceId}`,
      );
      expect(res.status).toBe(200);
      const body = await res.json() as {
        run: unknown;
        runningInstance: Record<string, unknown> | null;
      };
      expect(body.run).not.toBeNull();
      expect(body.runningInstance).not.toBeNull();
      expect(body.runningInstance!.id).toBe(instanceId);
      expect(body.runningInstance!.agentName).toBe("running-agent");
    });
  },
);
