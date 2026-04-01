/**
 * Integration test: verify that the global `local.timeout` config field
 * acts as a fallback timeout when agents don't specify their own timeout.
 *
 * Agent timeout resolution order (execution/image-builder.ts):
 *   agentConfig.timeout ?? globalConfig.local?.timeout ?? DEFAULT_AGENT_TIMEOUT
 *
 * When a per-agent timeout is set, it takes precedence over the global
 * `local.timeout`. When no per-agent timeout is set, the global one applies.
 *
 * Test scenarios:
 *   1. No per-agent timeout; global local.timeout=8s; agent sleeps 30s →
 *      agent is killed after 8s → result is "error"
 *   2. Per-agent timeout=10s overrides global local.timeout=120s; agent
 *      sleeps 30s → killed after 10s (not 120s) → result is "error"
 *
 * Covers:
 *   - execution/image-builder.ts timeout fallback chain
 *   - agents/container-runner.ts timeout enforcement with global fallback
 *   - LocalConfig.timeout in GlobalConfig
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)(
  "integration: global local.timeout fallback",
  { timeout: 300_000 },
  () => {
    let harness: IntegrationHarness;

    afterEach(async () => {
      if (harness) await harness.shutdown();
    });

    it(
      "global local.timeout kills agent when no per-agent timeout is set",
      async () => {
        harness = await IntegrationHarness.create({
          agents: [
            {
              name: "global-timeout-agent",
              schedule: "0 0 31 2 *",
              // No per-agent timeout — falls back to global local.timeout=8
              testScript: [
                "#!/bin/sh",
                // Sleep longer than the global timeout
                "sleep 30",
                "exit 0",
              ].join("\n"),
            },
          ],
          globalConfig: {
            local: {
              enabled: true,
              timeout: 8, // 8-second global timeout
            },
          },
        });

        await harness.start();
        await harness.triggerAgent("global-timeout-agent");

        // Agent should be killed by the 8s global timeout
        const run = await harness.waitForRunResult("global-timeout-agent", 90_000);
        expect(run.result).toBe("error");
      },
    );

    it(
      "per-agent timeout overrides global local.timeout",
      async () => {
        harness = await IntegrationHarness.create({
          agents: [
            {
              name: "per-agent-timeout-agent",
              schedule: "0 0 31 2 *",
              config: {
                timeout: 8, // per-agent timeout: 8s (overrides global 120s)
              },
              testScript: [
                "#!/bin/sh",
                // Sleep longer than per-agent timeout but shorter than global
                "sleep 30",
                "exit 0",
              ].join("\n"),
            },
          ],
          globalConfig: {
            local: {
              enabled: true,
              timeout: 120, // generous global timeout (should NOT be used)
            },
          },
        });

        await harness.start();
        await harness.triggerAgent("per-agent-timeout-agent");

        // Should be killed by 8s per-agent timeout (not 120s global)
        const run = await harness.waitForRunResult("per-agent-timeout-agent", 90_000);
        expect(run.result).toBe("error");
      },
    );
  },
);
