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
          testScript: "#!/bin/bash\necho 'running'\nexit 0\n",
        },
      ],
    });

    await harness.start();
    await harness.waitForAgentRun("ctrl-agent");

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
          testScript: "#!/bin/bash\necho 'manually triggered'\nexit 0\n",
        },
      ],
    });

    await harness.start();
    await harness.waitForAgentRun("manual-agent");

    // Trigger again via control API
    const triggerRes = await harness.controlAPI("POST", "/trigger/manual-agent");
    expect(triggerRes.ok).toBe(true);

    await harness.waitForAgentRun("manual-agent");
    expect(harness.getRunnerPool("manual-agent")?.hasRunningJobs).toBe(false);
  });

  it("kill agent via control API", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "kill-agent",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/bash",
            // Long-running agent to give us time to kill it
            "sleep 300",
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();
    // Wait until agent is running
    await harness.waitForSettle(10000);

    const pool = harness.getRunnerPool("kill-agent");
    if (pool?.hasRunningJobs) {
      const killRes = await harness.controlAPI("POST", "/agents/kill-agent/kill");
      expect(killRes.ok).toBe(true);
      const killBody = await killRes.json();
      expect(killBody.success).toBe(true);
    }
  });

  it("trigger nonexistent agent returns 404", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "existing-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/bash\nexit 0\n",
        },
      ],
    });

    await harness.start();
    await harness.waitForAgentRun("existing-agent");

    const res = await harness.controlAPI("POST", "/trigger/nonexistent");
    expect(res.status).toBe(404);
  });
});
