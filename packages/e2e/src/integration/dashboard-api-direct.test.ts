/**
 * Integration tests: control/routes/dashboard-api.ts registerDashboardApiRoutes() — no Docker required.
 *
 * Tests specific branches in registerDashboardApiRoutes() by constructing a
 * Hono app directly with a StatusTracker, exercising paths that are hard to
 * reach through the gateway harness:
 *
 *   1. GET /api/dashboard/agents/:name/skill — no projectPath → 404 { body: "" }
 *   2. GET /api/dashboard/agents/:name — no statsStore → null summary, 0 totalHistorical
 *   3. GET /api/dashboard/agents/:name/instances/:id — no statsStore → run=null
 *   4. GET /api/dashboard/triggers/:instanceId — running instance in tracker → 200
 *      (toRunningTriggerDetail() path — trigger type/source split on ":" separator)
 *   5. GET /api/dashboard/triggers/:instanceId — instance with "manual" trigger → triggerType=manual
 *   6. GET /api/dashboard/triggers/:instanceId — instance with "webhook:test" trigger → type+source split
 *   7. GET /api/dashboard/status — agents/schedulerInfo/recentLogs returned
 *   8. GET /api/dashboard/config — without projectPath → default projectScale
 *
 * Covers:
 *   - control/routes/dashboard-api.ts: GET /api/dashboard/agents/:name/skill no projectPath → 404
 *   - control/routes/dashboard-api.ts: GET /api/dashboard/agents/:name without statsStore → null summary
 *   - control/routes/dashboard-api.ts: GET /api/dashboard/agents/:name/instances/:id without statsStore
 *   - control/routes/dashboard-api.ts: GET /api/dashboard/triggers/:instanceId running instance → 200
 *   - control/routes/dashboard-api.ts: toRunningTriggerDetail() trigger type+source split on ":"
 *   - control/routes/dashboard-api.ts: toRunningTriggerDetail() plain trigger (no ":")
 *   - control/routes/dashboard-api.ts: GET /api/dashboard/status basic response shape
 *   - control/routes/dashboard-api.ts: GET /api/dashboard/config without projectPath
 */

import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

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
  StatusTracker,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/tui/status-tracker.js"
);

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
}

/** Create a minimal StatusTracker with one registered agent. */
function makeTracker(agentName = "test-agent"): InstanceType<typeof StatusTracker> {
  const tracker = new StatusTracker();
  tracker.registerAgent(agentName, 1);
  return tracker;
}

/** Create a Hono app with dashboard API routes. */
function makeApp(
  tracker: InstanceType<typeof StatusTracker>,
  projectPath?: string,
  statsStore?: any,
) {
  const app = new Hono();
  registerDashboardApiRoutes(app, tracker, projectPath, statsStore);
  return app;
}

