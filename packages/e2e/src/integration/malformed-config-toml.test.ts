/**
 * Integration test: verify that the scheduler correctly rejects startup when
 * an agent has a config.toml with invalid TOML syntax.
 *
 * When loadAgentRuntimeConfig() parses the config.toml and encounters a
 * TOML syntax error, it throws ConfigError with the parse error details.
 *
 * Covers:
 *   - shared/config/load-agent.ts: parseTOML() throw → ConfigError
 */
import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync } from "fs";
import { resolve } from "path";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: malformed agent config.toml rejection", { timeout: 120_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) {
      try { await harness.shutdown(); } catch {}
    }
  });

  it("scheduler startup fails when an agent config.toml has invalid TOML syntax", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "bad-toml-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    // Overwrite the agent's config.toml with invalid TOML syntax
    const agentDir = resolve(harness.projectPath, "agents", "bad-toml-agent");
    writeFileSync(
      resolve(agentDir, "config.toml"),
      // This is not valid TOML — unclosed brackets cause parse failure
      'models = ["sonnet"\ncredentials = ["anthropic_key"]\nschedule = "0 0 31 2 *"\n[invalid toml\n',
    );

    let startError: Error | undefined;
    try {
      await harness.start();
    } catch (err) {
      startError = err instanceof Error ? err : new Error(String(err));
    }

    // Startup should fail due to TOML parse error
    expect(startError).toBeDefined();
    // Error should mention the file or parsing
    expect(startError!.message).toMatch(/config\.toml|parse|toml|syntax/i);
  });
});
