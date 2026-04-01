/**
 * Integration test: verify that the scheduler correctly rejects startup when
 * an agent references a model name that is not defined in the global config.
 *
 * During startup, loadAgentConfig() resolves each model name in the agent's
 * config.toml against the [models.*] table in the project's config.toml.
 * If a model name is not found, a ConfigError is thrown.
 *
 * Covers:
 *   - shared/config/load-agent.ts: model resolution throws ConfigError when
 *     agent references an undefined model name
 *   - scheduler startup failure on undefined model reference
 */
import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync } from "fs";
import { resolve } from "path";
import { stringify as stringifyTOML } from "smol-toml";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: undefined model reference startup rejection", { timeout: 120_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) {
      try { await harness.shutdown(); } catch {}
    }
  });

  it("scheduler startup fails when an agent references a model not in global config", async () => {
    // Create the harness normally (agent config.toml has models=["sonnet"])
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "bad-model-ref-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    // After harness creation, overwrite the agent's config.toml to reference
    // a model name that does NOT exist in the global config.toml.
    // The global config only defines "sonnet" (from makeModel()), so
    // "nonexistent-model-xyz" will not be found.
    const agentDir = resolve(harness.projectPath, "agents", "bad-model-ref-agent");
    writeFileSync(
      resolve(agentDir, "config.toml"),
      stringifyTOML({
        models: ["nonexistent-model-xyz"],
        credentials: ["anthropic_key"],
        schedule: "0 0 31 2 *",
      }),
    );

    // Startup should fail because loadAgentConfig() cannot resolve "nonexistent-model-xyz"
    let startError: Error | undefined;
    try {
      await harness.start();
    } catch (err) {
      startError = err instanceof Error ? err : new Error(String(err));
    }

    expect(startError).toBeDefined();
    // The error should mention the missing model name
    expect(startError!.message).toMatch(/nonexistent-model-xyz|model.*not defined|undefined model/i);
  });

  it("scheduler starts successfully when all model references are valid", async () => {
    // Positive case: agent references "sonnet" which IS in the global config.
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "valid-model-ref-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\necho 'valid model ref'\nexit 0\n",
        },
      ],
    });

    // No modification — default config references "sonnet" which is defined
    await expect(harness.start()).resolves.toBeUndefined();

    await harness.triggerAgent("valid-model-ref-agent");
    const run = await harness.waitForRunResult("valid-model-ref-agent", 120_000);
    expect(run.result).toBe("completed");
  });
});
