/**
 * Integration test: verify the dashboard instance detail API endpoints.
 *
 * These endpoints are used by the React dashboard SPA to show details
 * for a specific agent run instance:
 *   GET /api/dashboard/agents/:name/instances/:id — run detail + trigger context
 *   GET /api/dashboard/triggers/:instanceId       — trigger detail with source info
 *
 * Covers: control/routes/dashboard-api.ts
 *   - GET /api/dashboard/agents/:name/instances/:id
 *   - GET /api/dashboard/triggers/:instanceId (manual trigger path)
 *   - GET /api/dashboard/triggers/:instanceId 404 for unknown instanceId
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: dashboard instance detail API", { timeout: 180_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  /** Fetch a gateway endpoint with Bearer auth. */
  function gatewayFetch(h: IntegrationHarness, path: string): Promise<Response> {
    return fetch(`http://127.0.0.1:${h.gatewayPort}${path}`, {
      headers: { Authorization: `Bearer ${h.apiKey}` },
    });
  }

  /**
   * Extract instanceId from a run object returned by the stats API.
   * Handles both camelCase (instanceId) and snake_case (instance_id) field names.
   */
  function extractInstanceId(run: Record<string, unknown>): string | undefined {
    return (run.instanceId ?? run.instance_id) as string | undefined;
  }

  it("GET /api/dashboard/agents/:name/instances/:id returns run details for a completed instance", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "instance-detail-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\necho 'instance-detail-agent ran'\nexit 0\n",
        },
      ],
    });

    await harness.start();

    // Trigger the agent and wait for it to complete
    await harness.triggerAgent("instance-detail-agent");
    await harness.waitForRunResult("instance-detail-agent");

    // Get all runs to find an instanceId
    const runsRes = await gatewayFetch(
      harness,
      "/api/stats/agents/instance-detail-agent/runs",
    );
    expect(runsRes.ok).toBe(true);
    const runsBody = (await runsRes.json()) as { runs: Array<Record<string, unknown>>; total: number };
    expect(runsBody.total).toBeGreaterThanOrEqual(1);

    const instanceId = extractInstanceId(runsBody.runs[0]!);
    expect(instanceId).toBeDefined();
    if (!instanceId) return;

    // Fetch the instance detail from the dashboard endpoint
    const detailRes = await gatewayFetch(
      harness,
      `/api/dashboard/agents/instance-detail-agent/instances/${instanceId}`,
    );
    expect(detailRes.ok).toBe(true);
    const detailBody = (await detailRes.json()) as {
      run: Record<string, unknown> | null;
      runningInstance: unknown;
      parentEdge: unknown;
      webhookReceipt: unknown;
    };

    // run field should contain the completed run
    expect(detailBody.run).not.toBeNull();

    // Verify core fields exist (handles both camelCase and snake_case)
    if (detailBody.run) {
      const runInstanceId = extractInstanceId(detailBody.run);
      expect(runInstanceId).toBe(instanceId);

      // result should be "completed"
      expect(detailBody.run.result).toBe("completed");
    }

    // runningInstance should be null for a completed run (no longer in status tracker)
    expect(detailBody.runningInstance).toBeNull();

    // No parent edge for a manually triggered run
    expect(detailBody.parentEdge).toBeUndefined();
    // No webhook receipt for a manually triggered run
    expect(detailBody.webhookReceipt).toBeUndefined();
  });

  it("GET /api/dashboard/triggers/:instanceId returns trigger details for a manual run", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "trigger-detail-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\necho 'trigger-detail-agent ran'\nexit 0\n",
        },
      ],
    });

    await harness.start();

    // Trigger the agent manually and wait for it to complete
    await harness.triggerAgent("trigger-detail-agent");
    await harness.waitForRunResult("trigger-detail-agent");

    // Get runs to find the instanceId
    const runsRes = await gatewayFetch(
      harness,
      "/api/stats/agents/trigger-detail-agent/runs",
    );
    expect(runsRes.ok).toBe(true);
    const runsBody = (await runsRes.json()) as { runs: Array<Record<string, unknown>>; total: number };
    expect(runsBody.total).toBeGreaterThanOrEqual(1);

    const instanceId = extractInstanceId(runsBody.runs[0]!);
    expect(instanceId).toBeDefined();
    if (!instanceId) return;

    // Fetch trigger details from the dashboard endpoint
    const triggerRes = await gatewayFetch(
      harness,
      `/api/dashboard/triggers/${instanceId}`,
    );
    expect(triggerRes.ok).toBe(true);
    const triggerBody = (await triggerRes.json()) as {
      trigger: {
        instanceId: string;
        agentName: string;
        triggerType: string;
        triggerSource: string | null;
        startedAt: number;
      } | null;
    };

    expect(triggerBody.trigger).not.toBeNull();
    if (triggerBody.trigger) {
      // triggerType should be "manual" for a manually triggered run
      expect(triggerBody.trigger.triggerType).toBe("manual");
      expect(typeof triggerBody.trigger.startedAt).toBe("number");
      expect(triggerBody.trigger.agentName).toBe("trigger-detail-agent");
    }
  });

  it("GET /api/dashboard/triggers/:instanceId returns 404 for unknown instanceId", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "trigger-404-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    await harness.start();

    const res = await gatewayFetch(
      harness,
      "/api/dashboard/triggers/nonexistent-instance-id-xyz",
    );
    // Should return 404 with trigger: null
    expect(res.status).toBe(404);
    const body = (await res.json()) as { trigger: null };
    expect(body.trigger).toBeNull();
  });

  it("GET /api/dashboard/agents/:name/instances/:id returns null run for unknown instanceId", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "instance-null-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    await harness.start();

    // Fetch with a nonexistent instanceId — should return run: null
    const detailRes = await gatewayFetch(
      harness,
      "/api/dashboard/agents/instance-null-agent/instances/nonexistent-xyz",
    );
    expect(detailRes.ok).toBe(true);
    const body = (await detailRes.json()) as {
      run: null;
      runningInstance: null;
    };
    expect(body.run).toBeNull();
    expect(body.runningInstance).toBeNull();
  });
});
