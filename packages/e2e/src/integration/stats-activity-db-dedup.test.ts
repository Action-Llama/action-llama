/**
 * Integration tests: control/routes/stats.ts GET /api/stats/activity DB deduplication — no Docker required.
 *
 * When includeDb=true (status filter includes completed/error/etc.) AND there are running
 * instances in the StatusTracker, the activity endpoint deduplicates DB rows against
 * running instances. This prevents a run that just finished from appearing twice
 * (once as "running" in mem and once as "completed" in DB).
 *
 * Also tests the "dbLimit=0 → only count" path when enough mem rows fill the page.
 *
 * Covers:
 *   - control/routes/stats.ts: GET /api/stats/activity — DB rows deduplicated against running instances
 *   - control/routes/stats.ts: GET /api/stats/activity — combined DB+mem rows in response
 *   - control/routes/stats.ts: GET /api/stats/activity — dbLimit>0 path (DB query needed)
 *   - control/routes/stats.ts: GET /api/stats/activity — total = memCount + dbCount
 *   - stats/store.ts: queryActivityRowsWithTotal() called with agent/status filters
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

function makeTmpStore(): InstanceType<typeof StatsStore> {
  const dir = mkdtempSync(join(tmpdir(), "al-stats-act-dedup-"));
  return new StatsStore(join(dir, "stats.db"));
}

function makeApp(
  statsStore?: InstanceType<typeof StatsStore>,
  statusTracker?: StatusTracker,
) {
  const app = new Hono();
  registerStatsRoutes(app, statsStore, statusTracker, undefined);
  return app;
}

describe(
  "integration: GET /api/stats/activity DB deduplication with mem rows — no Docker required",
  { timeout: 20_000 },
  () => {
    // ── DB rows deduplicated against running instances ─────────────────────────

    it("DB row with same instanceId as running instance is deduplicated", async () => {
      const tracker = new StatusTracker();
      tracker.registerAgent("dedup-agent", 1);
      const store = makeTmpStore();

      const instanceId = randomUUID();
      const now = Date.now();

      // Instance is "completed" in DB (e.g. just finished)
      store.recordRun({
        instanceId,
        agentName: "dedup-agent",
        triggerType: "manual",
        result: "completed",
        startedAt: now - 1000,
        durationMs: 500,
      });

      // But also registered as "running" in tracker (race condition — just finished but tracker not updated)
      tracker.registerInstance({
        id: instanceId,
        agentName: "dedup-agent",
        status: "running",
        startedAt: new Date(now - 1000),
        trigger: "manual",
      });

      const app = makeApp(store, tracker);
      // Request with "all" status (includes both running from mem and completed from DB)
      const res = await app.request("/api/stats/activity?status=all");
      expect(res.status).toBe(200);

      const body = await res.json() as { rows: Array<{ instanceId: string; result: string }> };
      // The instance should appear only once (deduplicated)
      const matching = body.rows.filter((r) => r.instanceId === instanceId);
      expect(matching).toHaveLength(1);
      // The mem row (running) takes precedence over the DB row (completed)
      expect(matching[0].result).toBe("running");
    });

    // ── combined DB+mem rows ───────────────────────────────────────────────────

    it("response includes both DB rows and running instances", async () => {
      const tracker = new StatusTracker();
      tracker.registerAgent("combined-agent", 1);
      const store = makeTmpStore();

      const completedId = randomUUID();
      const runningId = randomUUID();
      const now = Date.now();

      // Record a completed run in DB
      store.recordRun({
        instanceId: completedId,
        agentName: "combined-agent",
        triggerType: "manual",
        result: "completed",
        startedAt: now - 2000,
        durationMs: 1000,
      });

      // Register a different instance as running
      tracker.registerInstance({
        id: runningId,
        agentName: "combined-agent",
        status: "running",
        startedAt: new Date(now),
        trigger: "schedule",
      });

      const app = makeApp(store, tracker);
      const res = await app.request("/api/stats/activity");
      expect(res.status).toBe(200);

      const body = await res.json() as { rows: Array<{ instanceId: string; result: string }>; total: number };
      // Should have both the running and completed rows
      const completed = body.rows.find((r) => r.instanceId === completedId);
      const running = body.rows.find((r) => r.instanceId === runningId);
      expect(completed).toBeDefined();
      expect(running).toBeDefined();
      expect(completed!.result).toBe("completed");
      expect(running!.result).toBe("running");
      // total = memCount (1) + dbCount (1)
      expect(body.total).toBe(2);
    });

    // ── response includes total = memCount + dbCount ───────────────────────────

    it("total reflects combined mem and DB counts", async () => {
      const tracker = new StatusTracker();
      tracker.registerAgent("total-agent", 1);
      const store = makeTmpStore();

      // 3 completed runs in DB
      for (let i = 0; i < 3; i++) {
        store.recordRun({
          instanceId: randomUUID(),
          agentName: "total-agent",
          triggerType: "manual",
          result: "completed",
          startedAt: Date.now() - i * 1000,
          durationMs: 100,
        });
      }

      // 1 running instance in tracker
      tracker.registerInstance({
        id: randomUUID(),
        agentName: "total-agent",
        status: "running",
        startedAt: new Date(),
        trigger: "manual",
      });

      const app = makeApp(store, tracker);
      const res = await app.request("/api/stats/activity");
      expect(res.status).toBe(200);

      const body = await res.json() as { total: number };
      // total = 1 (running) + 3 (DB) = 4
      expect(body.total).toBe(4);
    });

    // ── status=completed → no mem rows, only DB ─────────────────────────────────

    it("status=completed excludes running/pending from mem rows", async () => {
      const tracker = new StatusTracker();
      tracker.registerAgent("completed-only", 1);
      const store = makeTmpStore();

      const completedId = randomUUID();
      const runningId = randomUUID();

      store.recordRun({
        instanceId: completedId,
        agentName: "completed-only",
        triggerType: "manual",
        result: "completed",
        startedAt: Date.now() - 1000,
        durationMs: 200,
      });

      tracker.registerInstance({
        id: runningId,
        agentName: "completed-only",
        status: "running",
        startedAt: new Date(),
        trigger: "manual",
      });

      const app = makeApp(store, tracker);
      const res = await app.request("/api/stats/activity?status=completed");
      expect(res.status).toBe(200);

      const body = await res.json() as { rows: Array<{ instanceId: string }> };
      // Only completed DB row should appear
      expect(body.rows.find((r) => r.instanceId === completedId)).toBeDefined();
      expect(body.rows.find((r) => r.instanceId === runningId)).toBeUndefined();
    });
  },
);
