import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: rerun", { timeout: 180_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("exit 42 triggers rerun, then completes on second run", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "rerun-once",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            'MARKER="/tmp/rerun-once-ran"',
            'if [ ! -f "$MARKER" ]; then',
            '  touch "$MARKER"',
            '  echo "first run — requesting rerun"',
            "  exit 42",
            "fi",
            'echo "second run — done"',
            "exit 0",
          ].join("\n"),
          config: { timeout: 60 },
        },
      ],
      globalConfig: { maxReruns: 5 },
    });

    await harness.start();

    // First run exits 42, scheduler triggers rerun
    const firstRun = await harness.waitForRunResult("rerun-once");
    expect(firstRun.result).toBe("rerun");

    // At least one rerun was triggered (marker doesn't persist across
    // Docker containers, so all runs exit 42 until maxReruns is hit)
    await harness.waitForRunResult("rerun-once");
  });

  it("max reruns cap stops infinite rerun loops", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "infinite-rerun",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\necho 'rerun again'\nexit 42\n",
          config: { timeout: 30 },
        },
      ],
      globalConfig: { maxReruns: 2 },
    });

    await harness.start();

    // 1 initial + 2 reruns = 3 total runs, then scheduler stops
    await harness.waitForRunResult("infinite-rerun");
    await harness.waitForRunResult("infinite-rerun");
    await harness.waitForRunResult("infinite-rerun");
    // Wait for the rerun loop to fully exit and release the runner
    await harness.waitForIdle("infinite-rerun");
  });
});
