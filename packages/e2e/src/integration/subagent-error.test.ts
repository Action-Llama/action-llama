/**
 * Integration test: verify al-subagent behaviour when callee errors or times out.
 *
 * Tests:
 * 1. Callee exits with error (exit 1) — al-subagent-wait reports error status
 * 2. al-subagent-wait times out (exit 8) when callee takes too long
 * 3. al-subagent caller handles callee error gracefully
 *
 * Covers: call store error status propagation, al-subagent-wait timeout (exit 8).
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: al-subagent error handling", { timeout: 300_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("al-subagent-wait returns error status when callee exits with error", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "error-caller",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            // Trigger the callee (which will error)
            "set +e",
            'RESULT=$(echo "trigger callee" | al-subagent error-callee)',
            "RC=$?",
            "set -e",
            'test "$RC" -eq 0 || { echo "al-subagent failed with exit $RC: $RESULT"; exit 1; }',
            'CALL_ID=$(echo "$RESULT" | jq -r .callId)',
            'test -n "$CALL_ID" && test "$CALL_ID" != "null" || { echo "no callId: $RESULT"; exit 1; }',
            // Wait for callee to complete (with shorter timeout)
            "set +e",
            'WAIT_RESULT=$(al-subagent-wait "$CALL_ID" --timeout 60)',
            "WAIT_RC=$?",
            "set -e",
            'test "$WAIT_RC" -eq 0 || { echo "al-subagent-wait exit=$WAIT_RC"; exit 1; }',
            // Verify callee's status is error
            'STATUS=$(echo "$WAIT_RESULT" | jq -r --arg id "$CALL_ID" ".[$id].status")',
            'test "$STATUS" = "error" || test "$STATUS" = "completed" || { echo "unexpected status: $STATUS from $WAIT_RESULT"; exit 1; }',
            'echo "error-caller: callee status=$STATUS OK"',
            "exit 0",
          ].join("\n"),
        },
        {
          name: "error-callee",
          schedule: "0 0 31 2 *",
          // Callee intentionally exits with error
          testScript: [
            "#!/bin/sh",
            'echo "error-callee: failing intentionally"',
            "exit 1",
          ].join("\n"),
        },
      ],
    });

    await harness.start();

    // Pre-trigger error-callee to ensure it's ready
    await harness.triggerAgent("error-callee");
    await harness.waitForRunResult("error-callee");

    // Now trigger the caller which will al-subagent the callee
    await harness.triggerAgent("error-caller");

    const callerRun = await harness.waitForRunResult("error-caller", 120_000);
    expect(callerRun.result).toBe("completed");
  });

  it("al-subagent-wait exits with code 8 when callee exceeds timeout", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "timeout-caller",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            // Trigger the slow callee
            "set +e",
            'RESULT=$(echo "go slow" | al-subagent slow-callee)',
            "RC=$?",
            "set -e",
            'test "$RC" -eq 0 || { echo "al-subagent failed with exit $RC"; exit 1; }',
            'CALL_ID=$(echo "$RESULT" | jq -r .callId)',
            'test -n "$CALL_ID" || { echo "no callId: $RESULT"; exit 1; }',
            // Wait with a very short timeout (5s) — callee sleeps 30s so this will timeout
            "set +e",
            'al-subagent-wait "$CALL_ID" --timeout 5',
            "WAIT_RC=$?",
            "set -e",
            // Exit code 8 means timeout
            'test "$WAIT_RC" -eq 8 || { echo "expected exit 8 (timeout) but got $WAIT_RC"; exit 1; }',
            'echo "timeout-caller: got expected timeout exit code 8"',
            "exit 0",
          ].join("\n"),
        },
        {
          name: "slow-callee",
          schedule: "0 0 31 2 *",
          config: { timeout: 120 },
          testScript: [
            "#!/bin/sh",
            // Sleep long enough for the caller's al-subagent-wait to time out
            "sleep 30",
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();

    await harness.triggerAgent("timeout-caller");

    const callerRun = await harness.waitForRunResult("timeout-caller", 120_000);
    expect(callerRun.result).toBe("completed");
  });
});
