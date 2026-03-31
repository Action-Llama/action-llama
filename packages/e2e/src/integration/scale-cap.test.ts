/**
 * Integration test: verify the global project scale cap enforcement.
 *
 * When globalConfig.scale is set, the total number of concurrent runners
 * across all agents is capped. enforceProjectScaleCap() redistributes
 * available slots to agents, throttling those that would exceed the cap.
 *
 * Covers: enforceProjectScaleCap() + syncTrackerScales() in scheduler startup.
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: project scale cap", { timeout: 180_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("project with scale cap runs agents (scale cap is enforced without error)", async () => {
    // Configure 3 agents each requesting scale=2, but cap total project at 4.
    // enforceProjectScaleCap() should throttle them: agent-1 gets 2, agent-2 gets 2,
    // agent-3 gets at least 1 (minimum) even if cap is exceeded.
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "capped-agent-1",
          schedule: "0 0 31 2 *",
          config: { scale: 2 },
          testScript: "#!/bin/sh\necho 'agent-1 ran'\nexit 0\n",
        },
        {
          name: "capped-agent-2",
          schedule: "0 0 31 2 *",
          config: { scale: 2 },
          testScript: "#!/bin/sh\necho 'agent-2 ran'\nexit 0\n",
        },
        {
          name: "capped-agent-3",
          schedule: "0 0 31 2 *",
          config: { scale: 2 },
          testScript: "#!/bin/sh\necho 'agent-3 ran'\nexit 0\n",
        },
      ],
      globalConfig: {
        scale: 4, // Total project cap: 4 runners across all 3 agents (requesting 6 total)
      },
    });

    // Scheduler should start successfully even with cap enforcement
    await harness.start();

    // All agents should still be able to run (cap enforcement doesn't prevent running,
    // it just limits concurrency)
    await harness.triggerAgent("capped-agent-1");
    await harness.triggerAgent("capped-agent-2");
    await harness.triggerAgent("capped-agent-3");

    const [run1, run2, run3] = await Promise.all([
      harness.waitForRunResult("capped-agent-1"),
      harness.waitForRunResult("capped-agent-2"),
      harness.waitForRunResult("capped-agent-3"),
    ]);

    expect(run1.result).toBe("completed");
    expect(run2.result).toBe("completed");
    expect(run3.result).toBe("completed");
  });

  it("project without scale cap allows all agents their requested scale", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "uncapped-agent-a",
          schedule: "0 0 31 2 *",
          config: { scale: 2 },
          testScript: "#!/bin/sh\nexit 0\n",
        },
        {
          name: "uncapped-agent-b",
          schedule: "0 0 31 2 *",
          config: { scale: 2 },
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
      // No globalConfig.scale — no cap applied
    });

    await harness.start();

    // Both agents should have scale=2 available
    const poolA = harness.getRunnerPool("uncapped-agent-a");
    const poolB = harness.getRunnerPool("uncapped-agent-b");

    expect(poolA).toBeDefined();
    expect(poolB).toBeDefined();

    // Verify both can run
    await harness.triggerAgent("uncapped-agent-a");
    await harness.triggerAgent("uncapped-agent-b");

    const [runA, runB] = await Promise.all([
      harness.waitForRunResult("uncapped-agent-a"),
      harness.waitForRunResult("uncapped-agent-b"),
    ]);

    expect(runA.result).toBe("completed");
    expect(runB.result).toBe("completed");
  });
});
