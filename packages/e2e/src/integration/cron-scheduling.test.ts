/**
 * Integration test: verify that agents fire on schedule (cron triggering).
 *
 * The scheduler uses croner to fire cron jobs. This test verifies that an
 * agent configured with a frequent schedule (using 6-field cron with seconds)
 * fires automatically without manual triggering.
 *
 * Note: croner supports 6-field cron expressions where the first field is
 * seconds. Pattern "every-N-seconds * * * * *" fires every N seconds.
 *
 * Covers: setupCronJobs() end-to-end, scheduler-to-runner dispatch via cron.
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: cron scheduling", { timeout: 300_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("agent fires automatically on a frequent cron schedule", async () => {
    // Use a 6-field cron with seconds: fires every 10 seconds.
    // The agent should fire automatically without any manual trigger.
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "cron-test-agent",
          // 6-field croner expression: second minute hour dom month dow
          // "*/10 * * * * *" fires every 10 seconds
          schedule: "*/10 * * * * *",
          testScript: [
            "#!/bin/sh",
            'echo "cron-test-agent: fired on schedule"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();

    // Wait for the cron to fire and complete (up to 120s — allow time for
    // image build + one 10s cron interval)
    const run = await harness.waitForRunResult("cron-test-agent", 120_000);
    expect(run.result).toBe("completed");
  });

  it("agent with never-firing schedule does NOT run unless manually triggered", async () => {
    // Schedule that never fires (Feb 31 doesn't exist)
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "no-cron-agent",
          schedule: "0 0 31 2 *", // never fires
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    await harness.start();

    // Wait 5 seconds — the agent should NOT have fired automatically
    const runPromise = harness.waitForRunResult("no-cron-agent", 5_000);
    let timedOut = false;
    await runPromise.catch(() => { timedOut = true; });
    expect(timedOut).toBe(true);

    // Now manually trigger and verify it runs
    await harness.triggerAgent("no-cron-agent");
    const run = await harness.waitForRunResult("no-cron-agent", 60_000);
    expect(run.result).toBe("completed");
  });

  it("two agents with different cron schedules run independently", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "cron-fast",
          schedule: "*/8 * * * * *", // every 8 seconds
          testScript: "#!/bin/sh\necho 'fast'\nexit 0\n",
        },
        {
          name: "cron-slow",
          schedule: "0 0 31 2 *", // never fires automatically
          testScript: "#!/bin/sh\necho 'slow'\nexit 0\n",
        },
      ],
    });

    await harness.start();

    // Fast agent should fire automatically
    const fastRun = await harness.waitForRunResult("cron-fast", 120_000);
    expect(fastRun.result).toBe("completed");

    // Slow agent should NOT have fired yet (no automatic schedule trigger)
    const slowResults = harness.getRunResults("cron-slow");
    expect(slowResults.length).toBe(0);
  });
});
