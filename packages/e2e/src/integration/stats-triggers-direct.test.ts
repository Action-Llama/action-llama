/**
 * Integration tests: control/routes/stats.ts GET /api/stats/triggers running instance merge — no Docker required.
 *
 * The /api/stats/triggers endpoint merges running instances from StatusTracker
 * into the DB results when offset=0 (similar to stats/jobs). The existing tests
 * only test this path with empty instances (no Docker = no running containers).
 * This test exercises the merge with actual running instances.
 *
 * Covers:
 *   - control/routes/stats.ts: GET /api/stats/triggers — running instances merged on offset=0
 *   - control/routes/stats.ts: GET /api/stats/triggers — triggerTypeFilter applied to running instances
 *   - control/routes/stats.ts: GET /api/stats/triggers — agentFilter applied to running instances
 *   - control/routes/stats.ts: GET /api/stats/triggers — offset>0 skips running instance merge
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
  const dir = mkdtempSync(join(tmpdir(), "al-stats-trig-direct-"));
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
  "integration: GET /api/stats/triggers running instance merge — no Docker required",
  { timeout: 20_000 },
  () => {
    it("running instances merged into triggers list when offset=0", async () => {
      const tracker = new StatusTracker();
      tracker.registerAgent("trig-agent", 1);
      const store = makeTmpStore();

      const instanceId = randomUUID();
      tracker.registerInstance({
        id: instanceId,
        agentName: "trig-agent",
        status: "running",
        startedAt: new Date(),
        trigger: "manual",
      });

      const app = makeApp(store, tracker);
      const res = await app.request("/api/stats/triggers");
      expect(res.status).toBe(200);

      const body = await res.json() as { triggers: Array<{ instanceId: string; result: string }> };
      const row = body.triggers.find((t) => t.instanceId === instanceId);
      expect(row).toBeDefined();
      expect(row!.result).toBe("running");
    });

    it("triggerTypeFilter filters running instances by trigger type", async () => {
      const tracker = new StatusTracker();
      tracker.registerAgent("trig-filter-agent", 1);
      const store = makeTmpStore();

      const manualId = randomUUID();
      const scheduleId = randomUUID();

      tracker.registerInstance({
        id: manualId,
        agentName: "trig-filter-agent",
        status: "running",
        startedAt: new Date(),
        trigger: "manual",
      });
      tracker.registerInstance({
        id: scheduleId,
        agentName: "trig-filter-agent",
        status: "running",
        startedAt: new Date(),
        trigger: "schedule",
      });

      const app = makeApp(store, tracker);
      const res = await app.request("/api/stats/triggers?triggerType=manual");
      expect(res.status).toBe(200);

      const body = await res.json() as { triggers: Array<{ instanceId: string }> };
      expect(body.triggers.find((t) => t.instanceId === manualId)).toBeDefined();
      expect(body.triggers.find((t) => t.instanceId === scheduleId)).toBeUndefined();
    });

    it("agentFilter applied to running instances in triggers", async () => {
      const tracker = new StatusTracker();
      tracker.registerAgent("agent-alpha", 1);
      tracker.registerAgent("agent-beta", 1);
      const store = makeTmpStore();

      const alphaId = randomUUID();
      const betaId = randomUUID();

      tracker.registerInstance({ id: alphaId, agentName: "agent-alpha", status: "running", startedAt: new Date(), trigger: "manual" });
      tracker.registerInstance({ id: betaId, agentName: "agent-beta", status: "running", startedAt: new Date(), trigger: "manual" });

      const app = makeApp(store, tracker);
      const res = await app.request("/api/stats/triggers?agent=agent-alpha");
      expect(res.status).toBe(200);

      const body = await res.json() as { triggers: Array<{ instanceId: string }> };
      expect(body.triggers.find((t) => t.instanceId === alphaId)).toBeDefined();
      expect(body.triggers.find((t) => t.instanceId === betaId)).toBeUndefined();
    });

    it("offset>0 skips running instance merge in triggers", async () => {
      const tracker = new StatusTracker();
      tracker.registerAgent("offset-trig-agent", 1);
      const store = makeTmpStore();

      const instanceId = randomUUID();
      tracker.registerInstance({
        id: instanceId,
        agentName: "offset-trig-agent",
        status: "running",
        startedAt: new Date(),
        trigger: "manual",
      });

      const app = makeApp(store, tracker);
      const res = await app.request("/api/stats/triggers?offset=50");
      expect(res.status).toBe(200);

      const body = await res.json() as { triggers: Array<{ instanceId: string }> };
      expect(body.triggers.find((t) => t.instanceId === instanceId)).toBeUndefined();
    });
  },
);
