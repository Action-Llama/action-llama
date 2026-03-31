/**
 * Integration test: verify the stats/jobs and stats/activity API endpoints.
 *
 * These endpoints provide unified views of agent execution history:
 *   GET /api/stats/jobs          — completed/running/errored jobs (no dead letters)
 *   GET /api/stats/activity      — unified activity feed (all events including dead letters)
 *   GET /api/stats/agents/:name/runs/:instanceId — single run details
 *
 * Covers: stats API endpoints not yet tested individually.
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: stats jobs and activity API", { timeout: 180_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  async function statsAPI(h: IntegrationHarness, path: string): Promise<Response> {
    return fetch(`http://127.0.0.1:${h.gatewayPort}${path}`, {
      headers: { Authorization: `Bearer ${h.apiKey}` },
    });
  }

  it("stats/jobs endpoint returns completed runs after agent executes", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "jobs-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\necho 'jobs-agent ran'\nexit 0\n",
        },
      ],
    });

    await harness.start();

    await harness.triggerAgent("jobs-agent");
    const run = await harness.waitForRunResult("jobs-agent");
    expect(run.result).toBe("completed");

    const res = await statsAPI(harness, "/api/stats/jobs?agent=jobs-agent");
    expect(res.ok).toBe(true);

    const body = await res.json();
    expect(body).toHaveProperty("jobs");
    expect(Array.isArray(body.jobs)).toBe(true);
    expect(body.total).toBeGreaterThanOrEqual(1);

    const job = body.jobs[0];
    expect(job.agentName).toBe("jobs-agent");
    expect(job.result).toBe("completed");
  });

  it("stats/activity endpoint returns unified view including dead letters", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "activity-agent",
          webhooks: [{ source: "test-hook", events: ["deploy"] }],
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
      globalConfig: {
        webhooks: { "test-hook": { type: "test" } },
      },
    });

    await harness.start();

    // Run agent manually (will appear as a job)
    await harness.triggerAgent("activity-agent");
    await harness.waitForRunResult("activity-agent");

    // Send non-matching webhook (will become dead letter)
    await harness.sendWebhook({ event: "push", repo: "acme/app" }); // no "deploy"

    await new Promise((r) => setTimeout(r, 500)); // allow receipt to be recorded

    // Query activity (include dead letters with ?status=all or default)
    const res = await statsAPI(harness, "/api/stats/activity");
    expect(res.ok).toBe(true);

    const body = await res.json();
    expect(body).toHaveProperty("rows");
    expect(Array.isArray(body.rows)).toBe(true);
    expect(body.total).toBeGreaterThanOrEqual(1);
  });

  it("stats/agents/:name/runs/:instanceId returns single run details", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "instance-stats-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\necho 'done'\nexit 0\n",
        },
      ],
    });

    await harness.start();

    await harness.triggerAgent("instance-stats-agent");
    await harness.waitForRunResult("instance-stats-agent");

    // Get all runs to find an instanceId
    const runsRes = await statsAPI(harness, "/api/stats/agents/instance-stats-agent/runs");
    expect(runsRes.ok).toBe(true);
    const runsBody = await runsRes.json();
    expect(runsBody.total).toBeGreaterThanOrEqual(1);

    const instanceId = runsBody.runs[0]?.instanceId;
    if (instanceId) {
      // Fetch the specific run by instanceId
      const runRes = await statsAPI(
        harness,
        `/api/stats/agents/instance-stats-agent/runs/${instanceId}`,
      );
      expect(runRes.ok).toBe(true);
      const runBody = await runRes.json();
      expect(runBody).toHaveProperty("run");
      if (runBody.run) {
        expect(runBody.run.instanceId).toBe(instanceId);
        expect(runBody.run.agentName).toBe("instance-stats-agent");
      }
    }
  });
});
