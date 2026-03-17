import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: agent-to-agent triggers", { timeout: 180_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("al-call triggers another agent", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "caller",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/bash",
            'echo "review PR #42" | al-call callee',
            "exit 0",
          ].join("\n"),
        },
        {
          name: "callee",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/bash",
            'echo "callee received trigger"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();
    await harness.waitForAgentRun("caller");
    await harness.waitForSettle(10000);
    await harness.waitForAgentRun("callee");

    expect(harness.getRunnerPool("caller")?.hasRunningJobs).toBe(false);
    expect(harness.getRunnerPool("callee")?.hasRunningJobs).toBe(false);
  });

  it("al-call + al-check: caller can check call status", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "check-caller",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/bash",
            "set -e",
            // Call the worker agent
            'RESULT=$(echo "do work" | al-call check-worker)',
            'echo "al-call result: $RESULT"',
            // Extract callId from JSON response
            "CALL_ID=$(echo $RESULT | jq -r .callId)",
            'test -n "$CALL_ID" || { echo "no callId returned"; exit 1; }',
            'test "$CALL_ID" != "null" || { echo "callId is null"; exit 1; }',
            // Check status — should be running or completed
            "STATUS=$(al-check $CALL_ID)",
            'echo "al-check result: $STATUS"',
            "exit 0",
          ].join("\n"),
        },
        {
          name: "check-worker",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/bash",
            'echo "worker doing work"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();
    await harness.waitForAgentRun("check-caller");
    await harness.waitForSettle(10000);

    expect(harness.getRunnerPool("check-caller")?.hasRunningJobs).toBe(false);
  });

  it("al-call + al-wait: caller blocks until callee completes", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "wait-caller",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/bash",
            "set -e",
            // Call worker
            'RESULT=$(echo "compute something" | al-call wait-worker)',
            "CALL_ID=$(echo $RESULT | jq -r .callId)",
            'echo "waiting on call $CALL_ID"',
            // Wait with short timeout
            "WAIT_RESULT=$(al-wait $CALL_ID --timeout 60)",
            'echo "al-wait result: $WAIT_RESULT"',
            "exit 0",
          ].join("\n"),
        },
        {
          name: "wait-worker",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/bash",
            "sleep 2",
            'echo "worker done"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();
    await harness.waitForAgentRun("wait-caller");
    await harness.waitForSettle(15000);

    expect(harness.getRunnerPool("wait-caller")?.hasRunningJobs).toBe(false);
  });

  it("self-trigger is prevented (agent cannot call itself)", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "self-caller",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/bash",
            // Try to call self — should succeed at HTTP level but scheduler skips it
            'echo "self-trigger attempt" | al-call self-caller || true',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();
    await harness.waitForAgentRun("self-caller");
    expect(harness.getRunnerPool("self-caller")?.hasRunningJobs).toBe(false);
  });
});
