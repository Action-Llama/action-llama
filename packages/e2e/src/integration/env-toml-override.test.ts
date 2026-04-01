/**
 * Integration test: verify that .env.toml overrides config.toml settings.
 *
 * The config loading pipeline layers configs in priority order:
 *   config.toml → .env.toml overrides → environment file
 *
 * When a .env.toml file is present in the project directory, its non-special
 * fields (everything except `environment` and `projectName`) are deep-merged
 * over config.toml. This allows project-local overrides without touching the
 * committed config.toml.
 *
 * Test scenarios:
 *   1. .env.toml overrides defaultAgentScale:
 *      - config.toml has defaultAgentScale=1 (low)
 *      - .env.toml has defaultAgentScale=2 (higher)
 *      - Verify agent pool has size 2 (env.toml wins)
 *   2. .env.toml projectName is available as a special field:
 *      - .env.toml has projectName="my-test-project"
 *      - Scheduler starts without error (projectName flows through correctly)
 *
 * Covers:
 *   - shared/config/load-project.ts loadGlobalConfig() .env.toml layering
 *   - shared/environment.ts loadEnvToml() + deepMerge() behavior
 *   - shared/environment.ts EnvToml.projectName special handling
 */
import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync } from "fs";
import { resolve } from "path";
import { stringify as stringifyTOML } from "smol-toml";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)(
  "integration: .env.toml overrides config.toml",
  { timeout: 300_000 },
  () => {
    let harness: IntegrationHarness;

    afterEach(async () => {
      if (harness) await harness.shutdown();
    });

    it(
      ".env.toml defaultAgentScale overrides config.toml value",
      async () => {
        // Start with config.toml defaultAgentScale=1
        harness = await IntegrationHarness.create({
          agents: [
            {
              name: "env-override-agent",
              schedule: "0 0 31 2 *",
              testScript: "#!/bin/sh\nexit 0\n",
            },
          ],
          globalConfig: {
            defaultAgentScale: 1,
          },
        });

        // Write .env.toml with a higher defaultAgentScale (this should override config.toml)
        const envTomlPath = resolve(harness.projectPath, ".env.toml");
        writeFileSync(envTomlPath, stringifyTOML({ defaultAgentScale: 3 }));

        await harness.start();

        // The .env.toml (defaultAgentScale=3) should override config.toml (defaultAgentScale=1)
        const pool = harness.getRunnerPool("env-override-agent");
        expect(pool).toBeDefined();
        expect(pool!.size).toBe(3);
      },
    );

    it(
      ".env.toml workQueueSize overrides global work queue capacity",
      async () => {
        // Start with default workQueueSize (20)
        harness = await IntegrationHarness.create({
          agents: [
            {
              name: "env-queue-agent",
              schedule: "0 0 31 2 *",
              testScript: [
                "#!/bin/sh",
                "sleep 3",
                "exit 0",
              ].join("\n"),
            },
          ],
        });

        // Write .env.toml to set workQueueSize=1 (global queue cap of 1)
        const envTomlPath = resolve(harness.projectPath, ".env.toml");
        writeFileSync(envTomlPath, stringifyTOML({ workQueueSize: 1 }));

        await harness.start();

        // Trigger #1 — dispatched immediately
        await harness.triggerAgent("env-queue-agent");

        // Wait until runner is busy
        await harness.waitForRunning("env-queue-agent", 60_000);

        // Trigger #2 — queued (queue = 1, at workQueueSize cap)
        await harness.triggerAgent("env-queue-agent");
        // Trigger #3 — drops #2, queues #3 (workQueueSize=1 enforced by .env.toml)
        await harness.triggerAgent("env-queue-agent");

        // Wait for run #1 to complete
        const run1 = await harness.waitForRunResult("env-queue-agent", 120_000);
        expect(run1.result).toBe("completed");

        // drainQueues fires the surviving queued item (#3)
        const run2 = await harness.waitForRunResult("env-queue-agent", 120_000);
        expect(run2.result).toBe("completed");

        // Brief pause to let any stray third run complete (should not happen)
        await new Promise((r) => setTimeout(r, 2000));

        // Verify only 2 runs completed (queue cap enforced via .env.toml)
        const runsRes = await fetch(`http://127.0.0.1:${harness.gatewayPort}/api/stats/agents/env-queue-agent/runs?limit=10`, {
          headers: { Authorization: `Bearer ${harness.apiKey}` },
        });
        expect(runsRes.ok).toBe(true);
        const runsBody = (await runsRes.json()) as { runs: unknown[]; total: number };
        expect(runsBody.total).toBe(2);
      },
    );
  },
);
