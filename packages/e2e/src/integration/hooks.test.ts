/**
 * Integration test: verify agent pre/post hooks run correctly inside the container.
 *
 * Hooks are shell commands configured in per-agent config.toml under [hooks.pre]
 * and [hooks.post]. Pre hooks run before the LLM session (and before test-script.sh
 * in test mode). Post hooks run after the LLM session completes.
 *
 * Since test-script.sh bypasses the LLM and returns early, post hooks are only
 * exercised in LLM mode; these tests cover pre hooks and hook failure scenarios.
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: agent hooks", { timeout: 180_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("pre hooks run before test-script and create files visible in the container", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "pre-hook-agent",
          schedule: "0 0 31 2 *",
          config: {
            hooks: {
              pre: [
                // Create a marker file in /tmp (writable in containers)
                "echo 'pre-hook-ran' > /tmp/pre-hook-marker",
              ],
            },
          },
          testScript: [
            "#!/bin/sh",
            "set -e",
            // The pre hook should have created this marker
            'test -f /tmp/pre-hook-marker || { echo "pre-hook-marker not found — pre hook did not run"; exit 1; }',
            'CONTENT=$(cat /tmp/pre-hook-marker)',
            'test "$CONTENT" = "pre-hook-ran" || { echo "unexpected marker content: $CONTENT"; exit 1; }',
            'echo "pre-hook-agent: pre hook verified OK"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();
    await harness.triggerAgent("pre-hook-agent");

    const run = await harness.waitForRunResult("pre-hook-agent");
    expect(run.result).toBe("completed");
  });

  it("multiple pre hooks execute sequentially in order", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "multi-hook-agent",
          schedule: "0 0 31 2 *",
          config: {
            hooks: {
              pre: [
                // First hook writes step-1
                "echo 'step-1' > /tmp/hook-sequence",
                // Second hook appends step-2
                "echo 'step-2' >> /tmp/hook-sequence",
                // Third hook appends step-3
                "echo 'step-3' >> /tmp/hook-sequence",
              ],
            },
          },
          testScript: [
            "#!/bin/sh",
            "set -e",
            'test -f /tmp/hook-sequence || { echo "hook-sequence file not found"; exit 1; }',
            // Verify all three lines are present in order
            'LINES=$(cat /tmp/hook-sequence)',
            'echo "$LINES" | grep -q "step-1" || { echo "step-1 not found: $LINES"; exit 1; }',
            'echo "$LINES" | grep -q "step-2" || { echo "step-2 not found: $LINES"; exit 1; }',
            'echo "$LINES" | grep -q "step-3" || { echo "step-3 not found: $LINES"; exit 1; }',
            // Verify they appear in order (step-1 before step-2 before step-3)
            'LINE1=$(echo "$LINES" | grep -n "step-1" | cut -d: -f1)',
            'LINE2=$(echo "$LINES" | grep -n "step-2" | cut -d: -f1)',
            'LINE3=$(echo "$LINES" | grep -n "step-3" | cut -d: -f1)',
            'test "$LINE1" -lt "$LINE2" || { echo "step-1 should come before step-2"; exit 1; }',
            'test "$LINE2" -lt "$LINE3" || { echo "step-2 should come before step-3"; exit 1; }',
            'echo "multi-hook-agent: hooks ran in correct order"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();
    await harness.triggerAgent("multi-hook-agent");

    const run = await harness.waitForRunResult("multi-hook-agent");
    expect(run.result).toBe("completed");
  });

  it("pre hook failure causes agent run to fail with error result", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "failing-hook-agent",
          schedule: "0 0 31 2 *",
          config: {
            hooks: {
              pre: [
                // This hook exits non-zero — should abort the run
                "echo 'pre hook about to fail' && exit 1",
              ],
            },
          },
          testScript: [
            "#!/bin/sh",
            // This should never be reached since the pre hook failed
            'echo "test-script should not have run"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();
    await harness.triggerAgent("failing-hook-agent");

    const run = await harness.waitForRunResult("failing-hook-agent");
    // Pre hook failure should cause the run to fail
    expect(run.result).toBe("error");
  });

  it("pre hooks have access to gateway URL and credential env vars", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "hook-env-agent",
          schedule: "0 0 31 2 *",
          config: {
            hooks: {
              pre: [
                // Capture env vars into a file for the test-script to verify
                "echo \"GATEWAY_URL=$GATEWAY_URL\" > /tmp/hook-env",
                "echo \"SHUTDOWN_SECRET=$SHUTDOWN_SECRET\" >> /tmp/hook-env",
              ],
            },
          },
          testScript: [
            "#!/bin/sh",
            "set -e",
            'test -f /tmp/hook-env || { echo "hook-env file not found"; exit 1; }',
            // Verify GATEWAY_URL was set in the pre hook env
            'grep -q "GATEWAY_URL=http" /tmp/hook-env || { echo "GATEWAY_URL not set in hook env: $(cat /tmp/hook-env)"; exit 1; }',
            // Verify SHUTDOWN_SECRET was set
            'grep -q "SHUTDOWN_SECRET=" /tmp/hook-env || { echo "SHUTDOWN_SECRET not set in hook env: $(cat /tmp/hook-env)"; exit 1; }',
            'SHUTDOWN=$(grep "SHUTDOWN_SECRET=" /tmp/hook-env | cut -d= -f2)',
            'test -n "$SHUTDOWN" || { echo "SHUTDOWN_SECRET is empty in hook env"; exit 1; }',
            'echo "hook-env-agent: pre hook env vars verified OK"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();
    await harness.triggerAgent("hook-env-agent");

    const run = await harness.waitForRunResult("hook-env-agent");
    expect(run.result).toBe("completed");
  });
});
