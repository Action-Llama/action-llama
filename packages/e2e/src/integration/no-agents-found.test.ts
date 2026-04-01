/**
 * Integration test: verify that the scheduler correctly rejects startup when
 * no agents are found in the project directory.
 *
 * During startup, validateAndDiscover() calls discoverAgents() to find agent
 * directories. If no directories with SKILL.md exist under agents/, it throws
 * ConfigError("No agents found. Run 'al new' to create a project with agents.").
 *
 * Covers:
 *   - scheduler/validation.ts: validateAndDiscover() → agentNames.length === 0 path
 *   - shared/config/load-agent.ts: discoverAgents() returns empty array
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: no agents found startup rejection", { timeout: 120_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) {
      try { await harness.shutdown(); } catch {}
    }
  });

  it("scheduler startup fails when no agents are configured in the project", async () => {
    // Create a harness with an empty agents array.
    // No agent directories will be created, so discoverAgents() returns [].
    // validateAndDiscover() throws ConfigError("No agents found...").
    harness = await IntegrationHarness.create({
      agents: [],
    });

    let startError: Error | undefined;
    try {
      await harness.start();
    } catch (err) {
      startError = err instanceof Error ? err : new Error(String(err));
    }

    // Startup should fail due to no agents found
    expect(startError).toBeDefined();
    // Error message should mention "agents" or "al new"
    expect(startError!.message).toMatch(/no agents|al new|agents found/i);
  });
});
