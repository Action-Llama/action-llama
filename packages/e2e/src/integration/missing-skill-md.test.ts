/**
 * Integration test: verify that the scheduler correctly rejects startup when
 * an agent directory exists but has no SKILL.md file.
 *
 * In discoverAgents(), only directories containing SKILL.md are returned.
 * However, if an agent directory is discovered (has SKILL.md at discovery time)
 * but then SKILL.md is removed before loadAgentConfig() runs, it throws
 * ConfigError("Agent config not found at <skillPath>").
 *
 * More practically: if an agent directory is created manually without SKILL.md,
 * discoverAgents() won't discover it — it's effectively invisible.
 *
 * This test verifies that an agent with only config.toml but no SKILL.md is
 * not discovered and does not cause startup failures; the scheduler only
 * discovers agents that have SKILL.md.
 *
 * Covers:
 *   - shared/config/load-agent.ts: discoverAgents() only returns dirs with SKILL.md
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { stringify as stringifyTOML } from "smol-toml";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: agent without SKILL.md is not discovered", { timeout: 120_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) {
      try { await harness.shutdown(); } catch {}
    }
  });

  it("agent directory without SKILL.md is ignored by discoverAgents", async () => {
    // Create a harness with one valid agent (has SKILL.md)
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "valid-skill-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\necho 'valid agent ran'\nexit 0\n",
        },
      ],
    });

    // Create a "ghost" agent directory with config.toml but NO SKILL.md
    // discoverAgents() requires SKILL.md — this directory should be ignored.
    const ghostDir = resolve(harness.projectPath, "agents", "ghost-agent-no-skill");
    mkdirSync(ghostDir, { recursive: true });
    writeFileSync(
      resolve(ghostDir, "config.toml"),
      stringifyTOML({
        models: ["sonnet"],
        credentials: ["anthropic_key"],
        schedule: "0 0 31 2 *",
      }),
    );
    // Note: intentionally NOT writing SKILL.md to ghost-agent-no-skill/

    // Scheduler should start successfully — ghost-agent-no-skill is ignored
    await expect(harness.start()).resolves.toBeUndefined();

    // The valid agent should be discoverable and runnable
    await harness.triggerAgent("valid-skill-agent");
    const run = await harness.waitForRunResult("valid-skill-agent", 120_000);
    expect(run.result).toBe("completed");

    // The ghost agent should not be in the runner pools
    const ghostPool = harness.getRunnerPool("ghost-agent-no-skill");
    expect(ghostPool).toBeUndefined();
  });
});
