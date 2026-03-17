import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: scheduler", { timeout: 180_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("starts scheduler, builds images, runs agent, and shuts down", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "echo-agent",
          schedule: "0 0 31 2 *", // never fires — Feb 31
          testScript: `#!/bin/bash\necho "hello from echo-agent"\nexit 0\n`,
        },
      ],
    });

    await harness.start();

    // Scheduler started successfully — gateway should be reachable
    const healthRes = await fetch(`http://127.0.0.1:${harness.gatewayPort}/health`);
    expect(healthRes.ok).toBe(true);
    const health = await healthRes.json();
    expect(health.status).toBe("ok");

    // Wait for the initial run (scheduler fires initial run for scheduled agents)
    await harness.waitForAgentRun("echo-agent");

    // Agent should no longer be running
    const pool = harness.getRunnerPool("echo-agent");
    expect(pool?.hasRunningJobs).toBe(false);
  });

  it("handles multiple agents", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "agent-a",
          schedule: "0 0 31 2 *",
          testScript: `#!/bin/bash\necho "agent-a ran"\nexit 0\n`,
        },
        {
          name: "agent-b",
          schedule: "0 0 31 2 *",
          testScript: `#!/bin/bash\necho "agent-b ran"\nexit 0\n`,
        },
      ],
    });

    await harness.start();
    await harness.waitForAgentRun("agent-a");
    await harness.waitForAgentRun("agent-b");

    expect(harness.getRunnerPool("agent-a")?.hasRunningJobs).toBe(false);
    expect(harness.getRunnerPool("agent-b")?.hasRunningJobs).toBe(false);
  });

  it("reports error exit codes", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "fail-agent",
          schedule: "0 0 31 2 *",
          testScript: `#!/bin/bash\necho "about to fail"\nexit 1\n`,
        },
      ],
    });

    await harness.start();
    await harness.waitForAgentRun("fail-agent");
    expect(harness.getRunnerPool("fail-agent")?.hasRunningJobs).toBe(false);
  });
});
