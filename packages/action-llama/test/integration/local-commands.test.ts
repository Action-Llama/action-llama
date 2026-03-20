/**
 * Integration test: verify that all agent commands (rlock, al-subagent, etc.)
 * work inside Docker containers when running `al start` locally.
 *
 * Containers reach the host gateway via --add-host gateway:host-gateway.
 */

import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: local commands via gateway", { timeout: 180_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("rlock/runlock/rlock-heartbeat work inside a container", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "cmd-lock",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            // Verify rlock is on PATH
            'which rlock || { echo "rlock not found on PATH"; exit 1; }',
            "",
            // Acquire — verify exit 0 + ok=true
            "set +e",
            'ACQUIRE=$(rlock "test://integration-test/cmd-test-resource")',
            "RC=$?",
            "set -e",
            'test "$RC" -eq 0 || { echo "rlock exit=$RC: $ACQUIRE"; exit 1; }',
            'OK=$(echo "$ACQUIRE" | jq -r .ok)',
            'test "$OK" = "true" || { echo "rlock ok=$OK: $ACQUIRE"; exit 1; }',
            "",
            // Heartbeat — verify exit 0 + ok=true
            "set +e",
            'HEARTBEAT=$(rlock-heartbeat "test://integration-test/cmd-test-resource")',
            "RC=$?",
            "set -e",
            'test "$RC" -eq 0 || { echo "rlock-heartbeat exit=$RC: $HEARTBEAT"; exit 1; }',
            'OK=$(echo "$HEARTBEAT" | jq -r .ok)',
            'test "$OK" = "true" || { echo "rlock-heartbeat ok=$OK: $HEARTBEAT"; exit 1; }',
            "",
            // Release — verify exit 0 + ok=true
            "set +e",
            'RELEASE=$(runlock "test://integration-test/cmd-test-resource")',
            "RC=$?",
            "set -e",
            'test "$RC" -eq 0 || { echo "runlock exit=$RC: $RELEASE"; exit 1; }',
            'OK=$(echo "$RELEASE" | jq -r .ok)',
            'test "$OK" = "true" || { echo "runlock ok=$OK: $RELEASE"; exit 1; }',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();

    // Collect lock events to verify the full lifecycle
    const lockCollector = harness.events.collect("lock");

    const run = await harness.waitForRunResult("cmd-lock");
    expect(run.result).toBe("completed");

    const lockEvents = lockCollector.stop();
    const acquire = lockEvents.find((e) => e.action === "acquire" && e.ok);
    const heartbeat = lockEvents.find((e) => e.action === "heartbeat" && e.ok);
    const release = lockEvents.find((e) => e.action === "release" && e.ok);
    expect(acquire).toBeTruthy();
    expect(heartbeat).toBeTruthy();
    expect(release).toBeTruthy();
  });

  it("al-rerun command works inside a container", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "cmd-rerun",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            "export AL_SIGNAL_DIR=/tmp/signals",
            "mkdir -p $AL_SIGNAL_DIR",
            'MARKER="/tmp/cmd-rerun-ran"',
            'if [ ! -f "$MARKER" ]; then',
            '  touch "$MARKER"',
            // al-rerun — verify exit 0 + ok=true
            "  set +e",
            '  RESULT=$(al-rerun)',
            "  RC=$?",
            "  set -e",
            '  test "$RC" -eq 0 || { echo "al-rerun exit=$RC: $RESULT"; exit 1; }',
            '  OK=$(echo "$RESULT" | jq -r .ok)',
            '  test "$OK" = "true" || { echo "al-rerun ok=$OK: $RESULT"; exit 1; }',
            "  exit 42",
            "fi",
            'echo "second run after al-rerun"',
            "exit 0",
          ].join("\n"),
          config: { timeout: 60 },
        },
      ],
      globalConfig: { maxReruns: 1 },
    });

    await harness.start();

    // First run calls al-rerun then exits 42
    const firstRun = await harness.waitForRunResult("cmd-rerun");
    expect(firstRun.result).toBe("rerun");

    // At least one rerun was triggered
    await harness.waitForRunResult("cmd-rerun");
  });

  it("al-status command works inside a container", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "cmd-status",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            "export AL_SIGNAL_DIR=/tmp/signals",
            "mkdir -p $AL_SIGNAL_DIR",
            // al-status — verify exit 0 + ok=true
            "set +e",
            'RESULT=$(al-status "processing step 1")',
            "RC=$?",
            "set -e",
            'test "$RC" -eq 0 || { echo "al-status exit=$RC: $RESULT"; exit 1; }',
            'OK=$(echo "$RESULT" | jq -r .ok)',
            'test "$OK" = "true" || { echo "al-status ok=$OK: $RESULT"; exit 1; }',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();
    const run = await harness.waitForRunResult("cmd-status");
    expect(run.result).toBe("completed");
  });

  it("al-shutdown command exits cleanly inside a container", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "cmd-shutdown",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            // al-shutdown posts to gateway — verify it exits 0
            "set +e",
            "al-shutdown 'test shutdown'",
            "RC=$?",
            "set -e",
            'test "$RC" -eq 0 || { echo "al-shutdown exit=$RC"; exit 1; }',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();
    const run = await harness.waitForRunResult("cmd-shutdown");
    expect(run.result).toBe("completed");
  });
});
