import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: rerun", { timeout: 180_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("exit 42 triggers rerun, then completes on second run", async () => {
    // Script exits 42 on first run (creating a marker file), then 0 on subsequent runs
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "rerun-agent",
          schedule: "0 0 31 2 *",
          testScript: `#!/bin/bash
MARKER="/tmp/rerun-agent-ran"
if [ ! -f "$MARKER" ]; then
  touch "$MARKER"
  echo "requesting rerun"
  exit 42
fi
echo "second run"
exit 0
`,
        },
      ],
      globalConfig: {
        maxReruns: 3,
      },
    });

    await harness.start();
    // The initial run will exit 42, then the scheduler re-runs and exits 0
    // Wait long enough for both runs
    await harness.waitForAgentRun("rerun-agent");
    // Give time for the rerun to complete
    await harness.waitForSettle(5000);
    await harness.waitForAgentRun("rerun-agent");
    expect(harness.getRunnerPool("rerun-agent")?.hasRunningJobs).toBe(false);
  });

  it("max reruns is enforced", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "infinite-rerun",
          schedule: "0 0 31 2 *",
          testScript: `#!/bin/bash\necho "rerun forever"\nexit 42\n`,
        },
      ],
      globalConfig: {
        maxReruns: 2,
      },
    });

    await harness.start();
    // Wait for all reruns to exhaust
    await harness.waitForAgentRun("infinite-rerun");
    await harness.waitForSettle(10000);
    await harness.waitForAgentRun("infinite-rerun");
    expect(harness.getRunnerPool("infinite-rerun")?.hasRunningJobs).toBe(false);
  });
});
