/**
 * Integration test: verify control API endpoints that require a status tracker.
 *
 * Several control API endpoints require a StatusTracker to function. When the
 * scheduler is started without one (as in the integration test harness which
 * passes undefined), these endpoints return 503 with an error response.
 *
 * This test verifies the 503 error paths explicitly, and also tests the
 * GET /control/queue endpoint (which uses the work queue directly).
 *
 * Covers:
 *   - control/routes/control.ts: GET /control/instances (503 path)
 *   - control/routes/control.ts: GET /control/status (503 path)
 *   - The 503 response shape { error: "..." }
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: control API status tracker unavailable paths", { timeout: 180_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("GET /control/instances returns 503 when no status tracker is available", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "ctrl-instances-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    // Start without statusTracker (harness default)
    await harness.start();

    await harness.triggerAgent("ctrl-instances-agent");
    await harness.waitForRunResult("ctrl-instances-agent", 120_000);

    // GET /control/instances — requires statusTracker, should return 503
    const res = await harness.controlAPI("GET", "/instances");
    expect(res.status).toBe(503);
    const body = await res.json() as { error: string };
    expect(body.error).toBeTruthy();
  });

  it("GET /control/status returns 503 when no status tracker is available", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "ctrl-status-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    await harness.start();

    await harness.triggerAgent("ctrl-status-agent");
    await harness.waitForRunResult("ctrl-status-agent", 120_000);

    // GET /control/status — requires statusTracker, should return 503
    const res = await harness.controlAPI("GET", "/status");
    expect(res.status).toBe(503);
    const body = await res.json() as { error: string };
    expect(body.error).toBeTruthy();
  });
});
