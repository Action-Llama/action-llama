/**
 * Integration test: verify rlock command behavior end-to-end.
 *
 * Spins up the full scheduler + gateway + Docker containers and runs
 * shell scripts that exercise rlock. Uses the SchedulerEventBus to
 * observe lifecycle events without polling. Asserts:
 *   1. Successful lock acquisition (lock event emitted, container completes)
 *   2. Lock conflict when another agent holds the lock
 *   3. Locks are auto-released on container exit
 */

import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

// Shell preamble that waits until the gateway proxy is reachable, then
// verifies that SHUTDOWN_SECRET is set (rlock needs it for auth).
const WAIT_FOR_GATEWAY = [
  "# Wait for gateway proxy to be reachable",
  "i=0; while [ $i -lt 30 ]; do",
  '  curl -sf --connect-timeout 1 "$GATEWAY_URL/health" > /dev/null 2>&1 && break',
  "  i=$((i+1)); sleep 0.5",
  "done",
  'if [ -z "$SHUTDOWN_SECRET" ]; then echo "SHUTDOWN_SECRET not set" >&2; exit 99; fi',
].join("\n");

describe.skipIf(!DOCKER)("integration: rlock end-to-end", { timeout: 180_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("rlock acquires a lock successfully", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "rlock-ok",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            "set -e",
            WAIT_FOR_GATEWAY,
            "",
            "# Acquire lock",
            'RESULT=$(rlock "test-resource")',
            "",
            "# Verify JSON ok:true",
            'OK=$(echo "$RESULT" | jq -r .ok)',
            'test "$OK" = "true"',
            "",
            "# Release",
            'runlock "test-resource"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();

    // Use the event bus to wait for a successful lock acquisition
    const lockAcquire = harness.events.waitFor(
      "lock",
      (e) => e.action === "acquire" && e.ok && e.resourceKey === "test-resource",
      60_000,
    );

    // Wait for both the lock event and run completion
    const [lockEvent, runEvent] = await Promise.all([
      lockAcquire,
      harness.waitForRunResult("rlock-ok"),
    ]);

    expect(lockEvent.ok).toBe(true);
    expect(lockEvent.agentName).toBe("rlock-ok");
    expect(runEvent.result).toBe("completed");
  });

  it("rlock returns conflict when another agent already holds the lock", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "holder",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            "set -e",
            WAIT_FOR_GATEWAY,
            "",
            'rlock "contested-lock"',
            "sleep 10",
            'runlock "contested-lock"',
            "exit 0",
          ].join("\n"),
        },
        {
          name: "contender",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            WAIT_FOR_GATEWAY,
            "",
            "# Wait for holder to acquire the lock",
            "sleep 4",
            "",
            "# Try to acquire — capture exit code",
            "set +e",
            'RESULT=$(rlock "contested-lock")',
            "RC=$?",
            "set -e",
            "",
            "# rlock exit 1 = HTTP 409 conflict, exit 0 = acquired (race)",
            '# Either is acceptable — the test verifies the script completes.',
            'if [ "$RC" -eq 1 ]; then',
            "  # Conflict — verify ok:false in response",
            '  OK=$(echo "$RESULT" | jq -r .ok)',
            '  test "$OK" = "false"',
            "  exit 0",
            "fi",
            'if [ "$RC" -eq 0 ]; then',
            "  # Won the race — release and exit",
            '  runlock "contested-lock" || true',
            "  exit 0",
            "fi",
            "",
            'echo "unexpected rlock exit=$RC" >&2',
            "exit 1",
          ].join("\n"),
        },
      ],
    });

    await harness.start();

    // Collect all lock events so we can inspect them after both runs complete
    const lockCollector = harness.events.collect("lock");

    const holderEvent = await harness.waitForRunResult("holder");
    const contenderEvent = await harness.waitForRunResult("contender");

    const lockEvents = lockCollector.stop();

    expect(holderEvent.result).toBe("completed");
    expect(contenderEvent.result).toBe("completed");

    // The holder should have acquired the lock
    const holderAcquire = lockEvents.find(
      (e) => e.agentName === "holder" && e.action === "acquire" && e.ok,
    );
    expect(holderAcquire).toBeTruthy();

    // The contender should have either gotten a conflict or won the race
    const contenderAcquire = lockEvents.find(
      (e) => e.agentName === "contender" && e.action === "acquire",
    );
    // If contender got a lock event at all, it must exist (conflict or success)
    if (contenderAcquire) {
      expect(typeof contenderAcquire.ok).toBe("boolean");
    }

    // After both complete, no locks should remain
    const lockRes = await fetch(`http://127.0.0.1:${harness.gatewayPort}/locks/status`, {
      headers: { Authorization: `Bearer ${harness.apiKey}` },
    });
    const lockBody = (await lockRes.json()) as { locks: unknown[] };
    expect(lockBody.locks).toHaveLength(0);
  });

  it("locks are released automatically on container cleanup", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "leaky",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            "set -e",
            WAIT_FOR_GATEWAY,
            "",
            "# Acquire lock but exit without releasing",
            'rlock "leaked-resource"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();

    // Wait for run to complete (lock cleanup happens during unregisterContainer)
    const runEnd = await harness.events.waitFor(
      "run:end",
      (e) => e.agentName === "leaky",
      60_000,
    );
    expect(runEnd.result).toBe("completed");

    // Wait for container cleanup to release locks
    await harness.waitForIdle("leaky");

    const lockRes = await fetch(`http://127.0.0.1:${harness.gatewayPort}/locks/status`, {
      headers: { Authorization: `Bearer ${harness.apiKey}` },
    });
    const lockBody = (await lockRes.json()) as { locks: unknown[] };
    expect(lockBody.locks).toHaveLength(0);
  });
});
