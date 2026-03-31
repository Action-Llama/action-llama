/**
 * Integration test: verify hot-reload handles scale changes in config.toml.
 *
 * When an agent's config.toml is updated on disk to change `scale`, the
 * hot-reload watcher (watcher.ts → handleChangedAgent) should:
 *   - Rebuild the Docker image (always on any config change).
 *   - Add new runners when scale increases (newScale > oldScale path).
 *   - Remove excess runners when scale decreases (newScale < oldScale path).
 *
 * After a scale increase, the runner pool should have more runners and be able
 * to execute concurrent runs. After a scale decrease, the pool shrinks.
 *
 * Covers: scheduler/watcher.ts → handleChangedAgent scale-change paths
 * (previously untested: addRunner / shrinkTo calls).
 */
import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync } from "fs";
import { resolve } from "path";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: hot-reload scale change", { timeout: 600_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("increasing scale in config.toml adds runners and enables concurrent execution", async () => {
    // Start with scale=1: only one runner, so concurrent triggers queue.
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "scale-up-agent",
          schedule: "0 0 31 2 *",
          config: { scale: 1 },
          testScript: [
            "#!/bin/sh",
            // Short sleep to allow concurrency detection
            "sleep 3",
            "exit 0",
          ].join("\n"),
        },
      ],
    });

    await harness.start();

    // Verify initial scale=1
    await harness.triggerAgent("scale-up-agent");
    const initialRun = await harness.waitForRunResult("scale-up-agent", 120_000);
    expect(initialRun.result).toBe("completed");

    const poolBefore = harness.getRunnerPool("scale-up-agent");
    expect(poolBefore).toBeDefined();
    expect(poolBefore!.size).toBe(1);

    // --- Hot reload: update config.toml to scale=2 ---
    const agentDir = resolve(harness.projectPath, "agents", "scale-up-agent");
    writeFileSync(
      resolve(agentDir, "config.toml"),
      [
        'models = ["sonnet"]',
        'credentials = ["anthropic_key"]',
        'schedule = "0 0 31 2 *"',
        "scale = 2",
      ].join("\n"),
    );

    // Wait for hot reload to detect the change (debounce 500ms + rebuild time).
    // Poll until the pool has 2 runners (up to 180s for Docker image rebuild).
    const waitStart = Date.now();
    const waitLimit = 180_000;
    while (Date.now() - waitStart < waitLimit) {
      const pool = harness.getRunnerPool("scale-up-agent");
      if (pool && pool.size === 2) break;
      await new Promise((r) => setTimeout(r, 1_000));
    }

    const poolAfter = harness.getRunnerPool("scale-up-agent");
    expect(poolAfter).toBeDefined();
    expect(poolAfter!.size).toBe(2);

    // Verify concurrent execution: trigger 2 runs simultaneously.
    // With scale=2, both should start immediately and complete concurrently.
    const startTime = Date.now();

    await harness.triggerAgent("scale-up-agent");
    await harness.triggerAgent("scale-up-agent");

    const [run1, run2] = await Promise.all([
      harness.waitForRunResult("scale-up-agent", 60_000),
      harness.waitForRunResult("scale-up-agent", 60_000),
    ]);

    const elapsed = Date.now() - startTime;

    expect(run1.result).toBe("completed");
    expect(run2.result).toBe("completed");

    // Both ran concurrently: total elapsed should be less than 2 sequential runs (6s).
    // Allow generous budget for container startup overhead.
    expect(elapsed).toBeLessThan(12_000);
  });

  it("decreasing scale in config.toml shrinks the runner pool", async () => {
    // Start with scale=2: two runners for parallel execution.
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "scale-down-agent",
          schedule: "0 0 31 2 *",
          config: { scale: 2 },
          testScript: "#!/bin/sh\necho 'scale-down-agent ran'\nexit 0\n",
        },
      ],
    });

    await harness.start();

    // Verify initial scale=2
    await harness.triggerAgent("scale-down-agent");
    const initialRun = await harness.waitForRunResult("scale-down-agent", 120_000);
    expect(initialRun.result).toBe("completed");

    const poolBefore = harness.getRunnerPool("scale-down-agent");
    expect(poolBefore).toBeDefined();
    expect(poolBefore!.size).toBe(2);

    // --- Hot reload: update config.toml to scale=1 ---
    const agentDir = resolve(harness.projectPath, "agents", "scale-down-agent");
    writeFileSync(
      resolve(agentDir, "config.toml"),
      [
        'models = ["sonnet"]',
        'credentials = ["anthropic_key"]',
        'schedule = "0 0 31 2 *"',
        "scale = 1",
      ].join("\n"),
    );

    // Wait for hot reload to detect the change and shrink the pool.
    const waitStart = Date.now();
    const waitLimit = 180_000;
    while (Date.now() - waitStart < waitLimit) {
      const pool = harness.getRunnerPool("scale-down-agent");
      if (pool && pool.size === 1) break;
      await new Promise((r) => setTimeout(r, 1_000));
    }

    const poolAfter = harness.getRunnerPool("scale-down-agent");
    expect(poolAfter).toBeDefined();
    expect(poolAfter!.size).toBe(1);

    // Agent should still run after scale reduction.
    await harness.triggerAgent("scale-down-agent");
    const finalRun = await harness.waitForRunResult("scale-down-agent", 120_000);
    expect(finalRun.result).toBe("completed");
  });
});
