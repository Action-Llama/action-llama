import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: control API", { timeout: 180_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("pause and resume scheduler via control API", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "ctrl-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\necho 'running'\nexit 0\n",
        },
      ],
    });

    await harness.start();
    
    // Manually trigger the agent since there are no more automatic initial runs
    await harness.triggerAgent("ctrl-agent");
    await harness.waitForRunResult("ctrl-agent");

    // Pause
    const pauseRes = await harness.controlAPI("POST", "/pause");
    expect(pauseRes.ok).toBe(true);
    const pauseBody = await pauseRes.json();
    expect(pauseBody.success).toBe(true);

    // Resume
    const resumeRes = await harness.controlAPI("POST", "/resume");
    expect(resumeRes.ok).toBe(true);
    const resumeBody = await resumeRes.json();
    expect(resumeBody.success).toBe(true);
  });

  it("trigger agent manually via control API", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "manual-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\necho 'manually triggered'\nexit 0\n",
        },
      ],
    });

    await harness.start();
    
    // Manually trigger the agent since there are no more automatic initial runs
    await harness.triggerAgent("manual-agent");
    await harness.waitForRunResult("manual-agent");

    // Trigger again via control API
    const triggerRes = await harness.controlAPI("POST", "/trigger/manual-agent");
    expect(triggerRes.ok).toBe(true);

    const secondRun = await harness.waitForRunResult("manual-agent");
    expect(secondRun.result).toBe("completed");
  });

  it("kill agent via control API", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "kill-agent",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            // Long-running agent to give us time to kill it
            "sleep 300",
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();

    // Manually trigger the agent since there are no more automatic initial runs
    await harness.triggerAgent("kill-agent");

    // Wait for the container to be running (run:start fires during
    // startScheduler before listeners are registered, so we poll the pool)
    await harness.waitForRunning("kill-agent");

    const killRes = await harness.controlAPI("POST", "/agents/kill-agent/kill");
    expect(killRes.ok).toBe(true);
    const killBody = await killRes.json();
    expect(killBody.success).toBe(true);

    // Wait for the run to end (killed)
    await harness.events.waitFor("run:end", (e) => e.agentName === "kill-agent", 60_000);
  });

  it("trigger nonexistent agent returns 404", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "existing-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    await harness.start();
    
    // Manually trigger the agent since there are no more automatic initial runs
    await harness.triggerAgent("existing-agent");
    await harness.waitForRunResult("existing-agent");

    const res = await harness.controlAPI("POST", "/trigger/nonexistent");
    expect(res.status).toBe(404);
  });

  it("trigger with custom prompt body passes prompt to container via PROMPT env var", async () => {
    // The trigger endpoint accepts a JSON body with a `prompt` field.
    // When provided, it is passed to the container as the PROMPT env var
    // wrapped in a <user-prompt> block. The test-script verifies it arrives.
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "prompt-agent",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            "set -e",
            // Verify PROMPT is set and contains our custom text
            'test -n "$PROMPT" || { echo "PROMPT env var not set"; exit 1; }',
            'echo "$PROMPT" | grep -q "custom-integration-test-marker" || { echo "custom marker not found in PROMPT: $PROMPT"; exit 1; }',
            'echo "prompt-agent: custom prompt verified OK"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();

    // Trigger with a custom prompt body
    const triggerRes = await harness.controlAPI("POST", "/trigger/prompt-agent", {
      prompt: "custom-integration-test-marker: please handle this request",
    });
    expect(triggerRes.ok).toBe(true);
    const triggerBody = await triggerRes.json();
    expect(triggerBody.success).toBe(true);
    // The response should include an instanceId
    expect(triggerBody.instanceId).toBeTruthy();

    // Wait for the run to complete — test-script verifies the PROMPT contains our marker
    const run = await harness.waitForRunResult("prompt-agent", 120_000);
    expect(run.result).toBe("completed");
  });
});
