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
          schedule: "0 0 31 2 *", // never fires via cron — only initial run
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

    // Wait for the initial scheduled run via event bus
    const run = await harness.waitForRunResult("cron-agent");
    expect(run.result).toBe("completed");
  });

  it("runs multiple agents concurrently", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "agent-a",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\necho 'agent-a ran'\nexit 0\n",
        },
        {
          name: "agent-b",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\necho 'agent-b ran'\nexit 0\n",
        },
      ],
    });

    await harness.start();

    // Wait for both agents to complete via event bus
    const [runA, runB] = await Promise.all([
      harness.waitForRunResult("agent-a"),
      harness.waitForRunResult("agent-b"),
    ]);
    expect(runA.result).toBe("completed");
    expect(runB.result).toBe("completed");
  });
});
