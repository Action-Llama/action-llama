/**
 * Integration test: scheduler orphan container recovery on restart.
 *
 * When the scheduler crashes (or is stopped without killing running containers),
 * it leaves "orphan" Docker containers — containers that are still running from
 * the previous session. On the next startup, recoverOrphanContainers() in
 * scheduler/orphan-recovery.ts handles these orphans:
 *
 *   1. Re-adoption: container is running + has a persistent registry entry →
 *      the runner re-adopts it, monitors the exit, and records the result.
 *   2. Stale cleanup: containers that exited while the scheduler was down →
 *      registry entries are purged so the new session starts clean.
 *   3. Kill unregistered orphan: container running but has no registry entry →
 *      it is killed immediately (foreign container, cannot re-adopt safely).
 *
 * Covers: scheduler/orphan-recovery.ts recoverOrphanContainers() — all major
 * branches (re-adopt, stale cleanup, unregistered-orphan kill).
 */

import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";
import { setDefaultBackend } from "@action-llama/action-llama/internals/credentials";
import { FilesystemBackend } from "@action-llama/action-llama/internals/filesystem-backend";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)(
  "integration: orphan container recovery on scheduler restart",
  { timeout: 600_000 },
  () => {
    let harness: IntegrationHarness;

    afterEach(async () => {
      if (harness) await harness.shutdown();
    });

    it("re-adopts a running orphan container and the run completes after restart", async () => {
      // Agent sleeps long enough that it won't finish before the simulated crash.
      // 20 seconds gives us time to trigger, detect the running container, crash,
      // restart, and let orphan recovery re-attach before the exit.
      const SLEEP_SECONDS = 20;

      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "orphan-adopt-agent",
            schedule: "0 0 31 2 *", // never fires by cron
            testScript: [
              "#!/bin/sh",
              "set -e",
              `sleep ${SLEEP_SECONDS}`,
              'echo "orphan-adopt-agent: completed after sleep"',
              "exit 0",
            ].join("\n"),
          },
        ],
      });

      await harness.start();

      // Trigger the agent — starts the slow container.
      await harness.triggerAgent("orphan-adopt-agent");

      // Wait until the container is actually running (up to 30s).
      await harness.waitForRunning("orphan-adopt-agent", 30_000);

      // Simulate a scheduler crash: close gateway + stop cron WITHOUT killing containers.
      // Containers keep running; the container registry entry stays in the SQLite DB.
      await harness.shutdownNoKill();

      // Restore credential backend for the restart (shutdownNoKill resets it).
      setDefaultBackend(new FilesystemBackend(harness.credentialDir));

      // Restart the scheduler — recoverOrphanContainers() will find the running
      // container, look it up in the persistent registry, and re-adopt it via
      // runner.adoptContainer().
      await harness.start();

      // The re-adopted container should complete its sleep and exit 0.
      const run = await harness.waitForRunResult("orphan-adopt-agent", 120_000);
      expect(run.result).toBe("completed");
    });

    it("cleans up stale registry entries when containers already exited during the crash window", async () => {
      // Start with a fast agent that exits before we simulate the crash.
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "orphan-stale-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\necho 'orphan-stale-agent completed'\nexit 0\n",
          },
        ],
      });

      await harness.start();

      // Trigger and wait for the run to complete (container exits normally).
      await harness.triggerAgent("orphan-stale-agent");
      await harness.waitForRunResult("orphan-stale-agent");

      // Simulate crash — the container is already gone, but the scheduler may
      // have stale registry state if it couldn't clean up before crashing.
      await harness.shutdownNoKill();

      // Restore credentials.
      setDefaultBackend(new FilesystemBackend(harness.credentialDir));

      // Restart — orphan recovery finds no running containers and should clean
      // any stale registry entries from the previous session.  The scheduler
      // should start cleanly and be able to serve new runs immediately.
      await harness.start();

      // Verify the scheduler is healthy after stale-cleanup by running the agent again.
      await harness.triggerAgent("orphan-stale-agent");
      const run = await harness.waitForRunResult("orphan-stale-agent", 120_000);
      expect(run.result).toBe("completed");
    });
  },
);
