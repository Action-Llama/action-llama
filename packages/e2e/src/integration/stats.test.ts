/**
 * Integration test: verify that the stats API correctly records and returns
 * agent run history.
 *
 * After agents run, their results should be queryable via:
 *   GET /api/stats/agents/:name/runs   — paginated run history
 *   GET /api/stats/triggers            — unified trigger history
 *
 * These routes are protected by the gateway API key.
 *
 * Covers: stats store and stats API routes (not previously tested by
 * integration tests).
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: stats API", { timeout: 180_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  /**
   * Helper to fetch a stats API endpoint with the harness API key.
   */
  async function statsAPI(harness: IntegrationHarness, path: string): Promise<Response> {
    return fetch(`http://127.0.0.1:${harness.gatewayPort}${path}`, {
      headers: {
        Authorization: `Bearer ${harness.apiKey}`,
      },
    });
  }

  it("stats API records completed runs and returns correct count", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "stats-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\necho 'stats-agent ran'\nexit 0\n",
        },
      ],
    });

    await harness.start();

    // Run the agent twice
    await harness.triggerAgent("stats-agent");
    await harness.waitForRunResult("stats-agent");

    await harness.triggerAgent("stats-agent");
    await harness.waitForRunResult("stats-agent");

    // Query the stats API for this agent's runs
    const res = await statsAPI(harness, "/api/stats/agents/stats-agent/runs");
    expect(res.ok).toBe(true);

    const body = await res.json();
    expect(body.total).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(body.runs)).toBe(true);
    expect(body.runs.length).toBeGreaterThanOrEqual(1);

    // Verify run entries have expected fields
    const run = body.runs[0];
    expect(run).toHaveProperty("agentName");
    expect(run.agentName).toBe("stats-agent");
  });

  it("stats API trigger history includes all agent runs", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "trigger-stats-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\necho 'trigger-stats-agent ran'\nexit 0\n",
        },
      ],
    });

    await harness.start();

    // Run the agent
    await harness.triggerAgent("trigger-stats-agent");
    await harness.waitForRunResult("trigger-stats-agent");

    // Query the trigger history
    const res = await statsAPI(harness, "/api/stats/triggers?agent=trigger-stats-agent");
    expect(res.ok).toBe(true);

    const body = await res.json();
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(body.triggers)).toBe(true);

    // Verify trigger entries have expected fields
    const trigger = body.triggers[0];
    expect(trigger).toHaveProperty("agentName");
    expect(trigger.agentName).toBe("trigger-stats-agent");
    expect(trigger).toHaveProperty("triggerType");
    // Manual trigger should show as "manual"
    expect(trigger.triggerType).toBe("manual");
  });

  it("stats API returns empty result for unknown agent", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "any-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    await harness.start();

    const res = await statsAPI(harness, "/api/stats/agents/nonexistent-agent/runs");
    expect(res.ok).toBe(true);

    const body = await res.json();
    expect(body.total).toBe(0);
    expect(body.runs).toHaveLength(0);
  });

  it("stats API tracks error runs separately from completed runs", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "error-stats-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\necho 'intentional failure'\nexit 1\n",
        },
      ],
    });

    await harness.start();

    await harness.triggerAgent("error-stats-agent");
    const run = await harness.waitForRunResult("error-stats-agent");
    expect(run.result).toBe("error");

    // Stats should show the failed run
    const res = await statsAPI(harness, "/api/stats/agents/error-stats-agent/runs");
    expect(res.ok).toBe(true);

    const body = await res.json();
    expect(body.total).toBeGreaterThanOrEqual(1);

    // The run should have a non-success result
    const runRecord = body.runs[0];
    expect(runRecord.agentName).toBe("error-stats-agent");
    // result should be "error" or similar non-success value
    expect(runRecord.result).not.toBe("completed");
  });
});
