/**
 * Integration test: verify that the scheduler correctly rejects startup when
 * the global config.toml has invalid TOML syntax.
 *
 * loadGlobalConfig() calls parseTOML() on config.toml. If it throws a parse
 * error, it wraps it in ConfigError and re-throws.
 *
 * Covers:
 *   - shared/config/load-project.ts: parseTOML() throw → ConfigError
 */
import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync } from "fs";
import { resolve } from "path";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: malformed global config.toml rejection", { timeout: 120_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) {
      try { await harness.shutdown(); } catch {}
    }
  });

  it("scheduler startup fails when global config.toml has invalid TOML syntax", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "bad-global-config-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    // Overwrite the global config.toml with invalid TOML syntax
    writeFileSync(
      resolve(harness.projectPath, "config.toml"),
      // Invalid TOML — missing closing bracket and malformed key
      '[models\nsonnet = { provider = "anthropic"\n[gateway]\nport = 8080\n',
    );

    let startError: Error | undefined;
    try {
      await harness.start();
    } catch (err) {
      startError = err instanceof Error ? err : new Error(String(err));
    }

    // Startup should fail due to global config.toml parse error
    expect(startError).toBeDefined();
    expect(startError!.message).toMatch(/config\.toml|parse|toml|syntax/i);
  });
});
