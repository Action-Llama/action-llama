/**
 * Integration tests: additional scheduler startup failure paths — no Docker required.
 *
 * Like startup-failures.test.ts, these tests exercise Phase 1 of startScheduler()
 * (validateAndDiscover / loadAgentConfig) without any Docker dependency. They use
 * the real IntegrationHarness with no skipIf(!DOCKER) guard.
 *
 * Covers (with real implementations, no mocks):
 *   - shared/config/load-agent.ts: model resolution — agent references undefined model
 *   - shared/config/load-agent.ts: loadAgentConfig — invalid TOML in agent config.toml
 *   - scheduler/validation.ts: resolveWebhookSource — agent references undefined webhook source
 *   - All three are Phase 1 errors thrown before Phase 2 (persistence) and Phase 4 (Docker)
 */

import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync } from "fs";
import { resolve } from "path";
import { stringify as stringifyTOML } from "smol-toml";
import { IntegrationHarness } from "./harness.js";

describe(
  "integration: scheduler startup config errors (no Docker required)",
  { timeout: 60_000 },
  () => {
    let harness: IntegrationHarness;

    afterEach(async () => {
      if (harness) {
        try { await harness.shutdown(); } catch {}
        harness = undefined as unknown as IntegrationHarness;
      }
    });

    it("rejects when an agent references a model name not in global config", async () => {
      // The harness creates a global config with models.sonnet.
      // Overwrite the agent config.toml to reference "nonexistent-model".
      // loadAgentConfig() throws ConfigError: 'references model "nonexistent-model"
      // which is not defined in config.toml'.
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "bad-model-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });

      // Overwrite the agent config.toml to reference an undefined model name
      const agentConfigPath = resolve(harness.projectPath, "agents", "bad-model-agent", "config.toml");
      writeFileSync(
        agentConfigPath,
        stringifyTOML({
          models: ["nonexistent-model"],  // not defined in global config
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
      expect(startError!.message).toMatch(/nonexistent-model|not defined|model/i);
    });

    it("rejects when an agent config.toml has invalid TOML syntax", async () => {
      // The harness writes a valid agent config.toml. We overwrite it with
      // malformed TOML. loadAgentConfig() → parseTOML() throws → ConfigError.
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "malformed-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });

      // Overwrite agent config.toml with invalid TOML
      const agentConfigPath = resolve(harness.projectPath, "agents", "malformed-agent", "config.toml");
      writeFileSync(agentConfigPath, "[[invalid toml syntax [[[");

      let startError: Error | undefined;
      try {
        await harness.start();
      } catch (err) {
        startError = err instanceof Error ? err : new Error(String(err));
      }

      expect(startError, "expected startScheduler to throw").toBeDefined();
      // Should report a parse/config error
      expect(startError!.message).toBeTruthy();
    });

    it("rejects when an agent references a webhook source not defined in global config", async () => {
      // The harness normally auto-creates global webhook config entries for any
      // webhooks defined in agents. We create an agent with a webhook, then
      // remove the global webhooks section from config.toml — triggering
      // resolveWebhookSource() to throw.
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "webhook-agent",
            webhooks: [{ source: "my-github", events: ["push"] }],
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });

      // The harness wrote global config with [webhooks.my-github].
      // Overwrite it to remove the webhooks section entirely.
      writeFileSync(
        resolve(harness.projectPath, "config.toml"),
        stringifyTOML({
          models: {
            sonnet: {
              provider: "anthropic",
              model: "claude-sonnet-4-20250514",
              authType: "api_key",
            },
          },
          gateway: { port: harness.gatewayPort },
          // Intentionally no [webhooks] section — my-github is undefined
        }),
      );

      let startError: Error | undefined;
      try {
        await harness.start();
      } catch (err) {
        startError = err instanceof Error ? err : new Error(String(err));
      }

      expect(startError, "expected startScheduler to throw").toBeDefined();
      expect(startError!.message).toMatch(/my-github|webhook source|not defined/i);
    });
  },
);