describe("integration: control/routes/dashboard-api.ts direct tests (no Docker required)", { timeout: 20_000 }, () => {

  // ── GET /api/dashboard/agents/:name/skill — no projectPath ────────────────

  it("GET /api/dashboard/agents/:name/skill returns 404 when projectPath is not set", async () => {
    const tracker = makeTracker("skill-agent");
    const app = makeApp(tracker, undefined, undefined);  // no projectPath

    const res = await app.request("/api/dashboard/agents/skill-agent/skill");
    expect(res.status).toBe(404);
    const body = await res.json() as { body: string };
    expect(body.body).toBe("");
  });

  // ── GET /api/dashboard/agents/:name — without statsStore ─────────────────

  it("GET /api/dashboard/agents/:name returns null summary and 0 totalHistorical without statsStore", async () => {
    const tracker = makeTracker("my-agent");
    const app = makeApp(tracker, undefined, undefined);  // no statsStore

    const res = await app.request("/api/dashboard/agents/my-agent");
    expect(res.status).toBe(200);
    const body = await res.json() as {
      agent: unknown;
      summary: unknown;
      totalHistorical: number;
      runningInstances: unknown[];
    };
    // statsStore is absent → summary should be null
    expect(body.summary).toBeNull();
    // totalHistorical should be 0
    expect(body.totalHistorical).toBe(0);
    // runningInstances should be empty (no Docker)
    expect(Array.isArray(body.runningInstances)).toBe(true);
  });

  // ── GET /api/dashboard/agents/:name/instances/:id — without statsStore ───

  it("GET /api/dashboard/agents/:name/instances/:id returns run:null without statsStore", async () => {
    const tracker = makeTracker("instance-agent");
    const app = makeApp(tracker, undefined, undefined);  // no statsStore

    const instanceId = randomUUID();
    const res = await app.request(
      `/api/dashboard/agents/instance-agent/instances/${instanceId}`,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { run: unknown; runningInstance: unknown };
    expect(body.run).toBeNull();
    expect(body.runningInstance).toBeNull();
  });

  // ── GET /api/dashboard/triggers/:instanceId — running instance path ───────

  it("returns 200 with trigger detail when instance is running in StatusTracker", async () => {
    const tracker = makeTracker("trigger-agent");
    const app = makeApp(tracker, undefined, undefined);

    // Register a running instance directly in the tracker
    const instanceId = randomUUID();
    tracker.registerInstance({
      id: instanceId,
      agentName: "trigger-agent",
      status: "running",
      startedAt: new Date(),
      trigger: "manual",
    });

    const res = await app.request(`/api/dashboard/triggers/${instanceId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { trigger: { instanceId: string; triggerType: string; triggerSource: null } };
    expect(body.trigger).toBeDefined();
    expect(body.trigger.instanceId).toBe(instanceId);
    expect(body.trigger.triggerType).toBe("manual");
    expect(body.trigger.triggerSource).toBeNull();
    expect(body.trigger.triggerContext).toBeNull();
  });

  it("splits 'webhook:test-source' trigger into type='webhook' and source='test-source'", async () => {
    const tracker = makeTracker("webhook-trigger-agent");
    const app = makeApp(tracker, undefined, undefined);

    const instanceId = randomUUID();
    // Register with "webhook:test-source" trigger string
    tracker.registerInstance({
      id: instanceId,
      agentName: "webhook-trigger-agent",
      status: "running",
      startedAt: new Date(),
      trigger: "webhook:test-source",
    });

    const res = await app.request(`/api/dashboard/triggers/${instanceId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { trigger: { triggerType: string; triggerSource: string | null } };
    expect(body.trigger.triggerType).toBe("webhook");
    expect(body.trigger.triggerSource).toBe("test-source");
  });

  it("uses plain trigger as triggerType when no ':' separator present", async () => {
    const tracker = makeTracker("plain-trigger-agent");
    const app = makeApp(tracker, undefined, undefined);

    const instanceId = randomUUID();
    tracker.registerInstance({
      id: instanceId,
      agentName: "plain-trigger-agent",
      status: "running",
      startedAt: new Date(),
      trigger: "schedule",
    });

    const res = await app.request(`/api/dashboard/triggers/${instanceId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { trigger: { triggerType: string; triggerSource: string | null } };
    expect(body.trigger.triggerType).toBe("schedule");
    expect(body.trigger.triggerSource).toBeNull();
  });

  // ── GET /api/dashboard/status — basic response shape ─────────────────────

  it("GET /api/dashboard/status returns agents, schedulerInfo, and recentLogs", async () => {
    const tracker = makeTracker("status-agent");
    const app = makeApp(tracker, undefined, undefined);

    const res = await app.request("/api/dashboard/status");
    expect(res.status).toBe(200);
    const body = await res.json() as {
      agents: unknown[];
      schedulerInfo: unknown;
      recentLogs: unknown[];
    };
    expect(Array.isArray(body.agents)).toBe(true);
    expect(Array.isArray(body.recentLogs)).toBe(true);
    expect("schedulerInfo" in body).toBe(true);
  });

  // ── GET /api/dashboard/config — without projectPath ───────────────────────

  it("GET /api/dashboard/config returns defaults when projectPath is absent", async () => {
    const tracker = makeTracker("config-agent");
    const app = makeApp(tracker, undefined, undefined);  // no projectPath

    const res = await app.request("/api/dashboard/config");
    expect(res.status).toBe(200);
    const body = await res.json() as {
      projectName: unknown;
      projectScale: number;
      gatewayPort: unknown;
      webhooksActive: boolean;
    };
    // Without projectPath, getProjectScale() is not called → default value used
    expect(typeof body.projectScale).toBe("number");
    expect(body.webhooksActive).toBe(false);
    expect(body.gatewayPort).toBeUndefined();
  });

  // ── GET /api/dashboard/agents/:name/skill — with projectPath and existing file ──

  it("GET /api/dashboard/agents/:name/skill returns body from SKILL.md when projectPath is set", async () => {
    // Create a temp project with a real SKILL.md
    const projectPath = mkdtempSync(join(tmpdir(), "al-dash-api-test-"));
    const agentDir = join(projectPath, "agents", "skill-test-agent");
    mkdirSync(agentDir, { recursive: true });

    const skillContent = `---
name: skill-test-agent
description: "My test agent"
---

# skill-test-agent

This is the agent body.
`;
    writeFileSync(join(agentDir, "SKILL.md"), skillContent);

    const tracker = makeTracker("skill-test-agent");
    const app = makeApp(tracker, projectPath, undefined);

    const res = await app.request("/api/dashboard/agents/skill-test-agent/skill");
    expect(res.status).toBe(200);
    const body = await res.json() as { body: string; agentConfig: unknown };
    expect(body.body).toContain("This is the agent body");
    // agentConfig may be null if no config.toml (no matching model), that's OK
    expect("agentConfig" in body).toBe(true);
  });
});
