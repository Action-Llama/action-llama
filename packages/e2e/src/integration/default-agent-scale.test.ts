/**
 * Integration test: verify that the global `defaultAgentScale` config field
 * is applied as a fallback scale when agents don't specify their own scale.
 *
 * `defaultAgentScale` in the root config.toml sets the default number of
 * parallel runners for every agent that has no explicit `scale` in its own
 * config.toml. Agents that do specify `scale` are unaffected.
 *
 * Test scenarios:
 *   1. Two agents with no explicit scale; defaultAgentScale=2 in global config
 *      → each agent should have a runner pool of size 2 (can run 2 jobs in
 *        parallel without queuing).
 *   2. Agent with explicit scale=1 alongside defaultAgentScale=3 → that agent
 *      keeps scale=1, other agents get scale=3.
 *
 * Covers:
 *   - shared/config/load-agent.ts defaultAgentScale fallback logic
 *   - scale-reconciliation.ts enforceProjectScaleCap with defaultAgentScale
 *   - runner-setup.ts createRunnerPools with non-default scale
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)(
  "integration: global defaultAgentScale config field",
  { timeout: 300_000 },
  () => {
    let harness: IntegrationHarness;

    afterEach(async () => {
      if (harness) await harness.shutdown();
    });

    it(
      "defaultAgentScale=2 gives each agent without explicit scale a pool of 2 runners",
      async () => {
        harness = await IntegrationHarness.create({
          agents: [
            {
              name: "default-scale-a",
              schedule: "0 0 31 2 *",
              // No explicit scale — should inherit defaultAgentScale=2
              testScript: [
                "#!/bin/sh",
                "sleep 3",
                "exit 0",
              ].join("\n"),
            },
            {
              name: "default-scale-b",
              schedule: "0 0 31 2 *",
              // No explicit scale — should inherit defaultAgentScale=2
              testScript: [
                "#!/bin/sh",
                "sleep 3",
                "exit 0",
              ].join("\n"),
            },
          ],
          globalConfig: {
            defaultAgentScale: 2,
          },
        });

        await harness.start();

        // Verify each agent pool has exactly 2 runners
        const poolA = harness.getRunnerPool("default-scale-a");
        const poolB = harness.getRunnerPool("default-scale-b");

        expect(poolA).toBeDefined();
        expect(poolB).toBeDefined();
        expect(poolA!.size).toBe(2);
        expect(poolB!.size).toBe(2);

        // Functional verification: trigger both agents twice concurrently.
        // With scale=2 each agent can run both jobs in parallel without queuing.
        await harness.triggerAgent("default-scale-a");
        await harness.triggerAgent("default-scale-a");
        await harness.triggerAgent("default-scale-b");
        await harness.triggerAgent("default-scale-b");

        // All 4 runs should complete (2 per agent in parallel)
        const [runA1, runA2, runB1, runB2] = await Promise.all([
          harness.waitForRunResult("default-scale-a", 120_000),
          harness.waitForRunResult("default-scale-a", 120_000),
          harness.waitForRunResult("default-scale-b", 120_000),
          harness.waitForRunResult("default-scale-b", 120_000),
        ]);

        expect(runA1.result).toBe("completed");
        expect(runA2.result).toBe("completed");
        expect(runB1.result).toBe("completed");
        expect(runB2.result).toBe("completed");
      },
    );

    it(
      "explicit per-agent scale overrides defaultAgentScale",
      async () => {
        harness = await IntegrationHarness.create({
          agents: [
            {
              name: "explicit-scale-agent",
              schedule: "0 0 31 2 *",
              config: { scale: 1 }, // explicit scale=1, ignores defaultAgentScale
              testScript: "#!/bin/sh\nexit 0\n",
            },
            {
              name: "inherited-scale-agent",
              schedule: "0 0 31 2 *",
              // No explicit scale — should get defaultAgentScale=3
              testScript: "#!/bin/sh\nexit 0\n",
            },
          ],
          globalConfig: {
            defaultAgentScale: 3,
          },
        });

        await harness.start();

        // explicit-scale-agent should have scale=1 (its own config overrides)
        const explicitPool = harness.getRunnerPool("explicit-scale-agent");
        expect(explicitPool).toBeDefined();
        expect(explicitPool!.size).toBe(1);

        // inherited-scale-agent should have scale=3 (from defaultAgentScale)
        const inheritedPool = harness.getRunnerPool("inherited-scale-agent");
        expect(inheritedPool).toBeDefined();
        expect(inheritedPool!.size).toBe(3);

        // Verify both agents can actually execute
        await harness.triggerAgent("explicit-scale-agent");
        await harness.triggerAgent("inherited-scale-agent");

        const runExplicit = await harness.waitForRunResult("explicit-scale-agent", 120_000);
        const runInherited = await harness.waitForRunResult("inherited-scale-agent", 120_000);

        expect(runExplicit.result).toBe("completed");
        expect(runInherited.result).toBe("completed");
      },
    );
  },
);
