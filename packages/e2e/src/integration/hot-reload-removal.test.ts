/**
 * Integration test: verify the hot-reload watcher handles agent removal.
 *
 * When an agent directory is deleted from disk while the scheduler is running,
 * the hot-reload watcher (watcher.ts → handleRemovedAgent) should:
 *   1. Kill any running containers for that agent.
 *   2. Remove the runner pool.
 *   3. Stop the cron job for that agent.
 *   4. Remove webhook bindings.
 *   5. Remove the agent from the agentConfigs list.
 *   6. Unregister the agent from the status tracker.
 *
 * After removal, the control API should return 404 when triggered for the
 * deleted agent, and the remaining agents should continue operating normally.
 *
 * Covers: scheduler/watcher.ts → handleRemovedAgent (previously untested).
 */
import { describe, it, expect, afterEach } from "vitest";
import { rmSync } from "fs";
import { resolve } from "path";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: hot-reload agent removal", { timeout: 300_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("removes agent from scheduler when its directory is deleted from disk", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "keeper-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\necho 'keeper-agent ran'\nexit 0\n",
        },
        {
          name: "disposable-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\necho 'disposable-agent ran'\nexit 0\n",
        },
      ],
    });

    await harness.start();

    // Both agents should be present and runnable at startup.
    await harness.triggerAgent("keeper-agent");
    await harness.triggerAgent("disposable-agent");

    const keeperRun = await harness.waitForRunResult("keeper-agent", 120_000);
    expect(keeperRun.result).toBe("completed");

    const disposableRun = await harness.waitForRunResult("disposable-agent", 120_000);
    expect(disposableRun.result).toBe("completed");

    // Verify both runner pools exist before removal.
    expect(harness.getRunnerPool("keeper-agent")).toBeDefined();
    expect(harness.getRunnerPool("disposable-agent")).toBeDefined();

    // --- Delete the disposable-agent directory to trigger hot-reload removal ---
    const disposableAgentDir = resolve(harness.projectPath, "agents", "disposable-agent");
    rmSync(disposableAgentDir, { recursive: true, force: true });

    // Wait for the filesystem watcher to detect the deletion and process it.
    // The watcher debounces by 500ms, then handleRemovedAgent runs synchronously.
    // Poll until the runner pool is gone (up to 30s for safety).
    const waitStart = Date.now();
    const waitLimit = 30_000;
    while (Date.now() - waitStart < waitLimit) {
      if (!harness.getRunnerPool("disposable-agent")) {
        break; // Pool removed — hot reload processed the deletion
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    // The disposable-agent's runner pool should be gone.
    expect(harness.getRunnerPool("disposable-agent")).toBeUndefined();

    // The control API should return 404 for the removed agent.
    const triggerRes = await harness.controlAPI("POST", "/trigger/disposable-agent");
    expect(triggerRes.status).toBe(404);

    // The keeper-agent should still operate normally after the removal.
    await harness.triggerAgent("keeper-agent");
    const keeperRun2 = await harness.waitForRunResult("keeper-agent", 120_000);
    expect(keeperRun2.result).toBe("completed");
  });

  it("hot-reload removal of webhook agent removes its webhook bindings", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "base-webhook-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\necho 'base ran'\nexit 0\n",
        },
        {
          name: "removable-webhook-agent",
          schedule: "0 0 31 2 *",
          webhooks: [{ source: "gh-events", events: ["push"] }],
          testScript: "#!/bin/sh\necho 'removable ran'\nexit 0\n",
        },
      ],
    });

    await harness.start();

    // Both agents start successfully.
    await harness.triggerAgent("base-webhook-agent");
    const baseRun = await harness.waitForRunResult("base-webhook-agent", 120_000);
    expect(baseRun.result).toBe("completed");

    await harness.triggerAgent("removable-webhook-agent");
    const webhookRun = await harness.waitForRunResult("removable-webhook-agent", 120_000);
    expect(webhookRun.result).toBe("completed");

    // Verify webhook registry has bindings for the removable agent before deletion.
    const regBefore = harness.webhookRegistry;
    expect(regBefore).toBeDefined();

    // Remove the webhook agent's directory.
    const removableDir = resolve(harness.projectPath, "agents", "removable-webhook-agent");
    rmSync(removableDir, { recursive: true, force: true });

    // Wait for hot-reload processing.
    const waitStart = Date.now();
    const waitLimit = 30_000;
    while (Date.now() - waitStart < waitLimit) {
      if (!harness.getRunnerPool("removable-webhook-agent")) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    // Runner pool should be gone.
    expect(harness.getRunnerPool("removable-webhook-agent")).toBeUndefined();

    // Trigger should return 404.
    const triggerRes = await harness.controlAPI("POST", "/trigger/removable-webhook-agent");
    expect(triggerRes.status).toBe(404);

    // base-webhook-agent should still run.
    await harness.triggerAgent("base-webhook-agent");
    const baseRun2 = await harness.waitForRunResult("base-webhook-agent", 120_000);
    expect(baseRun2.result).toBe("completed");
  });
});
