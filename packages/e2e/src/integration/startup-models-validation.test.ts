/**
 * Integration tests: model configuration validation during startup — no Docker required.
 *
 * loadAgentConfig() validates that agents reference at least one model, and that
 * the models referenced are defined in the global config.toml [models] table.
 * These validations happen at Phase 1 (validateAndDiscover → loadAgentConfig),
 * before Phase 4 (Docker).
 *
 * Covers:
 *   - shared/config/load-agent.ts: loadAgentConfig() → no models field → ConfigError
 *   - shared/config/load-agent.ts: loadAgentConfig() → global config has no models → ConfigError
 *   - shared/config/load-agent.ts: loadAgentConfig() → empty models array → ConfigError
 *   - All failures occur at Phase 1 (validateAndDiscover → loadAgentConfig)
 */

import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync } from "fs";
import { resolve } from "path";
import { stringify as stringifyTOML } from "smol-toml";
import { IntegrationHarness } from "./harness.js";

describe(
  "integration: model configuration validation during startup (no Docker required)",
  { timeout: 60_000 },
  () => {
    let harness: IntegrationHarness;

    afterEach(async () => {
      if (harness) {
        try { await harness.shutdown(); } catch {}
        harness = undefined as unknown as IntegrationHarness;
      }
    });

    it("rejects when agent config.toml has no 'models' field", async () => {
      // loadAgentConfig() requires agents to declare at least one model.
      // An agent config.toml without a `models` field triggers ConfigError:
      // 'Agent "X" must have a "models" field listing at least one named model.'
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "no-models-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });

      // Overwrite agent config.toml to remove the models field entirely
      const agentConfigPath = resolve(harness.projectPath, "agents", "no-models-agent", "config.toml");
      writeFileSync(
        agentConfigPath,
        stringifyTOML({
          // Deliberately no 'models' field
          credentials: ["anthropic_key"],
          schedule: "0 0 31 2 *",
        }),
      );

      let startError: Error | undefined;
      try {
        await harness.start();
      } catch (err) {
        startError = err instanceof Error ? err : new Error(String(err));
      }

      expect(startError, "expected startScheduler to throw").toBeDefined();
      expect(startError!.message).toMatch(/models.*field|must have.*models/i);
    });

    it("rejects when agent config.toml has an empty models array", async () => {
      // An empty models array [] also triggers the same ConfigError.
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "empty-models-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });

      const agentConfigPath = resolve(harness.projectPath, "agents", "empty-models-agent", "config.toml");
      writeFileSync(
        agentConfigPath,
        stringifyTOML({
          models: [],  // empty array — invalid
          credentials: ["anthropic_key"],
          schedule: "0 0 31 2 *",
        }),
      );

      let startError: Error | undefined;
      try {
        await harness.start();
      } catch (err) {
        startError = err instanceof Error ? err : new Error(String(err));
      }

      expect(startError, "expected startScheduler to throw").toBeDefined();
      expect(startError!.message).toMatch(/models.*field|must have.*models/i);
    });

    it("rejects when global config.toml has no [models] table", async () => {
      // If the global config.toml has no [models] section at all,
      // loadAgentConfig() calls loadGlobalConfig() which returns a config
      // with no models, triggering ConfigError: 'No models defined in config.toml [models].'
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "global-no-models-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });

      // Overwrite global config to remove the [models] section
      writeFileSync(
        resolve(harness.projectPath, "config.toml"),
        stringifyTOML({
          // Deliberately no 'models' section
          gateway: { port: harness.gatewayPort },
        }),
      );

      let startError: Error | undefined;
      try {
        await harness.start();
      } catch (err) {
        startError = err instanceof Error ? err : new Error(String(err));
      }

      expect(startError, "expected startScheduler to throw").toBeDefined();
      expect(startError!.message).toMatch(/no models|models.*config\.toml/i);
    });
  },
);
