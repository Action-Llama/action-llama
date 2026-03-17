import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: triggers", { timeout: 180_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("agent-to-agent trigger via al-call", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "caller",
          schedule: "0 0 31 2 *",
          testScript: `#!/bin/bash
echo "triggering callee"
echo "review this PR" | al-call callee
exit 0
`,
        },
        {
          name: "callee",
          schedule: "0 0 31 2 *",
          testScript: `#!/bin/bash
echo "callee received trigger"
exit 0
`,
        },
      ],
    });

    await harness.start();

    // Wait for caller initial run
    await harness.waitForAgentRun("caller");

    // Give some time for the triggered callee run to complete
    await harness.waitForSettle(10000);
    await harness.waitForAgentRun("callee");

    expect(harness.getRunnerPool("caller")?.hasRunningJobs).toBe(false);
    expect(harness.getRunnerPool("callee")?.hasRunningJobs).toBe(false);
  });
});
