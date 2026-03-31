import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: scheduler", { timeout: 180_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("starts scheduler, builds images, runs cron agent, gateway responds to health", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "cron-agent",
          schedule: "*/5 * * * *", // runs every 5 minutes
          testScript: [
            "#!/bin/sh",
            "set -e",
            // Verify env vars are set
            'test -n "$PROMPT" || { echo "PROMPT not set"; exit 1; }',
            'test -n "$GATEWAY_URL" || { echo "GATEWAY_URL not set"; exit 1; }',
            'test -n "$SHUTDOWN_SECRET" || { echo "SHUTDOWN_SECRET not set"; exit 1; }',
            // Verify credentials are mounted
            'test -f /credentials/anthropic_key/default/token || { echo "credentials not mounted"; exit 1; }',
            'CRED=$(cat /credentials/anthropic_key/default/token)',
            'test -n "$CRED" || { echo "credential is empty"; exit 1; }',
            'echo "cron-agent: env vars and credentials OK"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();

    // Gateway health check
    const healthRes = await fetch(`http://127.0.0.1:${harness.gatewayPort}/health`);
    expect(healthRes.ok).toBe(true);
    expect((await healthRes.json()).status).toBe("ok");

    // Manually trigger the agent since there are no more automatic initial runs
    await harness.triggerAgent("cron-agent");

    // Wait for the manual run to complete via event bus
    const run = await harness.waitForRunResult("cron-agent");
    expect(run.result).toBe("completed");
  });

  it("run:start event is emitted with correct agentName, instanceId, and trigger", async () => {
    // Verifies that the scheduler event bus emits 'run:start' when an agent
    // run begins, and that the emitted instanceId matches the one returned
    // by the control API trigger response.
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "run-start-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\necho 'run-start-agent ran'\nexit 0\n",
        },
      ],
    });

    await harness.start();

    // Subscribe to run:start before triggering
    const startPromise = harness.events.waitFor(
      "run:start",
      (e) => e.agentName === "run-start-agent",
      30_000,
    );

    // Trigger the agent and capture the instanceId from the HTTP response
    const triggerRes = await harness.controlAPI("POST", "/trigger/run-start-agent");
    expect(triggerRes.ok).toBe(true);
    const triggerBody = await triggerRes.json();
    const triggerInstanceId = triggerBody.instanceId as string;
    expect(triggerInstanceId).toBeTruthy();

    // Wait for run:start event
    const startEvent = await startPromise;
    expect(startEvent.agentName).toBe("run-start-agent");
    expect(startEvent.instanceId).toBeTruthy();
    // The instanceId in the event should match what the trigger API returned
    expect(startEvent.instanceId).toBe(triggerInstanceId);
    // The trigger field should indicate a manual trigger
    expect(startEvent.trigger).toBe("manual");

    // Wait for the run to complete
    const run = await harness.waitForRunResult("run-start-agent");
    expect(run.result).toBe("completed");
  });

  it("runs multiple agents concurrently", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "agent-a",
          schedule: "*/5 * * * *",
          testScript: "#!/bin/sh\necho 'agent-a ran'\nexit 0\n",
        },
        {
          name: "agent-b",
          schedule: "*/5 * * * *",
          testScript: "#!/bin/sh\necho 'agent-b ran'\nexit 0\n",
        },
      ],
    });

    await harness.start();

    // Manually trigger both agents since there are no more automatic initial runs
    await harness.triggerAgent("agent-a");
    await harness.triggerAgent("agent-b");

    // Wait for both agents to complete via event bus
    const [runA, runB] = await Promise.all([
      harness.waitForRunResult("agent-a"),
      harness.waitForRunResult("agent-b"),
    ]);
    expect(runA.result).toBe("completed");
    expect(runB.result).toBe("completed");
  });
});
