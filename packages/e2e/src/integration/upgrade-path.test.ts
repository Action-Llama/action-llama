/**
 * Integration test: verify the deployment upgrade path — start with v1 agent
 * code, then hot-reload to v2 by modifying agent files on disk, and verify
 * that subsequent runs execute with the new code.
 *
 * The hot-reload watcher (watcher.ts) watches agents/ for changes, rebuilds
 * the Docker image, and updates the runner pool — all without restarting the
 * scheduler. This test verifies the full rebuild-and-reload cycle.
 *
 * Covers: COVERAGE-GAPS.md — "Deployment upgrade path"
 */
import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync } from "fs";
import { resolve } from "path";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: deployment upgrade path (hot reload)", { timeout: 600_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("hot-reloads agent when SKILL.md is updated and new run uses updated code", async () => {
    // v1: test-script exits 0 (success), SKILL.md has a "version-1-marker"
    const v1Skill = [
      "---",
      'description: "Upgrade path test agent v1"',
      "---",
      "",
      "# upgrade-agent",
      "",
      "version-1-marker",
    ].join("\n");

    const v1Script = [
      "#!/bin/sh",
      "set -e",
      // Verify SKILL.md is present in the container — it is baked in at build time
      'test -f /app/static/SKILL.md || { echo "SKILL.md not found"; exit 1; }',
      // For v1: just exit successfully
      'echo "upgrade-agent v1: OK"',
      "exit 0",
    ].join("\n");

    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "upgrade-agent",
          schedule: "0 0 31 2 *", // never fires by cron
          testScript: v1Script,
          config: {
            description: "Upgrade path test agent v1",
          },
        },
      ],
    });

    // Override the SKILL.md written by the harness with our versioned content
    const agentDir = resolve(harness.projectPath, "agents", "upgrade-agent");
    writeFileSync(resolve(agentDir, "SKILL.md"), v1Skill);

    await harness.start();

    // --- Run v1 ---
    await harness.triggerAgent("upgrade-agent");
    const runV1 = await harness.waitForRunResult("upgrade-agent", 120_000);
    expect(runV1.result).toBe("completed");

    // --- Upgrade to v2: update SKILL.md and test-script.sh on disk ---
    // The hot-reload watcher will detect changes, rebuild the image, and
    // reload the runner pool. The new image will have v2 files baked in.
    const v2Skill = [
      "---",
      'description: "Upgrade path test agent v2"',
      "---",
      "",
      "# upgrade-agent",
      "",
      "version-2-marker",
    ].join("\n");

    const v2Script = [
      "#!/bin/sh",
      "set -e",
      // Verify the new SKILL.md is baked into the container — proves we're on v2
      'test -f /app/static/SKILL.md || { echo "SKILL.md not found"; exit 1; }',
      'grep -q "version-2-marker" /app/static/SKILL.md || { echo "v2 marker not found in SKILL.md — hot reload did not rebuild image"; exit 1; }',
      'echo "upgrade-agent v2: version-2-marker confirmed in SKILL.md"',
      "exit 0",
    ].join("\n");

    // Write v2 files — this triggers the hot-reload watcher
    writeFileSync(resolve(agentDir, "SKILL.md"), v2Skill);
    writeFileSync(resolve(agentDir, "test-script.sh"), v2Script);

    // Wait for the filesystem watcher debounce (500ms) + Docker image rebuild.
    // We rely on waitForRunResult's timeout to cover the full rebuild duration.
    // The trigger will queue if the rebuild is still in progress and will run
    // once the new image is ready.

    // Poll until the hot reload completes by waiting for the runner pool to
    // become idle (no running jobs), then trigger v2. Allow up to 180s for
    // the rebuild to finish.
    const waitStart = Date.now();
    const waitLimit = 180_000;
    while (Date.now() - waitStart < waitLimit) {
      const pool = harness.getRunnerPool("upgrade-agent");
      if (pool && !pool.hasRunningJobs) {
        // Check if the rebuild finished by trying to trigger — the trigger
        // will queue if still building and run once done.
        break;
      }
      await new Promise((r) => setTimeout(r, 1_000));
    }

    // --- Run v2 ---
    await harness.triggerAgent("upgrade-agent");
    // Use a generous timeout since the trigger may still need to wait for
    // the rebuild to finish before the run starts.
    const runV2 = await harness.waitForRunResult("upgrade-agent", 240_000);
    expect(runV2.result).toBe("completed");
  });

  it("hot-reload handles adding a new agent to a running scheduler", async () => {
    // Start with a single agent, then add a second agent via file system write
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "base-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\necho 'base-agent OK'\nexit 0\n",
        },
      ],
    });

    await harness.start();

    // Trigger and verify the base agent works
    await harness.triggerAgent("base-agent");
    const baseRun = await harness.waitForRunResult("base-agent", 120_000);
    expect(baseRun.result).toBe("completed");

    // Add a brand-new agent directory — the watcher should detect it and
    // register + build the new agent automatically.
    const newAgentDir = resolve(harness.projectPath, "agents", "new-agent");
    const { mkdirSync } = await import("fs");
    mkdirSync(newAgentDir, { recursive: true });

    writeFileSync(
      resolve(newAgentDir, "SKILL.md"),
      [
        "---",
        'description: "Newly added agent"',
        "---",
        "",
        "# new-agent",
        "",
        "This agent was added after the scheduler started.",
      ].join("\n"),
    );

    writeFileSync(
      resolve(newAgentDir, "config.toml"),
      [
        'models = ["sonnet"]',
        'credentials = ["anthropic_key"]',
        'schedule = "0 0 31 2 *"',
      ].join("\n"),
    );

    writeFileSync(
      resolve(newAgentDir, "test-script.sh"),
      "#!/bin/sh\necho 'new-agent dynamically registered'\nexit 0\n",
    );

    // Wait for hot reload to detect and register the new agent (up to 180s for build)
    const waitStart = Date.now();
    const waitLimit = 180_000;
    while (Date.now() - waitStart < waitLimit) {
      const pool = harness.getRunnerPool("new-agent");
      if (pool) break; // New agent registered and pool created
      await new Promise((r) => setTimeout(r, 1_000));
    }

    const newPool = harness.getRunnerPool("new-agent");
    expect(newPool).toBeDefined();

    // Trigger the new agent and verify it runs
    await harness.triggerAgent("new-agent");
    const newRun = await harness.waitForRunResult("new-agent", 240_000);
    expect(newRun.result).toBe("completed");
  });
});
