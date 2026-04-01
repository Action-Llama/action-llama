/**
 * Integration test: verify hot-reload applies maxWorkQueueSize changes.
 *
 * When an agent's config.toml is updated to add or change `maxWorkQueueSize`,
 * the hot-reload watcher (watcher.ts → handleChangedAgent) should call
 * `ctx.schedulerCtx.workQueue.setAgentMaxSize(agentName, newConfig.maxWorkQueueSize)`
 * so that the queue immediately honours the new cap.
 *
 * Test scenario:
 *   1. Start agent without maxWorkQueueSize (default cap of 20).
 *   2. Hot-reload config.toml to add maxWorkQueueSize=1.
 *   3. Wait for hot-reload to complete (image rebuild finishes).
 *   4. Trigger #1 — dispatched immediately (runner free).
 *   5. Wait until runner is busy.
 *   6. Trigger #2 — queued (queue = 1, at the new cap).
 *   7. Trigger #3 — drops #2, queues #3 (cap enforced after hot reload).
 *   8. Wait for both runs to finish.
 *   9. Verify exactly 2 completed runs (trigger #2 was dropped).
 *
 * Covers:
 *   - scheduler/watcher.ts handleChangedAgent maxWorkQueueSize hot-reload path
 *   - workQueue.setAgentMaxSize() applied at runtime (not just at startup)
 */
import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync } from "fs";
import { resolve } from "path";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)(
  "integration: hot-reload maxWorkQueueSize change",
  { timeout: 600_000 },
  () => {
    let harness: IntegrationHarness;

    afterEach(async () => {
      if (harness) await harness.shutdown();
    });

    /** Fetch a stats endpoint with Bearer auth. */
    function statsAPI(h: IntegrationHarness, path: string): Promise<Response> {
      return fetch(`http://127.0.0.1:${h.gatewayPort}${path}`, {
        headers: { Authorization: `Bearer ${h.apiKey}` },
      });
    }

    it(
      "hot-reloading maxWorkQueueSize=1 enforces queue cap on subsequent triggers",
      async () => {
        // Start without maxWorkQueueSize (default global cap applies)
        harness = await IntegrationHarness.create({
          agents: [
            {
              name: "queue-reload-agent",
              schedule: "0 0 31 2 *",
              // scale=1 so runner gets busy; test-script sleeps to allow queue buildup
              config: { scale: 1 },
              testScript: [
                "#!/bin/sh",
                "sleep 3",
                "exit 0",
              ].join("\n"),
            },
          ],
        });

        await harness.start();

        // Verify agent works before hot reload
        await harness.triggerAgent("queue-reload-agent");
        const initialRun = await harness.waitForRunResult("queue-reload-agent", 120_000);
        expect(initialRun.result).toBe("completed");

        // --- Hot reload: add maxWorkQueueSize=1 to config.toml ---
        const agentDir = resolve(harness.projectPath, "agents", "queue-reload-agent");
        writeFileSync(
          resolve(agentDir, "config.toml"),
          [
            'models = ["sonnet"]',
            'credentials = ["anthropic_key"]',
            'schedule = "0 0 31 2 *"',
            "scale = 1",
            "maxWorkQueueSize = 1",
          ].join("\n"),
        );

        // Wait for hot reload to detect and apply the change.
        // Poll the pool until it exists and the image rebuild completes
        // (up to 180s). We verify the cap is applied by testing behavior.
        const waitStart = Date.now();
        const waitLimit = 180_000;
        while (Date.now() - waitStart < waitLimit) {
          const pool = harness.getRunnerPool("queue-reload-agent");
          if (pool && pool.size === 1 && !pool.hasRunningJobs) break;
          await new Promise((r) => setTimeout(r, 1_000));
        }

        // Verify hot reload completed (pool is idle and still exists)
        const poolAfterReload = harness.getRunnerPool("queue-reload-agent");
        expect(poolAfterReload).toBeDefined();
        expect(poolAfterReload!.size).toBe(1);

        // --- Test queue cap enforcement after hot reload ---

        // Trigger #1 — dispatched immediately (runner free)
        await harness.triggerAgent("queue-reload-agent");

        // Wait until runner is busy (so subsequent triggers queue)
        await harness.waitForRunning("queue-reload-agent", 60_000);

        // Trigger #2 — queued (queue = 1, at new cap)
        await harness.triggerAgent("queue-reload-agent");
        // Trigger #3 — #2 is dropped (cap=1), #3 is queued
        await harness.triggerAgent("queue-reload-agent");

        // Wait for run #1 (dispatched) to complete
        const run1 = await harness.waitForRunResult("queue-reload-agent", 120_000);
        expect(run1.result).toBe("completed");

        // drainQueues fires the surviving queued item (#3)
        const run2 = await harness.waitForRunResult("queue-reload-agent", 120_000);
        expect(run2.result).toBe("completed");

        // Brief window for any stray third run (should not appear)
        await new Promise((r) => setTimeout(r, 2000));

        // Verify stats: only 3 total runs (initial + run1 + run2), not 4
        // (trigger #2 was dropped after hot reload set maxWorkQueueSize=1)
        const runsRes = await statsAPI(
          harness,
          "/api/stats/agents/queue-reload-agent/runs?limit=10",
        );
        expect(runsRes.ok).toBe(true);
        const runsBody = (await runsRes.json()) as { runs: unknown[]; total: number };
        // 1 initial run + 2 post-reload runs = 3 total (trigger #2 dropped)
        expect(runsBody.total).toBe(3);
      },
    );
  },
);
