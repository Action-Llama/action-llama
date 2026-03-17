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
          schedule: "0 0 31 2 *", // never fires
          testScript: `#!/bin/bash\necho "running"\nexit 0\n`,
        },
      ],
    });

    await harness.start();
    await harness.waitForAgentRun("ctrl-agent");

    // Pause scheduler
    const pauseRes = await harness.controlAPI("POST", "/pause");
    expect(pauseRes.ok).toBe(true);

    // Resume scheduler
    const resumeRes = await harness.controlAPI("POST", "/resume");
    expect(resumeRes.ok).toBe(true);
  });

  it("trigger agent manually via control API", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "manual-agent",
          schedule: "0 0 31 2 *",
          testScript: `#!/bin/bash\necho "manually triggered"\nexit 0\n`,
        },
      ],
    });

    await harness.start();
    // Wait for initial run to complete
    await harness.waitForAgentRun("manual-agent");

    // Trigger again via control API
    const triggerRes = await harness.controlAPI("POST", "/trigger/manual-agent");
    expect(triggerRes.ok).toBe(true);

    // Wait for the manual trigger to complete
    await harness.waitForAgentRun("manual-agent");
    expect(harness.getRunnerPool("manual-agent")?.hasRunningJobs).toBe(false);
  });
});
