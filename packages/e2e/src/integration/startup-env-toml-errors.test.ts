/**
 * Integration tests: .env.toml error paths during scheduler startup — no Docker required.
 *
 * When the project has a .env.toml, loadGlobalConfig() calls loadEnvToml() and
 * potentially loadEnvironmentConfig(). Both can throw ConfigError before
 * startScheduler() is even called.
 *
 * These tests write a .env.toml to the harness project directory after create()
 * and then call harness.start() which internally calls loadGlobalConfig() before
 * startScheduler(). No Docker is needed since errors occur before Phase 1.
 *
 * Covers:
 *   - shared/environment.ts: loadEnvToml() → ConfigError on malformed TOML
 *   - shared/environment.ts: loadEnvironmentConfig() → ConfigError when env file missing
 *   - shared/config/load-project.ts: loadGlobalConfig() error propagation
 *   - Harness start() → loadGlobalConfig() failure before startScheduler()
 */

import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync } from "fs";
import { resolve } from "path";
import { IntegrationHarness } from "./harness.js";

describe(
  "integration: .env.toml error paths during startup (no Docker required)",
  { timeout: 60_000 },
  () => {
    let harness: IntegrationHarness;

    afterEach(async () => {
      if (harness) {
        try { await harness.shutdown(); } catch {}
        harness = undefined as unknown as IntegrationHarness;
      }
    });

    it("rejects when .env.toml has invalid TOML syntax", async () => {
      // loadGlobalConfig() calls loadEnvToml() which throws ConfigError for
      // malformed TOML. This error propagates through harness.start() before
      // startScheduler() is even called.
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "env-toml-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });

      // Write a malformed .env.toml
      writeFileSync(
        resolve(harness.projectPath, ".env.toml"),
        "[[invalid .env.toml content]]]",
      );

      let startError: Error | undefined;
      try {
        await harness.start();
      } catch (err) {
        startError = err instanceof Error ? err : new Error(String(err));
      }

      expect(startError, "expected harness.start() to throw").toBeDefined();
      // Error should come from parsing .env.toml
      expect(startError!.message).toMatch(/\.env\.toml|env.toml|parsing/i);
    });

    it("rejects when .env.toml references a non-existent named environment", async () => {
      // If .env.toml contains environment = "prod" but there is no
      // ~/.action-llama/environments/prod.toml, loadEnvironmentConfig() throws
      // ConfigError("Environment 'prod' not found at ...").
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "env-ref-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });

      // Write a .env.toml that references a guaranteed-nonexistent environment name
      // Use a UUID-like name to ensure the environment file doesn't exist
      writeFileSync(
        resolve(harness.projectPath, ".env.toml"),
        'environment = "al-integration-test-env-does-not-exist-xyz123"\n',
      );

      let startError: Error | undefined;
      try {
        await harness.start();
      } catch (err) {
        startError = err instanceof Error ? err : new Error(String(err));
      }

      expect(startError, "expected harness.start() to throw").toBeDefined();
      // Error should mention the missing environment
      expect(startError!.message).toMatch(/al-integration-test-env-does-not-exist-xyz123|not found|environment/i);
    });
  },
);
