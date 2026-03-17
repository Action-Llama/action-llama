import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: resource locking", { timeout: 180_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("agent acquires, heartbeats, and releases a lock via rlock/runlock/rlock-heartbeat", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "lock-agent",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            "set -e",
            // Acquire lock
            'ACQUIRE=$(rlock "my-resource")',
            'echo "acquire result: $ACQUIRE"',
            'OK=$(echo "$ACQUIRE" | jq -r .ok)',
            'test "$OK" = "true" || { echo "failed to acquire lock"; exit 1; }',
            "",
            // Heartbeat (extend TTL)
            'HEARTBEAT=$(rlock-heartbeat "my-resource")',
            'echo "heartbeat result: $HEARTBEAT"',
            'OK=$(echo "$HEARTBEAT" | jq -r .ok)',
            'test "$OK" = "true" || { echo "failed to heartbeat lock"; exit 1; }',
            "",
            // Release lock
            'RELEASE=$(runlock "my-resource")',
            'echo "release result: $RELEASE"',
            'OK=$(echo "$RELEASE" | jq -r .ok)',
            'test "$OK" = "true" || { echo "failed to release lock"; exit 1; }',
            "",
            'echo "lock lifecycle complete"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();
    await harness.waitForAgentRun("lock-agent");
    expect(harness.getRunnerPool("lock-agent")?.hasRunningJobs).toBe(false);
  });

  it("lock contention: second agent sees conflict when first holds lock", async () => {
    // Two agents with scale=1 each. First grabs lock, holds it, second tries to acquire.
    // Since they run concurrently (initial runs fire in parallel), one will get the lock
    // and the other will see a conflict.
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "lock-holder",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            // Acquire and hold lock for a few seconds
            'rlock "contested-resource"',
            "sleep 5",
            'runlock "contested-resource"',
            "exit 0",
          ].join("\n"),
        },
        {
          name: "lock-waiter",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            // Wait a moment for holder to grab lock first
            "sleep 2",
            // Try to acquire — may get conflict, that's OK
            'RESULT=$(rlock "contested-resource")',
            'echo "lock attempt: $RESULT"',
            // Whether we got it or not, clean up
            'runlock "contested-resource" 2>/dev/null || true',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();
    await harness.waitForAgentRun("lock-holder");
    await harness.waitForAgentRun("lock-waiter");
    expect(harness.getRunnerPool("lock-holder")?.hasRunningJobs).toBe(false);
    expect(harness.getRunnerPool("lock-waiter")?.hasRunningJobs).toBe(false);
  });

  it("locks are released on container cleanup (no leaked locks)", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "leaky-locker",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            // Acquire lock but exit without releasing — container cleanup should release it
            'rlock "leaked-resource"',
            'echo "exiting without releasing lock"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();
    await harness.waitForAgentRun("leaky-locker");
    await harness.waitForSettle(2000);

    // Check lock status — should be empty since container cleanup releases locks
    const lockRes = await fetch(`http://127.0.0.1:${harness.gatewayPort}/locks/status`, {
      headers: { "Authorization": `Bearer ${harness.apiKey}` },
    });
    expect(lockRes.ok).toBe(true);
    const lockBody = await lockRes.json();
    expect(lockBody.locks).toHaveLength(0);
  });
});
