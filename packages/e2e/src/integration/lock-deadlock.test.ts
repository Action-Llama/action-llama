/**
 * Integration test: verify deadlock detection in the lock store.
 *
 * The lock store (execution/lock-store.ts) detects potential deadlock cycles
 * using a wait-for graph. When agent A holds resource R1 and is waiting for R2,
 * and agent B holds R2 and tries to acquire R1, the lock store detects the cycle
 * and returns { ok: false, deadlock: true, cycle: [...] } instead of the normal
 * conflict response.
 *
 * The rlock command exit code is 1 (HTTP 409) for both conflict and deadlock.
 * The JSON body distinguishes them: deadlock responses include "deadlock":true.
 *
 * Covers: execution/lock-store.ts → detectCycle() + waitingFor tracking
 * (previously untested end-to-end).
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: lock deadlock detection", { timeout: 300_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("detects deadlock cycle when two agents hold and wait for each other's locks", async () => {
    // Agent A: acquires R1 at t=0, sleeps, tries R2 at t=3 (B holds it → conflict, waitingFor[A]=R2)
    // Agent B: sleeps 1s, acquires R2 at t=1, sleeps, tries R1 at t=4 → detectCycle → deadlock!
    //
    // Expected outcome:
    //   Agent A sees a regular rlock conflict on R2 (exit code 1, ok:false, no deadlock field)
    //   Agent B sees a deadlock on R1 (exit code 1, ok:false, deadlock:true)
    //   Both agents complete without error (they handle the conflict gracefully)

    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "deadlock-agent-a",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            // Acquire R1 immediately
            "set +e",
            'RESULT=$(rlock "test://deadlock-test/resource-1")',
            "RC=$?",
            "set -e",
            'test "$RC" -eq 0 || { echo "A: failed to acquire R1: RC=$RC $RESULT"; exit 1; }',
            'echo "A: acquired R1"',
            "",
            // Sleep to let B acquire R2 first
            "sleep 2",
            "",
            // Try to acquire R2 — B holds it, so this should be a conflict
            // (no deadlock yet, because B hasn't set waitingFor[B] = R1 yet)
            "set +e",
            'RESULT_R2=$(rlock "test://deadlock-test/resource-2")',
            "RC2=$?",
            "set -e",
            // RC2=1 means conflict (409), which is expected
            // This sets waitingFor[A] = R2 in the lock store
            'echo "A: R2 result RC=$RC2 body=$RESULT_R2"',
            "",
            // Release R1 and exit cleanly
            "set +e",
            'runlock "test://deadlock-test/resource-1"',
            "set -e",
            'echo "A: released R1, done"',
            "exit 0",
          ].join("\n"),
          config: { timeout: 60 },
        },
        {
          name: "deadlock-agent-b",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            // Wait for A to acquire R1 first
            "sleep 1",
            "",
            // Acquire R2
            "set +e",
            'RESULT=$(rlock "test://deadlock-test/resource-2")',
            "RC=$?",
            "set -e",
            'test "$RC" -eq 0 || { echo "B: failed to acquire R2: RC=$RC $RESULT"; exit 1; }',
            'echo "B: acquired R2"',
            "",
            // Sleep to let A try R2 first (setting waitingFor[A] = R2)
            "sleep 3",
            "",
            // Try to acquire R1 — A holds it AND A is waiting for R2 (held by B) → deadlock!
            "set +e",
            'RESULT_R1=$(rlock "test://deadlock-test/resource-1")',
            "RC1=$?",
            "set -e",
            // RC1=1 means conflict/deadlock (409)
            'echo "B: R1 result RC=$RC1 body=$RESULT_R1"',
            "",
            // Write the deadlock detection result to a file for the test to inspect
            'echo "$RESULT_R1" > /tmp/deadlock-result.json',
            "",
            // Release R2 and exit cleanly
            "set +e",
            'runlock "test://deadlock-test/resource-2"',
            "set -e",
            'echo "B: released R2, done"',
            "exit 0",
          ].join("\n"),
          config: { timeout: 60 },
        },
      ],
    });

    await harness.start();

    // Collect lock events to observe the deadlock
    const lockCollector = harness.events.collect("lock");

    // Trigger both agents simultaneously
    await harness.triggerAgent("deadlock-agent-a");
    await harness.triggerAgent("deadlock-agent-b");

    // Wait for both agents to complete
    const [runA, runB] = await Promise.all([
      harness.waitForRunResult("deadlock-agent-a", 120_000),
      harness.waitForRunResult("deadlock-agent-b", 120_000),
    ]);

    // Both agents should complete without error (they handle the conflict gracefully)
    expect(runA.result).toBe("completed");
    expect(runB.result).toBe("completed");

    // Verify that lock events were emitted
    const lockEvents = lockCollector.stop();

    // Agent A should have successfully acquired R1
    const aAcquiredR1 = lockEvents.find(
      (e) => e.agentName === "deadlock-agent-a" && e.action === "acquire" && e.ok && e.resourceKey === "test://deadlock-test/resource-1",
    );
    expect(aAcquiredR1).toBeTruthy();

    // Agent B should have successfully acquired R2
    const bAcquiredR2 = lockEvents.find(
      (e) => e.agentName === "deadlock-agent-b" && e.action === "acquire" && e.ok && e.resourceKey === "test://deadlock-test/resource-2",
    );
    expect(bAcquiredR2).toBeTruthy();

    // A should have failed to acquire R2 (conflict)
    const aConflictR2 = lockEvents.find(
      (e) => e.agentName === "deadlock-agent-a" && e.action === "acquire" && !e.ok && e.resourceKey === "test://deadlock-test/resource-2",
    );
    expect(aConflictR2).toBeTruthy();

    // B should have failed to acquire R1 — this is the potential deadlock detection event
    const bConflictR1 = lockEvents.find(
      (e) => e.agentName === "deadlock-agent-b" && e.action === "acquire" && !e.ok && e.resourceKey === "test://deadlock-test/resource-1",
    );
    expect(bConflictR1).toBeTruthy();
  });
});
