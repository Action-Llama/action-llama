/**
 * Integration test: per-agent maxWorkQueueSize cap enforcement.
 *
 * When `maxWorkQueueSize` is set in an agent's config.toml, the scheduler
 * limits how many items can be queued for that agent. If the queue is at
 * capacity when a new item arrives, the oldest queued item is silently
 * dropped and the newest item takes its place.
 *
 * Test scenario:
 *   1. Agent with scale=1 and maxWorkQueueSize=1; test-script sleeps 3 s.
 *   2. Trigger #1 — dispatched immediately to the single runner.
 *   3. Wait until the runner pool shows a running job (ensures #1 is in-flight).
 *   4. Trigger #2 — queued (queue now at capacity: 1 item).
 *   5. Trigger #3 — oldest queued item (#2) is dropped; #3 takes its place.
 *   6. Wait for trigger #1 to complete.
 *   7. drainQueues fires trigger #3 (the surviving queued item).
 *   8. Wait for trigger #3 to complete.
 *   9. Assert stats show exactly 2 completed runs (not 3), confirming
 *      trigger #2 was dropped due to the queue cap.
 *
 * Covers: SqliteWorkQueue.setAgentMaxSize() / MemoryWorkQueue overflow path,
 * dispatchOrQueue() "all-busy" → enqueue path, drainQueues() after run
 * completes, and the maxWorkQueueSize config field end-to-end pipeline
 * (scheduler/index.ts → workQueue.setAgentMaxSize → enqueue overflow).
 */
import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, readFileSync } from "fs";
import { resolve } from "path";
import { stringify as stringifyTOML, parse as parseTOML } from "smol-toml";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)(
  "integration: per-agent work queue cap (maxWorkQueueSize)",
  { timeout: 300_000 },
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
      "drops oldest queued item when maxWorkQueueSize=1 is exceeded",
      async () => {
        // Create harness with a slow agent (scale=1, sleeps 3s per run)
        harness = await IntegrationHarness.create({
          agents: [
            {
              name: "queue-cap-agent",
              schedule: "0 0 31 2 *", // never fires by cron
              testScript: [
                "#!/bin/sh",
                // Sleep so triggers #2 and #3 arrive while #1 is still running
                "sleep 3",
                "exit 0",
              ].join("\n"),
            },
          ],
        });

        // Inject maxWorkQueueSize=1 into the agent's config.toml before start.
        // The harness does not expose this field directly, so we patch the TOML
        // file on disk while the scheduler hasn't loaded it yet.
        const agentConfigPath = resolve(
          harness.projectPath,
          "agents",
          "queue-cap-agent",
          "config.toml",
        );
        const existingToml = parseTOML(readFileSync(agentConfigPath, "utf-8")) as Record<
          string,
          unknown
        >;
        existingToml.maxWorkQueueSize = 1;
        writeFileSync(agentConfigPath, stringifyTOML(existingToml));

        await harness.start();

        // Trigger #1 — should dispatch immediately to the single runner
        await harness.triggerAgent("queue-cap-agent");

        // Wait until the runner pool reports a running job before sending #2/#3.
        // This guarantees the runner is marked "busy" so subsequent triggers queue.
        await harness.waitForRunning("queue-cap-agent", 60_000);

        // Trigger #2 — should be queued (queue = 1, at cap)
        await harness.triggerAgent("queue-cap-agent");

        // Trigger #3 — queue is at cap; #2 should be dropped and #3 queued instead
        await harness.triggerAgent("queue-cap-agent");

        // Wait for trigger #1 to complete
        const run1 = await harness.waitForRunResult("queue-cap-agent", 120_000);
        expect(run1.result).toBe("completed");

        // drainQueues fires the surviving queued item (trigger #3).
        // Wait for it to complete.
        const run2 = await harness.waitForRunResult("queue-cap-agent", 120_000);
        expect(run2.result).toBe("completed");

        // Allow a brief window for any stray third run to appear (should not)
        await new Promise((r) => setTimeout(r, 2000));

        // Verify stats: exactly 2 completed runs recorded (trigger #2 was dropped)
        const runsRes = await statsAPI(
          harness,
          "/api/stats/agents/queue-cap-agent/runs?limit=10",
        );
        expect(runsRes.ok).toBe(true);
        const runsBody = (await runsRes.json()) as {
          runs: unknown[];
          total: number;
        };
        // Queue cap enforcement: trigger #2 was dropped, so only 2 runs complete
        expect(runsBody.total).toBe(2);
      },
    );
  },
);
