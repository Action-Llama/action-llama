/**
 * Integration tests: global config.toml validation during startup — no Docker required.
 *
 * loadGlobalConfig() validates certain global config fields before startScheduler()
 * is called. Invalid values throw ConfigError which propagates through harness.start().
 *
 * These tests verify that invalid global config values are caught at config load time,
 * before any scheduler phases (Phase 1–4). All tests work without Docker.
 *
 * Covers:
 *   - shared/config/load-project.ts: loadGlobalConfig() — defaultAgentScale validation
 *     (must be a non-negative integer; negative or fractional values throw ConfigError)
 *   - shared/config/load-project.ts: loadProjectConfig() — confirms valid values pass
 *   - Harness start() → loadGlobalConfig() failure before validateAndDiscover()
 */

import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync } from "fs";
import { resolve } from "path";
import { stringify as stringifyTOML } from "smol-toml";
import { IntegrationHarness } from "./harness.js";

describe(
  "integration: global config validation during startup (no Docker required)",
  { timeout: 60_000 },
  () => {
    let harness: IntegrationHarness;

    afterEach(async () => {
      if (harness) {
        try { await harness.shutdown(); } catch {}
        harness = undefined as unknown as IntegrationHarness;
      }
    });

    it("rejects when defaultAgentScale is a negative integer", async () => {
      // loadGlobalConfig() checks: defaultAgentScale must be a non-negative integer.
      // A value of -1 triggers ConfigError("defaultAgentScale must be a non-negative integer.").
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "test-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });

      // Overwrite global config with invalid defaultAgentScale
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
          defaultAgentScale: -1,  // negative — invalid
        }),
      );

      let startError: Error | undefined;
      try {
        await harness.start();
      } catch (err) {
        startError = err instanceof Error ? err : new Error(String(err));
      }

      expect(startError, "expected harness.start() to throw").toBeDefined();
      expect(startError!.message).toMatch(/defaultAgentScale|non-negative/i);
    });

    it("rejects when defaultAgentScale is a fractional number", async () => {
      // 1.5 is not an integer — should also trigger ConfigError.
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "fractional-scale-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });

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
          defaultAgentScale: 1.5,  // non-integer — invalid
        }),
      );

      let startError: Error | undefined;
      try {
        await harness.start();
      } catch (err) {
        startError = err instanceof Error ? err : new Error(String(err));
      }

      expect(startError, "expected harness.start() to throw").toBeDefined();
      expect(startError!.message).toMatch(/defaultAgentScale|non-negative/i);
    });

    it("accepts defaultAgentScale = 0 (all agents disabled by default)", async () => {
      // defaultAgentScale = 0 is valid (zero is a non-negative integer).
      // However, with scale=0 all agents are inactive, so validateAndDiscover()
      // still passes (agents are discovered, but all have scale=0).
      // Eventually fails at Phase 4 (Docker) in no-Docker environments.
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "zero-scale-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });

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
          defaultAgentScale: 0,  // zero is valid — all agents disabled
        }),
      );

      // harness.start() may throw later (Phase 4 Docker) but NOT due to defaultAgentScale
      let startError: Error | undefined;
      try {
        await harness.start();
      } catch (err) {
        startError = err instanceof Error ? err : new Error(String(err));
      }

      // If error occurs, it must NOT be about defaultAgentScale
      if (startError) {
        expect(startError.message).not.toMatch(/defaultAgentScale/i);
      }
    });
  },
);
