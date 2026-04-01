/**
 * Integration test: hot-reload gracefully handles a newly added agent with
 * an invalid config.toml.
 *
 * When a new agent directory appears on disk while the scheduler is running,
 * the hot-reload watcher (watcher.ts → handleNewAgent) calls
 * loadAgentConfig() and validateAgentConfig(). If the config is invalid
 * (e.g., missing schedule and webhooks), the watcher logs an error and
 * does NOT register the agent — but the scheduler keeps running.
 *
 * Test scenario:
 *   1. Start with one valid agent.
 *   2. Create a second agent directory with an invalid config (no schedule,
 *      no webhooks) to trigger the handleNewAgent error path.
 *   3. Verify the scheduler is still healthy (gateway /health returns ok).
 *   4. Verify the invalid agent is NOT registerable via the control API.
 *   5. The original valid agent continues to work.
 *
 * Covers: scheduler/watcher.ts handleNewAgent() error branch
 *         ("hot reload: invalid agent config", line 171).
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)(
  "integration: hot-reload handles new agent with invalid config",
  { timeout: 300_000 },
  () => {
    let harness: IntegrationHarness;

    afterEach(async () => {
      if (harness) await harness.shutdown();
    });

    it("scheduler survives hot-reload when a new agent directory has invalid config", async () => {
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "existing-valid-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\necho 'existing agent ran'\nexit 0\n",
          },
        ],
      });

      await harness.start();

      // Verify the original agent works
      await harness.triggerAgent("existing-valid-agent");
      const runBefore = await harness.waitForRunResult("existing-valid-agent", 120_000);
      expect(runBefore.result).toBe("completed");

      // --- Add a new agent directory with invalid config ---
      // An agent with no schedule and no webhooks is invalid per validateAgentConfig().
      const invalidAgentDir = resolve(harness.projectPath, "agents", "invalid-new-agent");
      mkdirSync(invalidAgentDir, { recursive: true });

      writeFileSync(
        resolve(invalidAgentDir, "SKILL.md"),
        "---\ndescription: Invalid test agent\n---\n\n# invalid-new-agent\n\nThis agent has no triggers.\n",
      );

      // config.toml with no schedule and no webhooks — validateAgentConfig throws
      writeFileSync(
        resolve(invalidAgentDir, "config.toml"),
        'models = ["sonnet"]\ncredentials = ["anthropic_key"]\n',
      );

      writeFileSync(
        resolve(invalidAgentDir, "test-script.sh"),
        "#!/bin/sh\necho 'invalid-new-agent ran'\nexit 0\n",
      );

      // Wait for watcher to process the new directory (debounce 500ms + validation)
      await new Promise((r) => setTimeout(r, 2_000));

      // Scheduler must still be healthy despite the invalid new agent
      const healthRes = await fetch(`http://127.0.0.1:${harness.gatewayPort}/health`);
      expect(healthRes.ok).toBe(true);
      const healthBody = (await healthRes.json()) as { status: string };
      expect(healthBody.status).toBe("ok");

      // The invalid agent should NOT be triggerable (pool not created)
      const triggerRes = await fetch(
        `http://127.0.0.1:${harness.gatewayPort}/control/trigger/invalid-new-agent`,
        { method: "POST", headers: { Authorization: `Bearer ${harness.apiKey}` } },
      );
      // Should be 404 (agent not found in pools) or 409 (scale=0)
      expect(triggerRes.status).toBeGreaterThanOrEqual(400);

      // The original agent must still work
      await harness.triggerAgent("existing-valid-agent");
      const runAfter = await harness.waitForRunResult("existing-valid-agent", 120_000);
      expect(runAfter.result).toBe("completed");
    });
  },
);
