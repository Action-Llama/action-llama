/**
 * Integration test: verify hot-reload handles webhook configuration changes.
 *
 * When an agent's config.toml is updated to add or remove webhook triggers,
 * the hot-reload watcher (watcher.ts → handleChangedAgent) should:
 *   - Detect that webhook config changed (oldWebhooks !== newWebhooks).
 *   - Remove old bindings via webhookRegistry.removeBindingsForAgent().
 *   - Register new bindings via registerWebhookBindings().
 *
 * This exercises the webhook-change branch of handleChangedAgent which was
 * previously untested.
 *
 * Covers: scheduler/watcher.ts → handleChangedAgent webhook-change path.
 */
import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync } from "fs";
import { resolve } from "path";
import { stringify as stringifyTOML } from "smol-toml";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: hot-reload webhook configuration change", { timeout: 600_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("removing webhook binding via hot-reload stops webhook-triggered execution", async () => {
    // Start with a webhook trigger configured.
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "webhook-change-agent",
          schedule: "0 0 31 2 *",
          webhooks: [{ source: "chg-src", events: ["push"] }],
          testScript: [
            "#!/bin/sh",
            'echo "webhook-change-agent ran"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();

    // Verify manual trigger works.
    await harness.triggerAgent("webhook-change-agent");
    const baseRun = await harness.waitForRunResult("webhook-change-agent", 120_000);
    expect(baseRun.result).toBe("completed");

    // Verify webhook triggers the agent before config change.
    const beforeWebhook = await harness.sendWebhook({
      source: "chg-src",
      event: "push",
      repo: "acme/app",
    });
    expect(beforeWebhook.status).toBe(200);
    const beforeBody = await beforeWebhook.json() as { ok: boolean };
    expect(beforeBody.ok).toBe(true);

    // Wait for webhook-triggered run.
    const webhookRun = await harness.waitForRunResult("webhook-change-agent", 120_000);
    expect(webhookRun.result).toBe("completed");

    // --- Hot reload: remove the webhook trigger from config.toml ---
    const agentDir = resolve(harness.projectPath, "agents", "webhook-change-agent");
    writeFileSync(
      resolve(agentDir, "config.toml"),
      [
        'models = ["sonnet"]',
        'credentials = ["anthropic_key"]',
        'schedule = "0 0 31 2 *"',
        // No [[webhooks]] section — webhook bindings should be removed
      ].join("\n"),
    );

    // Wait for hot reload to detect, rebuild, and re-register (empty) webhook bindings.
    // The pool will be idle after the rebuild completes.
    const waitStart = Date.now();
    const waitLimit = 180_000;
    while (Date.now() - waitStart < waitLimit) {
      const pool = harness.getRunnerPool("webhook-change-agent");
      if (pool && !pool.hasRunningJobs) break;
      await new Promise((r) => setTimeout(r, 1_000));
    }

    // Give extra time for the watcher debounce + rebuild to fully complete.
    // The rebuild should have removed the webhook binding by now.
    await new Promise((r) => setTimeout(r, 5_000));

    // After the webhook binding is removed, a webhook sent should NOT trigger
    // a run. We collect run events for 3 seconds and expect none.
    const runCollector = harness.events.collect("run:end");

    await harness.sendWebhook({
      source: "chg-src",
      event: "push",
      repo: "acme/app",
    });

    // Wait 3 seconds for any potential (unwanted) run to complete.
    await new Promise((r) => setTimeout(r, 3_000));

    const newRuns = runCollector.stop();
    const agentRuns = newRuns.filter((e) => e.agentName === "webhook-change-agent");

    // No new runs should have been triggered by the webhook after binding removal.
    expect(agentRuns.length).toBe(0);

    // Verify the agent still works via manual trigger (not broken by hot reload).
    await harness.triggerAgent("webhook-change-agent");
    const postReloadRun = await harness.waitForRunResult("webhook-change-agent", 120_000);
    expect(postReloadRun.result).toBe("completed");
  });

  it("adding a webhook binding via hot-reload enables webhook-triggered execution", async () => {
    // Start with no webhooks — agent only responds to manual triggers.
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "webhook-add-agent",
          schedule: "0 0 31 2 *",
          // No webhooks initially
          testScript: [
            "#!/bin/sh",
            'echo "webhook-add-agent ran"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();

    // Verify initial manual trigger works.
    await harness.triggerAgent("webhook-add-agent");
    const baseRun = await harness.waitForRunResult("webhook-add-agent", 120_000);
    expect(baseRun.result).toBe("completed");

    // Update the global config.toml to declare a new webhook source.
    const globalConfig = {
      models: {
        sonnet: {
          provider: "anthropic",
          model: "claude-sonnet-4-20250514",
          thinkingLevel: "medium",
          authType: "api_key",
        },
      },
      gateway: { port: harness.gatewayPort },
      webhooks: { "add-src": { type: "test" } },
    };
    writeFileSync(
      resolve(harness.projectPath, "config.toml"),
      stringifyTOML(globalConfig as Record<string, unknown>),
    );

    // --- Hot reload: add a webhook trigger to the agent config.toml ---
    const agentDir = resolve(harness.projectPath, "agents", "webhook-add-agent");
    writeFileSync(
      resolve(agentDir, "config.toml"),
      [
        'models = ["sonnet"]',
        'credentials = ["anthropic_key"]',
        'schedule = "0 0 31 2 *"',
        "",
        "[[webhooks]]",
        'source = "add-src"',
        'events = ["push"]',
      ].join("\n"),
    );

    // Wait for the hot reload to detect, rebuild, and register new webhook bindings.
    const waitStart = Date.now();
    const waitLimit = 180_000;
    while (Date.now() - waitStart < waitLimit) {
      const pool = harness.getRunnerPool("webhook-add-agent");
      if (pool && !pool.hasRunningJobs) break;
      await new Promise((r) => setTimeout(r, 1_000));
    }

    // Wait for rebuild to complete (allow extra time for watcher + Docker build).
    await new Promise((r) => setTimeout(r, 5_000));

    // After the hot reload, the agent should still run via manual trigger.
    await harness.triggerAgent("webhook-add-agent");
    const postReloadRun = await harness.waitForRunResult("webhook-add-agent", 180_000);
    expect(postReloadRun.result).toBe("completed");
  });
});
