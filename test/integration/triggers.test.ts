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
            "#!/bin/sh",
            "set +e",
            'RESULT=$(echo "review PR #42" | al-call callee)',
            "RC=$?",
            "set -e",
            // Verify exit code 0
            'test "$RC" -eq 0 || { echo "al-call failed with exit $RC: $RESULT"; exit 1; }',
            // Verify JSON response
            'OK=$(echo "$RESULT" | jq -r .ok)',
            'test "$OK" = "true" || { echo "al-call ok=$OK: $RESULT"; exit 1; }',
            'CALL_ID=$(echo "$RESULT" | jq -r .callId)',
            'test "$CALL_ID" != "null" && test -n "$CALL_ID" || { echo "no callId: $RESULT"; exit 1; }',
            "exit 0",
          ].join("\n"),
        },
        {
          name: "callee",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            'echo "callee received trigger"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();

    const callerRun = await harness.waitForRunResult("caller");
    expect(callerRun.result).toBe("completed");

    // Callee's initial run
    await harness.waitForRunResult("callee");
  });

  it("al-call + al-check: caller can check call status", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "check-caller",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            // al-call: dispatch and verify exit code + JSON
            "set +e",
            'RESULT=$(echo "do work" | al-call check-worker)',
            "RC=$?",
            "set -e",
            'test "$RC" -eq 0 || { echo "al-call exit=$RC: $RESULT"; exit 1; }',
            'OK=$(echo "$RESULT" | jq -r .ok)',
            'test "$OK" = "true" || { echo "al-call ok=$OK: $RESULT"; exit 1; }',
            'CALL_ID=$(echo "$RESULT" | jq -r .callId)',
            'test -n "$CALL_ID" && test "$CALL_ID" != "null" || { echo "no callId: $RESULT"; exit 1; }',
            "",
            // al-check: verify exit code 0 and status field present
            "set +e",
            "CHECK=$(al-check $CALL_ID)",
            "RC=$?",
            "set -e",
            'test "$RC" -eq 0 || { echo "al-check exit=$RC: $CHECK"; exit 1; }',
            'STATUS=$(echo "$CHECK" | jq -r .status)',
            'test -n "$STATUS" && test "$STATUS" != "null" || { echo "no status: $CHECK"; exit 1; }',
            "exit 0",
          ].join("\n"),
        },
        {
          name: "check-worker",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            'echo "worker doing work"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();

    const callerRun = await harness.waitForRunResult("check-caller");
    expect(callerRun.result).toBe("completed");
  });

  it("al-call + al-wait: caller blocks until callee completes", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "wait-caller",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            // al-call: dispatch and verify
            "set +e",
            'RESULT=$(echo "compute something" | al-call wait-worker)',
            "RC=$?",
            "set -e",
            'test "$RC" -eq 0 || { echo "al-call exit=$RC: $RESULT"; exit 1; }',
            'OK=$(echo "$RESULT" | jq -r .ok)',
            'test "$OK" = "true" || { echo "al-call ok=$OK: $RESULT"; exit 1; }',
            'CALL_ID=$(echo "$RESULT" | jq -r .callId)',
            'test -n "$CALL_ID" && test "$CALL_ID" != "null" || { echo "no callId: $RESULT"; exit 1; }',
            "",
            // al-wait: verify exit code 0 and completed status
            "set +e",
            "WAIT_RESULT=$(al-wait $CALL_ID --timeout 60)",
            "RC=$?",
            "set -e",
            'test "$RC" -eq 0 || { echo "al-wait exit=$RC: $WAIT_RESULT"; exit 1; }',
            // al-wait returns JSON keyed by callId — verify the call completed
            "STATUS=$(echo \"$WAIT_RESULT\" | jq -r --arg id \"$CALL_ID\" '.[$id].status')",
            'test "$STATUS" = "completed" || { echo "al-wait status=$STATUS: $WAIT_RESULT"; exit 1; }',
            "exit 0",
          ].join("\n"),
        },
        {
          name: "wait-worker",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            "sleep 2",
            'echo "worker done"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();

    const callerRun = await harness.waitForRunResult("wait-caller");
    expect(callerRun.result).toBe("completed");
  });

  it("self-trigger is prevented (agent cannot call itself)", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "self-caller",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            // Try to call self — should return exit 1 (HTTP 409 conflict)
            "set +e",
            'RESULT=$(echo "self-trigger attempt" | al-call self-caller)',
            "RC=$?",
            "set -e",
            'test "$RC" -eq 1 || { echo "expected exit 1, got $RC: $RESULT"; exit 1; }',
            'OK=$(echo "$RESULT" | jq -r .ok)',
            'test "$OK" = "false" || { echo "expected ok=false: $RESULT"; exit 1; }',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();

    // Collect call events to verify self-call was attempted
    const callCollector = harness.events.collect("call");

    const run = await harness.waitForRunResult("self-caller");
    expect(run.result).toBe("completed");

    const callEvents = callCollector.stop();
    const selfCall = callEvents.find((e) => e.callerAgent === "self-caller" && e.targetAgent === "self-caller");
    expect(selfCall).toBeTruthy();
    expect(selfCall!.ok).toBe(false);
  });
});
