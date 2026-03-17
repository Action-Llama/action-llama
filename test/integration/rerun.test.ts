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
    // First run exits 42, scheduler re-runs, second run exits 0
    await harness.waitForAgentRun("rerun-once");
    await harness.waitForSettle(10000);
    await harness.waitForAgentRun("rerun-once");
    expect(harness.getRunnerPool("rerun-once")?.hasRunningJobs).toBe(false);
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
    await harness.waitForAgentRun("infinite-rerun");
    await harness.waitForSettle(20000);
    expect(harness.getRunnerPool("infinite-rerun")?.hasRunningJobs).toBe(false);
  });
});
