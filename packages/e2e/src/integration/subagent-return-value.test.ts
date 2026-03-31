/**
 * Integration test: verify that al-return in a callee agent propagates its
 * return value to the caller's al-subagent-wait result.
 *
 * Tests:
 * 1. Callee uses al-return "value" — caller reads returnValue via al-subagent-wait
 * 2. Multiple callees each use al-return — caller receives all returnValues
 *
 * Covers: execution/call-store.ts (complete with returnValue),
 *         execution/routes/calls.ts (GET /calls/:callId — returnValue field),
 *         agents/signals.ts (al-return command),
 *         execution/call-dispatcher.ts (complete with returnValue from runResult).
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)(
  "integration: al-subagent-wait captures returnValue from al-return",
  { timeout: 300_000 },
  () => {
    let harness: IntegrationHarness;

    afterEach(async () => {
      if (harness) await harness.shutdown();
    });

    it("al-subagent-wait returnValue matches al-return value from callee", async () => {
      // Verifies the full return-value propagation path:
      //   al-return "hello-from-worker"
      //   → POST /signals/return (gateway captures returnValue in container runner)
      //   → run completes → callStore.complete(callId, returnValue)
      //   → al-subagent-wait queries GET /calls/:callId
      //   → returnValue field is present in wait result JSON
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "return-value-caller",
            schedule: "0 0 31 2 *",
            testScript: [
              "#!/bin/sh",
              // Dispatch callee via al-subagent
              "set +e",
              'RESULT=$(echo "go" | al-subagent return-value-worker)',
              "RC=$?",
              "set -e",
              'test "$RC" -eq 0 || { echo "al-subagent exit=$RC: $RESULT"; exit 1; }',
              'OK=$(echo "$RESULT" | jq -r .ok)',
              'test "$OK" = "true" || { echo "al-subagent ok=$OK: $RESULT"; exit 1; }',
              'CALL_ID=$(echo "$RESULT" | jq -r .callId)',
              'test -n "$CALL_ID" && test "$CALL_ID" != "null" || { echo "no callId: $RESULT"; exit 1; }',
              // Wait for callee to complete
              "set +e",
              'WAIT_RESULT=$(al-subagent-wait "$CALL_ID" --timeout 60)',
              "WAIT_RC=$?",
              "set -e",
              'test "$WAIT_RC" -eq 0 || { echo "al-subagent-wait exit=$WAIT_RC: $WAIT_RESULT"; exit 1; }',
              // Verify status is completed
              'STATUS=$(echo "$WAIT_RESULT" | jq -r --arg id "$CALL_ID" \'.[$id].status\')',
              'test "$STATUS" = "completed" || { echo "unexpected status=$STATUS: $WAIT_RESULT"; exit 1; }',
              // Verify returnValue matches what the callee set via al-return
              'RETURN_VAL=$(echo "$WAIT_RESULT" | jq -r --arg id "$CALL_ID" \'.[$id].returnValue\')',
              'test "$RETURN_VAL" = "hello-from-worker" || { echo "unexpected returnValue=$RETURN_VAL (expected hello-from-worker): $WAIT_RESULT"; exit 1; }',
              'echo "return-value-caller: returnValue=$RETURN_VAL OK"',
              "exit 0",
            ].join("\n"),
          },
          {
            name: "return-value-worker",
            schedule: "0 0 31 2 *",
            testScript: [
              "#!/bin/sh",
              // Use al-return to set a return value
              'al-return "hello-from-worker"',
              "exit 0",
            ].join("\n"),
          },
        ],
      });

      await harness.start();

      // Trigger the caller which will subagent the worker
      await harness.triggerAgent("return-value-caller");

      const callerRun = await harness.waitForRunResult("return-value-caller", 120_000);
      expect(callerRun.result).toBe("completed");
    });

    it("al-subagent-wait returnValue is null when callee does not use al-return", async () => {
      // Verifies that when a callee exits 0 without al-return, the returnValue
      // field in the wait result is null (not a prior cached value).
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "no-return-caller",
            schedule: "0 0 31 2 *",
            testScript: [
              "#!/bin/sh",
              "set +e",
              'RESULT=$(echo "go" | al-subagent no-return-worker)',
              "RC=$?",
              "set -e",
              'test "$RC" -eq 0 || { echo "al-subagent exit=$RC: $RESULT"; exit 1; }',
              'CALL_ID=$(echo "$RESULT" | jq -r .callId)',
              'test -n "$CALL_ID" && test "$CALL_ID" != "null" || { echo "no callId: $RESULT"; exit 1; }',
              "set +e",
              'WAIT_RESULT=$(al-subagent-wait "$CALL_ID" --timeout 60)',
              "WAIT_RC=$?",
              "set -e",
              'test "$WAIT_RC" -eq 0 || { echo "al-subagent-wait exit=$WAIT_RC"; exit 1; }',
              // When no al-return is used, returnValue should be null or absent
              'STATUS=$(echo "$WAIT_RESULT" | jq -r --arg id "$CALL_ID" \'.[$id].status\')',
              'test "$STATUS" = "completed" || { echo "unexpected status=$STATUS"; exit 1; }',
              'RETURN_VAL=$(echo "$WAIT_RESULT" | jq -r --arg id "$CALL_ID" \'.[$id].returnValue\')',
              // returnValue should be null (jq outputs "null" for JSON null)
              'test "$RETURN_VAL" = "null" || { echo "expected null returnValue but got: $RETURN_VAL"; exit 1; }',
              'echo "no-return-caller: returnValue=$RETURN_VAL (null as expected) OK"',
              "exit 0",
            ].join("\n"),
          },
          {
            name: "no-return-worker",
            schedule: "0 0 31 2 *",
            testScript: [
              "#!/bin/sh",
              // Exit 0 without using al-return
              'echo "no-return-worker: done without al-return"',
              "exit 0",
            ].join("\n"),
          },
        ],
      });

      await harness.start();

      await harness.triggerAgent("no-return-caller");

      const callerRun = await harness.waitForRunResult("no-return-caller", 120_000);
      expect(callerRun.result).toBe("completed");
    });
  },
);
