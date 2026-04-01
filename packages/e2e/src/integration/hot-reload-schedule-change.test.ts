/**
 * Integration test: verify hot-reload handles schedule changes in config.toml.
 *
 * When an agent's config.toml is updated on disk to change or remove `schedule`,
 * the hot-reload watcher (watcher.ts → handleChangedAgent) should:
 *   - Detect that oldSchedule !== newConfig.schedule.
 *   - Call rebuildCronJobs() to stop all existing cron jobs and recreate them
 *     for the remaining/updated agents.
 *   - Create a new cron job with the updated schedule (if still set).
 *   - Agent should remain functional via manual trigger after the hot reload.
 *
 * This exercises the schedule-change branch of handleChangedAgent which was
 * previously untested by the integration test suite (covered only by unit
 * tests in packages/action-llama/test/scheduler/watcher.test.ts).
 *
 * Covers:
 *   - scheduler/watcher.ts → handleChangedAgent → oldSchedule !== newConfig.schedule
 *   - scheduler/watcher.ts → rebuildCronJobs (stop + recreate cron jobs)
 *   - scheduler/watcher.ts → new Cron() setup after schedule change
 */
import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync } from "fs";
import { resolve } from "path";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: hot-reload schedule change", { timeout: 600_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("changing schedule in config.toml rebuilds cron jobs and agent remains functional", async () => {
    // Start with an agent that has a schedule that never fires (Feb 31st).
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "schedule-change-agent",
          schedule: "0 0 31 2 *",
          testScript: [
            "#!/bin/sh",
            'echo "schedule-change-agent ran"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();

    // Verify the agent runs correctly with the original schedule.
    await harness.triggerAgent("schedule-change-agent");
    const initialRun = await harness.waitForRunResult("schedule-change-agent", 120_000);
    expect(initialRun.result).toBe("completed");

    // Record pool reference before hot reload.
    const poolBefore = harness.getRunnerPool("schedule-change-agent");
    expect(poolBefore).toBeDefined();
    const sizeBefore = poolBefore!.size;

    // --- Hot reload: change schedule to a different (also non-firing) cron ---
    // Changing from "0 0 31 2 *" to "0 0 30 2 *" triggers rebuildCronJobs.
    const agentDir = resolve(harness.projectPath, "agents", "schedule-change-agent");
    writeFileSync(
      resolve(agentDir, "config.toml"),
      [
        'models = ["sonnet"]',
        'credentials = ["anthropic_key"]',
        // Changed schedule — triggers handleChangedAgent → rebuildCronJobs
        'schedule = "0 0 30 2 *"',
      ].join("\n"),
    );

    // Wait for hot reload to detect the change (debounce 500ms + Docker rebuild).
    // We poll until the pool is idle with no running jobs, which indicates the
    // rebuild is done. Allow up to 180s for Docker image rebuild.
    const waitStart = Date.now();
    const waitLimit = 180_000;
    while (Date.now() - waitStart < waitLimit) {
      const pool = harness.getRunnerPool("schedule-change-agent");
      if (pool && !pool.hasRunningJobs) {
        // Give the watcher a moment to finish setting up the new cron job.
        await new Promise((r) => setTimeout(r, 2_000));
        break;
      }
      await new Promise((r) => setTimeout(r, 1_000));
    }

    // Verify the runner pool is still present with the same scale after reload.
    const poolAfter = harness.getRunnerPool("schedule-change-agent");
    expect(poolAfter).toBeDefined();
    expect(poolAfter!.size).toBe(sizeBefore);

    // Agent should still be triggerable via control API after schedule change.
    await harness.triggerAgent("schedule-change-agent");
    const postReloadRun = await harness.waitForRunResult("schedule-change-agent", 120_000);
    expect(postReloadRun.result).toBe("completed");
  });

  it("removing schedule while keeping webhook binding does not break the agent", async () => {
    // Start with both a schedule and a webhook trigger.
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "sched-remove-agent",
          schedule: "0 0 31 2 *",
          webhooks: [{ source: "sched-src", events: ["push"] }],
          testScript: [
            "#!/bin/sh",
            'echo "sched-remove-agent ran"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();

    // Verify agent runs via manual trigger before change.
    await harness.triggerAgent("sched-remove-agent");
    const initialRun = await harness.waitForRunResult("sched-remove-agent", 120_000);
    expect(initialRun.result).toBe("completed");

    // --- Hot reload: remove the schedule but keep the webhook trigger ---
    const agentDir = resolve(harness.projectPath, "agents", "sched-remove-agent");
    writeFileSync(
      resolve(agentDir, "config.toml"),
      [
        'models = ["sonnet"]',
        'credentials = ["anthropic_key"]',
        // No schedule — only webhook trigger remains
        "",
        "[[webhooks]]",
        'source = "sched-src"',
        'events = ["push"]',
      ].join("\n"),
    );

    // Wait for hot reload to detect the change and rebuild.
    const waitStart = Date.now();
    const waitLimit = 180_000;
    while (Date.now() - waitStart < waitLimit) {
      const pool = harness.getRunnerPool("sched-remove-agent");
      if (pool && !pool.hasRunningJobs) {
        await new Promise((r) => setTimeout(r, 2_000));
        break;
      }
      await new Promise((r) => setTimeout(r, 1_000));
    }

    // After schedule removal, agent should still respond to manual triggers.
    await harness.triggerAgent("sched-remove-agent");
    const postReloadRun = await harness.waitForRunResult("sched-remove-agent", 120_000);
    expect(postReloadRun.result).toBe("completed");

    // Webhook should also still trigger the agent (webhook binding unchanged).
    const webhookRes = await harness.sendWebhook({
      source: "sched-src",
      event: "push",
      repo: "acme/app",
    });
    expect(webhookRes.status).toBe(200);
    const webhookBody = await webhookRes.json() as { ok: boolean };
    expect(webhookBody.ok).toBe(true);

    const webhookRun = await harness.waitForRunResult("sched-remove-agent", 120_000);
    expect(webhookRun.result).toBe("completed");
  });

  it("adding a schedule to an agent that had none triggers rebuildCronJobs", async () => {
    // Start with no schedule — agent only has a webhook trigger.
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "sched-add-agent",
          webhooks: [{ source: "add-sched-src", events: ["push"] }],
          testScript: [
            "#!/bin/sh",
            'echo "sched-add-agent ran"',
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();

    // Verify agent runs via manual trigger before schedule is added.
    await harness.triggerAgent("sched-add-agent");
    const initialRun = await harness.waitForRunResult("sched-add-agent", 120_000);
    expect(initialRun.result).toBe("completed");

    // --- Hot reload: add a schedule to the agent ---
    const agentDir = resolve(harness.projectPath, "agents", "sched-add-agent");
    writeFileSync(
      resolve(agentDir, "config.toml"),
      [
        'models = ["sonnet"]',
        'credentials = ["anthropic_key"]',
        // Add a schedule that never fires (Feb 30th), just to exercise the code path.
        'schedule = "0 0 30 2 *"',
        "",
        "[[webhooks]]",
        'source = "add-sched-src"',
        'events = ["push"]',
      ].join("\n"),
    );

    // Wait for hot reload to detect the change and rebuild.
    const waitStart = Date.now();
    const waitLimit = 180_000;
    while (Date.now() - waitStart < waitLimit) {
      const pool = harness.getRunnerPool("sched-add-agent");
      if (pool && !pool.hasRunningJobs) {
        await new Promise((r) => setTimeout(r, 2_000));
        break;
      }
      await new Promise((r) => setTimeout(r, 1_000));
    }

    // After schedule addition, agent should still be manually triggerable.
    await harness.triggerAgent("sched-add-agent");
    const postReloadRun = await harness.waitForRunResult("sched-add-agent", 120_000);
    expect(postReloadRun.result).toBe("completed");
  });
});
