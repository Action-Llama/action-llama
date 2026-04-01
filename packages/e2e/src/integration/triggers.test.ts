import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: agent-to-agent triggers", { timeout: 180_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("al-subagent triggers another agent", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "caller",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            "set +e",
            'RESULT=$(echo "review PR #42" | al-subagent callee)',
            "RC=$?",
            "set -e",
            // Verify exit code 0
            'test "$RC" -eq 0 || { echo "al-subagent failed with exit $RC: $RESULT"; exit 1; }',
            // Verify JSON response
            'OK=$(echo "$RESULT" | jq -r .ok)',
            'test "$OK" = "true" || { echo "al-subagent ok=$OK: $RESULT"; exit 1; }',
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

    // Manually trigger the caller agent since there are no more automatic initial runs
    await harness.triggerAgent("caller");

    const callerRun = await harness.waitForRunResult("caller");
    expect(callerRun.result).toBe("completed");

    // Callee's initial run
    await harness.waitForRunResult("callee");
  });

  it("al-subagent + al-subagent-check: caller can check call status", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "check-caller",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            // al-subagent: dispatch and verify exit code + JSON
            "set +e",
            'RESULT=$(echo "do work" | al-subagent check-worker)',
            "RC=$?",
            "set -e",
            'test "$RC" -eq 0 || { echo "al-subagent exit=$RC: $RESULT"; exit 1; }',
            'OK=$(echo "$RESULT" | jq -r .ok)',
            'test "$OK" = "true" || { echo "al-subagent ok=$OK: $RESULT"; exit 1; }',
            'CALL_ID=$(echo "$RESULT" | jq -r .callId)',
            'test -n "$CALL_ID" && test "$CALL_ID" != "null" || { echo "no callId: $RESULT"; exit 1; }',
            "",
            // al-subagent-check: verify exit code 0 and status field present
            "set +e",
            "CHECK=$(al-subagent-check $CALL_ID)",
            "RC=$?",
            "set -e",
            'test "$RC" -eq 0 || { echo "al-subagent-check exit=$RC: $CHECK"; exit 1; }',
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

    // Manually trigger the caller agent since there are no more automatic initial runs
    await harness.triggerAgent("check-caller");

    const callerRun = await harness.waitForRunResult("check-caller");
    expect(callerRun.result).toBe("completed");
  });

  it("al-subagent + al-subagent-wait: caller blocks until callee completes", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "wait-caller",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            // al-subagent: dispatch and verify
            "set +e",
            'RESULT=$(echo "compute something" | al-subagent wait-worker)',
            "RC=$?",
            "set -e",
            'test "$RC" -eq 0 || { echo "al-subagent exit=$RC: $RESULT"; exit 1; }',
            'OK=$(echo "$RESULT" | jq -r .ok)',
            'test "$OK" = "true" || { echo "al-subagent ok=$OK: $RESULT"; exit 1; }',
            'CALL_ID=$(echo "$RESULT" | jq -r .callId)',
            'test -n "$CALL_ID" && test "$CALL_ID" != "null" || { echo "no callId: $RESULT"; exit 1; }',
            "",
            // al-subagent-wait: verify exit code 0 and completed status
            "set +e",
            "WAIT_RESULT=$(al-subagent-wait $CALL_ID --timeout 60)",
            "RC=$?",
            "set -e",
            'test "$RC" -eq 0 || { echo "al-subagent-wait exit=$RC: $WAIT_RESULT"; exit 1; }',
            // al-subagent-wait returns JSON keyed by callId — verify the call completed
            "STATUS=$(echo \"$WAIT_RESULT\" | jq -r --arg id \"$CALL_ID\" '.[$id].status')",
            'test "$STATUS" = "completed" || { echo "al-subagent-wait status=$STATUS: $WAIT_RESULT"; exit 1; }',
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

    // Manually trigger the caller agent since there are no more automatic initial runs
    await harness.triggerAgent("wait-caller");

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
            'RESULT=$(echo "self-trigger attempt" | al-subagent self-caller)',
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

    // Manually trigger the agent since there are no more automatic initial runs
    await harness.triggerAgent("self-caller");

    const run = await harness.waitForRunResult("self-caller");
    expect(run.result).toBe("completed");

    const callEvents = callCollector.stop();
    const selfCall = callEvents.find((e) => e.callerAgent === "self-caller" && e.targetAgent === "self-caller");
    expect(selfCall).toBeTruthy();
    expect(selfCall!.ok).toBe(false);
  });

  it("al-subagent targeting a nonexistent agent returns exit 1 (dispatcher: target not found)", async () => {
    // The call dispatcher validates that the target agent exists in agentConfigs.
    // When the target is not found, it returns { ok: false, reason: "target agent ... not found" }
    // → POST /calls returns 409 → al-subagent exits with code 1.
    //
    // Code path: call-dispatcher.ts → agentConfigs.find() fails → { ok: false, reason: ... }
    // → calls.ts 409 → call event emitted with ok: false
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "call-missing-caller",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            // Attempt to call an agent that doesn't exist
            "set +e",
            'RESULT=$(echo "call nonexistent" | al-subagent does-not-exist-agent)',
            "RC=$?",
            "set -e",
            // al-subagent exits 1 when it receives 409 (dispatch rejected)
            'test "$RC" -eq 1 || { echo "expected exit 1 (rejected), got $RC: $RESULT"; exit 1; }',
            // Response should be ok:false
            'OK=$(echo "$RESULT" | jq -r .ok)',
            'test "$OK" = "false" || { echo "expected ok=false: $RESULT"; exit 1; }',
            'echo "call-missing-caller: nonexistent agent call correctly rejected"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();

    // Collect call events to verify the dispatch failure
    const callCollector = harness.events.collect("call");

    await harness.triggerAgent("call-missing-caller");
    const run = await harness.waitForRunResult("call-missing-caller");
    expect(run.result).toBe("completed");

    const callEvents = callCollector.stop();
    // Should have a call event with ok:false for the attempted call
    const failedCall = callEvents.find(
      (e) => e.callerAgent === "call-missing-caller" && e.targetAgent === "does-not-exist-agent",
    );
    expect(failedCall).toBeTruthy();
    expect(failedCall!.ok).toBe(false);
  });
});
