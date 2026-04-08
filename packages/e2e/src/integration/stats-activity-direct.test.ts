/**
 * Integration tests: control/routes/stats.ts GET /api/stats/activity buildMemRows() — no Docker required.
 *
 * The /api/stats/activity endpoint's in-memory row building (buildMemRows()) handles:
 *   1. Running instances from StatusTracker (filtered by agent/triggerType)
 *   2. Pending queue items from controlDeps.workQueue
 *   3. Status filter: includeRunning / includePending flags
 *   4. triggerTypeFilter applied to both running and pending items
 *   5. Running/pending deduplication with DB rows
 *   6. Sort order: pending first, then running, by ts desc within group
 *
 * Covers:
 *   - control/routes/stats.ts: GET /api/stats/activity — running instances included in rows
 *   - control/routes/stats.ts: GET /api/stats/activity — running instance triggerType/source split
 *   - control/routes/stats.ts: GET /api/stats/activity — pending items from workQueue included
 *   - control/routes/stats.ts: GET /api/stats/activity — status=running excludes pending
 *   - control/routes/stats.ts: GET /api/stats/activity — status=pending excludes running
 *   - control/routes/stats.ts: GET /api/stats/activity — triggerTypeFilter applied to running instances
 *   - control/routes/stats.ts: GET /api/stats/activity — pendingCount field in response
 *   - control/routes/stats.ts: GET /api/stats/activity — rows sorted (pending first, then running)
 */

import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "crypto";
import { StatusTracker } from "@action-llama/action-llama/internals/status-tracker";

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

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTracker(agentName = "test-agent"): StatusTracker {
  const tracker = new StatusTracker();
  tracker.registerAgent(agentName, 1);
  return tracker;
}

function makeWorkQueueMock(items: { agentName: string; context: unknown; receivedAt: Date }[]) {
  return {
    size: vi.fn((agentName: string) => items.filter((i) => i.agentName === agentName).length),
    peek: vi.fn((agentName: string) => items.filter((i) => i.agentName === agentName).map(({ context, receivedAt }) => ({ context, receivedAt }))),
  };
}

