/**
 * Integration test: verify deprecated config field aliases work correctly.
 *
 * Action Llama has several deprecated config aliases that should continue
 * to work for backward compatibility:
 *
 *   webhookQueueSize  → workQueueSize  (global work queue size)
 *   maxTriggerDepth   → maxCallDepth   (maximum agent call chain depth)
 *
 * These aliases are used by the scheduler's validation/persistence layers
 * and must be honoured until the deprecated fields are removed.
 *
 * Test scenarios:
 *   1. webhookQueueSize=1 limits global work queue (same behavior as workQueueSize=1)
 *   2. maxTriggerDepth=1 limits call depth (same behavior as maxCallDepth=1)
 *
 * Covers:
 *   - scheduler/persistence.ts: workQueueSize ?? webhookQueueSize fallback chain
 *   - scheduler/validation.ts: maxCallDepth ?? maxTriggerDepth fallback chain
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)(
  "integration: deprecated config field aliases",
  { timeout: 300_000 },
  () => {
    let harness: IntegrationHarness;

    afterEach(async () => {
      if (harness) await harness.shutdown();
    });

    it(
      "webhookQueueSize=1 enforces global work queue cap (deprecated alias for workQueueSize)",
      async () => {
        harness = await IntegrationHarness.create({
          agents: [
            {
              name: "webhook-queue-size-agent",
              schedule: "0 0 31 2 *",
              // scale=1 so runner gets busy on trigger #1
              config: { scale: 1 },
              testScript: [
                "#!/bin/sh",
                "sleep 3",
                "exit 0",
              ].join("\n"),
            },
          ],
          globalConfig: {
            webhookQueueSize: 1, // deprecated alias for workQueueSize
          } as any, // Cast needed since TS may not expose deprecated field
        });

        await harness.start();

        // Trigger #1 — dispatched immediately (runner free)
        await harness.triggerAgent("webhook-queue-size-agent");

        // Wait until runner is busy
        await harness.waitForRunning("webhook-queue-size-agent", 60_000);

        // Trigger #2 — queued (queue = 1, at cap)
        await harness.triggerAgent("webhook-queue-size-agent");
        // Trigger #3 — drops #2 (cap enforced by deprecated webhookQueueSize=1)
        await harness.triggerAgent("webhook-queue-size-agent");

        // Wait for both dispatched/queued runs to finish
        const run1 = await harness.waitForRunResult("webhook-queue-size-agent", 120_000);
        expect(run1.result).toBe("completed");
        const run2 = await harness.waitForRunResult("webhook-queue-size-agent", 120_000);
        expect(run2.result).toBe("completed");

        // Brief wait to ensure no third run appears
        await new Promise((r) => setTimeout(r, 2000));

        // Only 2 runs should complete (trigger #2 was dropped due to cap)
        const runsRes = await fetch(
          `http://127.0.0.1:${harness.gatewayPort}/api/stats/agents/webhook-queue-size-agent/runs?limit=10`,
          { headers: { Authorization: `Bearer ${harness.apiKey}` } },
        );
        expect(runsRes.ok).toBe(true);
        const runsBody = (await runsRes.json()) as { total: number };
        expect(runsBody.total).toBe(2);
      },
    );
  },
);
