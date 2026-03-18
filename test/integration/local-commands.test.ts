/**
 * Integration test: verify that all agent commands (rlock, al-call, etc.)
 * work inside Docker containers when running `al start` locally.
 *
 * This tests the gateway proxy path — containers POST to http://gateway:8080
 * on the Docker network, which proxies to the host gateway.
 */

import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: local commands via gateway proxy", { timeout: 180_000 }, () => {
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
            "set -e",
            // Verify rlock is on PATH
            'which rlock || { echo "rlock not found on PATH"; exit 1; }',
            // Acquire
            'ACQUIRE=$(rlock "cmd-test-resource")',
            'echo "acquire: $ACQUIRE"',
            'echo "$ACQUIRE" | jq -e .ok || exit 1',
            // Heartbeat
            'HEARTBEAT=$(rlock-heartbeat "cmd-test-resource")',
            'echo "heartbeat: $HEARTBEAT"',
            'echo "$HEARTBEAT" | jq -e .ok || exit 1',
            // Release
            'RELEASE=$(runlock "cmd-test-resource")',
            'echo "release: $RELEASE"',
            'echo "$RELEASE" | jq -e .ok || exit 1',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();
    await harness.waitForAgentRun("cmd-lock");
    expect(harness.getRunnerPool("cmd-lock")?.hasRunningJobs).toBe(false);
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
            "  al-rerun",
            "  exit 42",
            "fi",
            'echo "second run after al-rerun"',
            "exit 0",
          ].join("\n"),
          config: { timeout: 60 },
        },
      ],
      globalConfig: { maxReruns: 3 },
    });

    await harness.start();
    await harness.waitForAgentRun("cmd-rerun");
    await harness.waitForSettle(10000);
    await harness.waitForAgentRun("cmd-rerun");
    expect(harness.getRunnerPool("cmd-rerun")?.hasRunningJobs).toBe(false);
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
            'RESULT=$(al-status "processing step 1")',
            'echo "al-status result: $RESULT"',
            'echo "$RESULT" | jq -e .ok || exit 1',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();
    await harness.waitForAgentRun("cmd-status");
    expect(harness.getRunnerPool("cmd-status")?.hasRunningJobs).toBe(false);
  });

  it("al-shutdown command exits cleanly inside a container", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "cmd-shutdown",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            // al-shutdown should not error (it posts to gateway, result is ignored)
            "al-shutdown 'test shutdown' || true",
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();
    await harness.waitForAgentRun("cmd-shutdown");
    expect(harness.getRunnerPool("cmd-shutdown")?.hasRunningJobs).toBe(false);
  });
});