function makeApp(
  statsStore?: any,
  statusTracker?: StatusTracker,
  controlDeps?: { workQueue?: ReturnType<typeof makeWorkQueueMock> },
) {
  const app = new Hono();
  registerStatsRoutes(app, statsStore, statusTracker, controlDeps);
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe(
  "integration: GET /api/stats/activity buildMemRows() direct tests — no Docker required",
  { timeout: 20_000 },
  () => {
    // ── running instances in rows ─────────────────────────────────────────────

    it("running instances appear in activity rows", async () => {
      const tracker = makeTracker("run-agent");
      const instanceId = randomUUID();
      const now = Date.now();

      tracker.registerInstance({
        id: instanceId,
        agentName: "run-agent",
        status: "running",
        startedAt: new Date(now),
        trigger: "manual",
      });

      const app = makeApp(undefined, tracker, undefined);
      const res = await app.request("/api/stats/activity");
      expect(res.status).toBe(200);

      const body = await res.json() as { rows: Array<{ instanceId: string; result: string }> };
      const row = body.rows.find((r) => r.instanceId === instanceId);
      expect(row).toBeDefined();
      expect(row!.result).toBe("running");
    });

    // ── triggerType/source split for running instances ────────────────────────

    it("running instance 'webhook:test' splits into triggerType/triggerSource", async () => {
      const tracker = makeTracker("wh-agent");
      const instanceId = randomUUID();

      tracker.registerInstance({
        id: instanceId,
        agentName: "wh-agent",
        status: "running",
        startedAt: new Date(),
        trigger: "webhook:test-source",
      });

      const app = makeApp(undefined, tracker, undefined);
      const res = await app.request("/api/stats/activity");
      expect(res.status).toBe(200);

      const body = await res.json() as { rows: Array<{ instanceId: string; triggerType: string; triggerSource: string | null }> };
      const row = body.rows.find((r) => r.instanceId === instanceId);
      expect(row).toBeDefined();
      expect(row!.triggerType).toBe("webhook");
      expect(row!.triggerSource).toBe("test-source");
    });

    // ── pending items from workQueue ───────────────────────────────────────────

    it("pending queue items appear in activity rows", async () => {
      const tracker = makeTracker("queue-agent");
      const now = new Date();
      const workQueue = makeWorkQueueMock([
        {
          agentName: "queue-agent",
          context: { type: "manual" },
          receivedAt: now,
        },
      ]);

      const app = makeApp(undefined, tracker, { workQueue });
      const res = await app.request("/api/stats/activity");
      expect(res.status).toBe(200);

      const body = await res.json() as { rows: Array<{ result: string; agentName: string }> };
      const pending = body.rows.filter((r) => r.result === "pending");
      expect(pending.length).toBeGreaterThan(0);
      expect(pending[0].agentName).toBe("queue-agent");
    });

    // ── pendingCount field ────────────────────────────────────────────────────

    it("pendingCount field reflects pending rows", async () => {
      const tracker = makeTracker("pc-agent");
      const now = new Date();
      const workQueue = makeWorkQueueMock([
        { agentName: "pc-agent", context: { type: "manual" }, receivedAt: now },
        { agentName: "pc-agent", context: { type: "schedule" }, receivedAt: now },
      ]);

      const app = makeApp(undefined, tracker, { workQueue });
      const res = await app.request("/api/stats/activity");
      expect(res.status).toBe(200);

      const body = await res.json() as { pendingCount: number };
      expect(body.pendingCount).toBe(2);
    });

    // ── status=running excludes pending ───────────────────────────────────────

    it("?status=running returns running rows only, no pending", async () => {
      const tracker = makeTracker("status-agent");
      const instanceId = randomUUID();

      tracker.registerInstance({
        id: instanceId,
        agentName: "status-agent",
        status: "running",
        startedAt: new Date(),
        trigger: "manual",
      });

      const workQueue = makeWorkQueueMock([
        { agentName: "status-agent", context: { type: "manual" }, receivedAt: new Date() },
      ]);

      const app = makeApp(undefined, tracker, { workQueue });
      const res = await app.request("/api/stats/activity?status=running");
      expect(res.status).toBe(200);

      const body = await res.json() as { rows: Array<{ result: string }> };
      // Should only have running rows
      expect(body.rows.every((r) => r.result === "running")).toBe(true);
      // Should include our running instance
      expect(body.rows.length).toBeGreaterThan(0);
    });

    // ── status=pending excludes running ───────────────────────────────────────

    it("?status=pending returns pending rows only, no running", async () => {
      const tracker = makeTracker("pending-only-agent");
      const instanceId = randomUUID();

      tracker.registerInstance({
        id: instanceId,
        agentName: "pending-only-agent",
        status: "running",
        startedAt: new Date(),
        trigger: "manual",
      });

      const workQueue = makeWorkQueueMock([
        { agentName: "pending-only-agent", context: { type: "webhook" }, receivedAt: new Date() },
      ]);

      const app = makeApp(undefined, tracker, { workQueue });
      const res = await app.request("/api/stats/activity?status=pending");
      expect(res.status).toBe(200);

      const body = await res.json() as { rows: Array<{ result: string; instanceId: string | null }> };
      // Should only have pending rows
      expect(body.rows.every((r) => r.result === "pending")).toBe(true);
      // Running instance should NOT be included
      expect(body.rows.find((r) => r.instanceId === instanceId)).toBeUndefined();
    });

    // ── triggerTypeFilter applied to running instances ─────────────────────────

    it("?triggerType filter excludes running instances with wrong trigger type", async () => {
      const tracker = new StatusTracker();
      tracker.registerAgent("filter-agent", 1);

      const manualId = randomUUID();
      const webhookId = randomUUID();

      tracker.registerInstance({
        id: manualId,
        agentName: "filter-agent",
        status: "running",
        startedAt: new Date(),
        trigger: "manual",
      });
      tracker.registerInstance({
        id: webhookId,
        agentName: "filter-agent",
        status: "running",
        startedAt: new Date(),
        trigger: "webhook:github",
      });

      const app = makeApp(undefined, tracker, undefined);
      const res = await app.request("/api/stats/activity?triggerType=manual");
      expect(res.status).toBe(200);

      const body = await res.json() as { rows: Array<{ instanceId: string }> };
      // Only manual trigger instance
      expect(body.rows.find((r) => r.instanceId === manualId)).toBeDefined();
      // Webhook instance excluded
      expect(body.rows.find((r) => r.instanceId === webhookId)).toBeUndefined();
    });

    // ── sort: pending before running ──────────────────────────────────────────

    it("pending rows appear before running rows in activity", async () => {
      const tracker = makeTracker("sort-agent");
      const instanceId = randomUUID();

      tracker.registerInstance({
        id: instanceId,
        agentName: "sort-agent",
        status: "running",
        startedAt: new Date(Date.now() - 1000), // running started 1 second ago
        trigger: "manual",
      });

      const workQueue = makeWorkQueueMock([
        {
          agentName: "sort-agent",
          context: { type: "manual" },
          receivedAt: new Date(Date.now() - 2000), // pending queued 2 seconds ago (older)
        },
      ]);

      const app = makeApp(undefined, tracker, { workQueue });
      const res = await app.request("/api/stats/activity");
      expect(res.status).toBe(200);

      const body = await res.json() as { rows: Array<{ result: string }> };
      const results = body.rows.map((r) => r.result);
      const pendingIdx = results.indexOf("pending");
      const runningIdx = results.indexOf("running");
      // pending should come before running even though it's older
      if (pendingIdx !== -1 && runningIdx !== -1) {
        expect(pendingIdx).toBeLessThan(runningIdx);
      }
    });

    // ── webhook pending item builds correct fields ────────────────────────────

    it("pending webhook item includes correct triggerType", async () => {
      const tracker = makeTracker("wh-pending-agent");
      const workQueue = makeWorkQueueMock([
        {
          agentName: "wh-pending-agent",
          context: {
            type: "webhook",
            context: { source: "github", event: "push", action: "opened" },
          },
          receivedAt: new Date(),
        },
      ]);

      const app = makeApp(undefined, tracker, { workQueue });
      const res = await app.request("/api/stats/activity");
      expect(res.status).toBe(200);

      const body = await res.json() as { rows: Array<{ triggerType: string; result: string }> };
      const pendingRow = body.rows.find((r) => r.result === "pending");
      expect(pendingRow).toBeDefined();
      expect(pendingRow!.triggerType).toBe("webhook");
    });
  },
);
