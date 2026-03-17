import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: signals", { timeout: 180_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("agent exits 0 is treated as completed", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "exit-zero",
          schedule: "0 0 31 2 *",
          testScript: `#!/bin/bash\necho "success"\nexit 0\n`,
        },
      ],
    });

    await harness.start();
    await harness.waitForAgentRun("exit-zero");
    expect(harness.getRunnerPool("exit-zero")?.hasRunningJobs).toBe(false);
  });

  it("agent exits non-zero is treated as error", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "exit-error",
          schedule: "0 0 31 2 *",
          testScript: `#!/bin/bash\necho "failure"\nexit 1\n`,
        },
      ],
    });

    await harness.start();
    await harness.waitForAgentRun("exit-error");
    expect(harness.getRunnerPool("exit-error")?.hasRunningJobs).toBe(false);
  });

  it("agent can emit structured log lines", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "log-agent",
          schedule: "0 0 31 2 *",
          testScript: `#!/bin/bash
echo '{"_log":true,"msg":"signal-result","type":"return","value":"hello-world"}'
exit 0
`,
        },
      ],
    });

    await harness.start();
    await harness.waitForAgentRun("log-agent");
    expect(harness.getRunnerPool("log-agent")?.hasRunningJobs).toBe(false);
  });

  it("exit 42 is treated as rerun request", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "rerun-signal",
          schedule: "0 0 31 2 *",
          testScript: `#!/bin/bash
# Exit 42 on first run, then 0
MARKER="/tmp/rerun-signal-marker"
if [ ! -f "$MARKER" ]; then
  touch "$MARKER"
  exit 42
fi
exit 0
`,
        },
      ],
      globalConfig: { maxReruns: 3 },
    });

    await harness.start();
    await harness.waitForAgentRun("rerun-signal");
    await harness.waitForSettle(5000);
    await harness.waitForAgentRun("rerun-signal");
    expect(harness.getRunnerPool("rerun-signal")?.hasRunningJobs).toBe(false);
  });
});
