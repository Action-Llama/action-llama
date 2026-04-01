/**
 * Integration test: al-subagent call queued when target runner is busy.
 *
 * When a caller uses al-subagent to trigger a target agent (scale=1) that
 * already has its single runner occupied, the call-dispatcher enqueues the
 * call (work queue path) rather than dispatching it immediately. Once the
 * busy runner finishes, drainQueues() picks up the queued call and executes it.
 *
 * Test scenario:
 *   - callee-agent (scale=1) is triggered twice quickly
 *   - First trigger runs immediately; second trigger queues (runner busy)
 *   - caller-agent uses al-subagent to trigger callee (callee runner still busy)
 *   - The al-subagent call is queued; once callee runner frees up, the queued
 *     call runs and the caller can wait for it via al-subagent-wait
 *
 * Alternatively (simpler): two callers each call the same callee via al-subagent.
 * The callee has scale=1 so one call is immediate, the other is queued.
 * Both callers complete successfully.
 *
 * Covers: execution/call-dispatcher.ts (result.action === "queued" path),
 *         execution/dispatch-policy.ts dispatchOrQueue all-busy branch for
 *         agent-triggered workitems.
 */

import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)(
  "integration: al-subagent call queued when target runner is busy",
  { timeout: 600_000 },
  () => {
    let harness: IntegrationHarness;

    afterEach(async () => {
      if (harness) await harness.shutdown();
    });

    it("queued al-subagent call runs after target runner becomes available", async () => {
      // The callee has scale=1 — only one runner. We trigger two concurrent
      // callers that each call the callee via al-subagent. The first caller's
      // request dispatches immediately; the second is queued and runs once the
      // first callee run completes.

      const WAIT_FOR_GATEWAY = [
        "i=0; while [ $i -lt 30 ]; do",
        '  curl -sf --connect-timeout 1 "$GATEWAY_URL/health" > /dev/null 2>&1 && break',
        "  i=$((i+1)); sleep 0.5",
        "done",
      ].join("\n");

      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "queue-test-callee",
            schedule: "0 0 31 2 *",
            config: { scale: 1 }, // Only 1 runner — 2nd call must queue
            testScript: [
              "#!/bin/sh",
              "set -e",
              // Slow down so the first run keeps the runner busy when second caller arrives
              "sleep 5",
              'echo "queue-test-callee: completed"',
              "exit 0",
            ].join("\n"),
          },
          {
            name: "queue-test-caller-a",
            schedule: "0 0 31 2 *",
            testScript: [
              "#!/bin/sh",
              "set -e",
              WAIT_FOR_GATEWAY,
              // Caller A triggers the callee
              "set +e",
              'RESULT=$(echo "call from A" | al-subagent queue-test-callee)',
              "RC=$?",
              "set -e",
              'test "$RC" -eq 0 || { echo "al-subagent A exit=$RC: $RESULT"; exit 1; }',
              'OK=$(echo "$RESULT" | jq -r .ok)',
              'test "$OK" = "true" || { echo "al-subagent A ok=$OK: $RESULT"; exit 1; }',
              'CALL_ID=$(echo "$RESULT" | jq -r .callId)',
              'test -n "$CALL_ID" && test "$CALL_ID" != "null" || { echo "A: no callId: $RESULT"; exit 1; }',
              // Wait for callee to complete (up to 120s — may be queued behind B)
              "set +e",
              'WAIT=$(al-subagent-wait "$CALL_ID" --timeout 120)',
              "WAIT_RC=$?",
              "set -e",
              'test "$WAIT_RC" -eq 0 || { echo "A al-subagent-wait exit=$WAIT_RC: $WAIT"; exit 1; }',
              'STATUS=$(echo "$WAIT" | jq -r --arg id "$CALL_ID" ".[$id].status")',
              'test "$STATUS" = "completed" || { echo "A: unexpected status $STATUS: $WAIT"; exit 1; }',
              'echo "queue-test-caller-a: callee completed OK"',
              "exit 0",
            ].join("\n"),
          },
          {
            name: "queue-test-caller-b",
            schedule: "0 0 31 2 *",
            testScript: [
              "#!/bin/sh",
              "set -e",
              WAIT_FOR_GATEWAY,
              // Caller B also triggers the callee (may queue behind A's call)
              "set +e",
              'RESULT=$(echo "call from B" | al-subagent queue-test-callee)',
              "RC=$?",
              "set -e",
              'test "$RC" -eq 0 || { echo "al-subagent B exit=$RC: $RESULT"; exit 1; }',
              'OK=$(echo "$RESULT" | jq -r .ok)',
              'test "$OK" = "true" || { echo "al-subagent B ok=$OK: $RESULT"; exit 1; }',
              'CALL_ID=$(echo "$RESULT" | jq -r .callId)',
              'test -n "$CALL_ID" && test "$CALL_ID" != "null" || { echo "B: no callId: $RESULT"; exit 1; }',
              // Wait for callee to complete (longer timeout — queued call may wait for runner)
              "set +e",
              'WAIT=$(al-subagent-wait "$CALL_ID" --timeout 120)',
              "WAIT_RC=$?",
              "set -e",
              'test "$WAIT_RC" -eq 0 || { echo "B al-subagent-wait exit=$WAIT_RC: $WAIT"; exit 1; }',
              'STATUS=$(echo "$WAIT" | jq -r --arg id "$CALL_ID" ".[$id].status")',
              'test "$STATUS" = "completed" || { echo "B: unexpected status $STATUS: $WAIT"; exit 1; }',
              'echo "queue-test-caller-b: callee completed OK"',
              "exit 0",
            ].join("\n"),
          },
        ],
      });

      await harness.start();

      // Pre-build callee image by triggering it once (so it's ready when callers run)
      // This avoids a race where callee build hasn't finished when callers try to call it
      await harness.triggerAgent("queue-test-callee");
      await harness.waitForRunResult("queue-test-callee", 120_000);

      // Trigger both callers simultaneously — they will both call the callee.
      // Callee scale=1 means one call dispatches, the other queues.
      await harness.triggerAgent("queue-test-caller-a");
      await harness.triggerAgent("queue-test-caller-b");

      // Both callers should complete successfully (queued call runs after first finishes)
      const [runA, runB] = await Promise.all([
        harness.waitForRunResult("queue-test-caller-a", 300_000),
        harness.waitForRunResult("queue-test-caller-b", 300_000),
      ]);

      expect(runA.result).toBe("completed");
      expect(runB.result).toBe("completed");
    });
  },
);
