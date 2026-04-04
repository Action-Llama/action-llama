/**
 * Integration tests: control/routes/stats.ts GET /api/stats/jobs — no Docker required.
 *
 * The jobs endpoint has several paths that aren't tested by the empty-store or
 * Docker-based tests:
 *
 *   1. Running instances merged on first page (offset=0 + statusTracker provided)
 *   2. Running instance deduplication (already-in-DB run not duplicated)
 *   3. Agent filter applies to running instances as well as DB runs
 *   4. offset > 0 → running instances NOT merged (only DB runs returned)
 *   5. Pending counts from statusTracker (queuedWebhooks > 0)
 *   6. Pending filtered by agentFilter
 *   7. With both statsStore and statusTracker → combined response
 *
 * Covers:
 *   - control/routes/stats.ts: GET /api/stats/jobs — running instances merged on offset=0
 *   - control/routes/stats.ts: GET /api/stats/jobs — running instance deduplication
 *   - control/routes/stats.ts: GET /api/stats/jobs — agentFilter applies to running instances
 *   - control/routes/stats.ts: GET /api/stats/jobs — offset>0 skips running instance merge
 *   - control/routes/stats.ts: GET /api/stats/jobs — pending counts from queuedWebhooks
 *   - control/routes/stats.ts: GET /api/stats/jobs — pending filtered by agentFilter
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpStore(): InstanceType<typeof StatsStore> {
  const dir = mkdtempSync(join(tmpdir(), "al-stats-jobs-direct-"));
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe(
  "integration: GET /api/stats/jobs direct tests — no Docker required",
  { timeout: 20_000 },
  () => {
    // ── running instances merged on first page ────────────────────────────────

    it("running instances included in jobs list when offset=0 and statusTracker provided", async () => {
      const tracker = new StatusTracker();
      tracker.registerAgent("my-agent", 1);

      const instanceId = randomUUID();
      const now = Date.now();

      tracker.registerInstance({
        id: instanceId,
        agentName: "my-agent",
        status: "running",
        startedAt: new Date(now),
        trigger: "manual",
      });

      const app = makeApp(undefined, tracker);
      const res = await app.request("/api/stats/jobs");
      expect(res.status).toBe(200);

      const body = await res.json() as {
        jobs: Array<{ instanceId: string; result: string; agentName: string }>;
        total: number;
      };
      // Running instance should appear in jobs list
      const runningJob = body.jobs.find((j) => j.instanceId === instanceId);
      expect(runningJob).toBeDefined();
      expect(runningJob!.result).toBe("running");
      expect(runningJob!.agentName).toBe("my-agent");
    });

    // ── running instance deduplication ────────────────────────────────────────

    it("running instance not duplicated when already present in statsStore", async () => {
      const tracker = new StatusTracker();
      tracker.registerAgent("dup-agent", 1);
      const store = makeTmpStore();

      const instanceId = randomUUID();
      const now = Date.now();

      // Register the same instance both in the DB and as running in tracker
      store.recordRun({
        instanceId,
        agentName: "dup-agent",
        triggerType: "manual",
        result: "running",
        startedAt: now,
        durationMs: 0,
      });

      tracker.registerInstance({
        id: instanceId,
        agentName: "dup-agent",
        status: "running",
        startedAt: new Date(now),
        trigger: "manual",
      });

      const app = makeApp(store, tracker);
      const res = await app.request("/api/stats/jobs");
      expect(res.status).toBe(200);

      const body = await res.json() as { jobs: Array<{ instanceId: string }> };
      // The instance should appear only once (deduplication)
      const matching = body.jobs.filter((j) => j.instanceId === instanceId);
      expect(matching).toHaveLength(1);
    });

    // ── agentFilter applies to running instances ──────────────────────────────

    it("?agent filter excludes running instances for other agents", async () => {
      const tracker = new StatusTracker();
      tracker.registerAgent("agent-a", 1);
      tracker.registerAgent("agent-b", 1);

      const instA = randomUUID();
      const instB = randomUUID();

      tracker.registerInstance({
        id: instA,
        agentName: "agent-a",
        status: "running",
        startedAt: new Date(),
        trigger: "manual",
      });
      tracker.registerInstance({
        id: instB,
        agentName: "agent-b",
        status: "running",
        startedAt: new Date(),
        trigger: "schedule",
      });

      const app = makeApp(undefined, tracker);
      // Filter for agent-a only
      const res = await app.request("/api/stats/jobs?agent=agent-a");
      expect(res.status).toBe(200);

      const body = await res.json() as { jobs: Array<{ instanceId: string; agentName: string }> };
      // Only agent-a instance should be in the jobs list
      expect(body.jobs.every((j) => j.agentName === "agent-a")).toBe(true);
      // agent-b instance should NOT be present
      expect(body.jobs.find((j) => j.instanceId === instB)).toBeUndefined();
    });

    // ── offset > 0 skips running instance merge ───────────────────────────────

    it("running instances NOT merged when offset > 0", async () => {
      const tracker = new StatusTracker();
      tracker.registerAgent("offset-agent", 1);

      const instanceId = randomUUID();
      tracker.registerInstance({
        id: instanceId,
        agentName: "offset-agent",
        status: "running",
        startedAt: new Date(),
        trigger: "manual",
      });

      const app = makeApp(undefined, tracker);
      // Paginate to page 2 (offset=50) — running instances should not appear
      const res = await app.request("/api/stats/jobs?offset=50");
      expect(res.status).toBe(200);

      const body = await res.json() as { jobs: Array<{ instanceId: string }> };
      // Running instance should NOT be in the list for page 2
      expect(body.jobs.find((j) => j.instanceId === instanceId)).toBeUndefined();
    });

    // ── pending counts from statusTracker ─────────────────────────────────────

    it("pending counts reflect queuedWebhooks from statusTracker agents", async () => {
      const tracker = new StatusTracker();
      tracker.registerAgent("queued-agent", 1);

      // Set queued webhooks for the agent
      tracker.setQueuedWebhooks("queued-agent", 3);

      const app = makeApp(undefined, tracker);
      const res = await app.request("/api/stats/jobs");
      expect(res.status).toBe(200);

      const body = await res.json() as {
        pending: Record<string, number>;
        totalPending: number;
      };
      expect(body.pending["queued-agent"]).toBe(3);
      expect(body.totalPending).toBe(3);
    });

    // ── pending filtered by agentFilter ──────────────────────────────────────

    it("pending counts filtered by ?agent parameter", async () => {
      const tracker = new StatusTracker();
      tracker.registerAgent("pend-a", 1);
      tracker.registerAgent("pend-b", 1);

      tracker.setQueuedWebhooks("pend-a", 2);
      tracker.setQueuedWebhooks("pend-b", 5);

      const app = makeApp(undefined, tracker);
      const res = await app.request("/api/stats/jobs?agent=pend-a");
      expect(res.status).toBe(200);

      const body = await res.json() as { pending: Record<string, number>; totalPending: number };
      // Only pend-a should be in pending
      expect(body.pending["pend-a"]).toBe(2);
      expect(body.pending["pend-b"]).toBeUndefined();
      expect(body.totalPending).toBe(2);
    });

    // ── trigger type/source split from running instance trigger string ──────────

    it("running instance trigger 'webhook:github' splits into triggerType and triggerSource", async () => {
      const tracker = new StatusTracker();
      tracker.registerAgent("wh-agent", 1);

      const instanceId = randomUUID();
      tracker.registerInstance({
        id: instanceId,
        agentName: "wh-agent",
        status: "running",
        startedAt: new Date(),
        trigger: "webhook:github",
      });

      const app = makeApp(undefined, tracker);
      const res = await app.request("/api/stats/jobs");
      expect(res.status).toBe(200);

      const body = await res.json() as {
        jobs: Array<{ instanceId: string; triggerType: string; triggerSource: string | null }>;
      };
      const job = body.jobs.find((j) => j.instanceId === instanceId);
      expect(job).toBeDefined();
      expect(job!.triggerType).toBe("webhook");
      expect(job!.triggerSource).toBe("github");
    });

    // ── response shape includes all expected fields ────────────────────────────

    it("response always includes jobs, total, pending, totalPending, limit, offset", async () => {
      const app = makeApp(undefined, undefined);
      const res = await app.request("/api/stats/jobs");
      expect(res.status).toBe(200);

      const body = await res.json() as Record<string, unknown>;
      expect(body).toHaveProperty("jobs");
      expect(body).toHaveProperty("total");
      expect(body).toHaveProperty("pending");
      expect(body).toHaveProperty("totalPending");
      expect(body).toHaveProperty("limit");
      expect(body).toHaveProperty("offset");
    });
  },
);
