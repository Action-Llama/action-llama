/**
 * Integration test: per-agent enable/disable and pause/resume control API.
 *
 * Tests the following control endpoints that manage individual agent state:
 *   POST /control/agents/:name/enable  — re-enable a disabled agent
 *   POST /control/agents/:name/disable — disable an agent (prevents new runs)
 *   POST /control/agents/:name/pause   — alias for disable
 *   POST /control/agents/:name/resume  — alias for enable
 *
 * Disabled agents reject manual triggers (GET /control/trigger/:name returns error).
 * Re-enabled agents can be triggered again normally.
 *
 * Covers: control/routes/control.ts enable/disable/pause/resume endpoints
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: per-agent enable/disable control API", { timeout: 180_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("disabled agent rejects new triggers, re-enabled agent accepts them", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "toggle-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\necho 'toggle-agent ran'\nexit 0\n",
        },
      ],
    });

    await harness.start();

    // Verify agent works before disable
    await harness.triggerAgent("toggle-agent");
    const firstRun = await harness.waitForRunResult("toggle-agent");
    expect(firstRun.result).toBe("completed");

    // Disable the agent
    const disableRes = await harness.controlAPI("POST", "/agents/toggle-agent/disable");
    expect(disableRes.ok).toBe(true);
    const disableBody = await disableRes.json();
    expect(disableBody.success).toBe(true);

    // Attempting to trigger a disabled agent should fail
    const triggerRes = await harness.controlAPI("POST", "/trigger/toggle-agent");
    // disabled agent should return an error (4xx)
    expect(triggerRes.ok).toBe(false);

    // Re-enable the agent
    const enableRes = await harness.controlAPI("POST", "/agents/toggle-agent/enable");
    expect(enableRes.ok).toBe(true);
    const enableBody = await enableRes.json();
    expect(enableBody.success).toBe(true);

    // Agent should be triggerable again after re-enable
    await harness.triggerAgent("toggle-agent");
    const thirdRun = await harness.waitForRunResult("toggle-agent");
    expect(thirdRun.result).toBe("completed");
  });

  it("pause/resume are aliases for disable/enable", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "pause-resume-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    await harness.start();

    // Run once to confirm it works
    await harness.triggerAgent("pause-resume-agent");
    await harness.waitForRunResult("pause-resume-agent");

    // Pause the agent (alias for disable)
    const pauseRes = await harness.controlAPI("POST", "/agents/pause-resume-agent/pause");
    expect(pauseRes.ok).toBe(true);
    const pauseBody = await pauseRes.json();
    expect(pauseBody.success).toBe(true);

    // Trigger should fail when paused
    const triggerWhilePaused = await harness.controlAPI("POST", "/trigger/pause-resume-agent");
    expect(triggerWhilePaused.ok).toBe(false);

    // Resume the agent (alias for enable)
    const resumeRes = await harness.controlAPI("POST", "/agents/pause-resume-agent/resume");
    expect(resumeRes.ok).toBe(true);
    const resumeBody = await resumeRes.json();
    expect(resumeBody.success).toBe(true);

    // Agent should work again after resume
    await harness.triggerAgent("pause-resume-agent");
    const secondRun = await harness.waitForRunResult("pause-resume-agent");
    expect(secondRun.result).toBe("completed");
  });

  it("disabling nonexistent agent returns 404", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "real-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    await harness.start();

    // Try to disable an agent that doesn't exist
    const res = await harness.controlAPI("POST", "/agents/nonexistent-agent/disable");
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body).toHaveProperty("error");
  });
});
