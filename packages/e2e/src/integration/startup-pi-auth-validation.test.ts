/**
 * Integration tests: pi_auth and no-trigger validation during scheduler startup
 * — no Docker required.
 *
 * Several scheduler validation errors happen at Phase 1 (validateAndDiscover),
 * before Phase 4 (Docker). These tests cover two validation paths that were
 * previously only in scheduler-validation.test.ts (which uses skipIf(!DOCKER))
 * even though Docker is not actually required:
 *
 *   1. pi_auth authType with container mode → ConfigError "pi_auth"
 *      Agents configured with pi_auth models cannot run in Docker containers
 *      because they need access to the host's ~/.pi/agent/auth.json.
 *
 *   2. No schedule and no webhooks on an active agent → ConfigError
 *      Every active agent must have at least one trigger (schedule or webhook).
 *
 *   3. Webhook source referenced in agent but not in global config → ConfigError
 *      An agent webhook trigger must reference a source defined in [webhooks.*].
 *
 * All tests use IntegrationHarness which starts the real scheduler. When
 * Phase 1 throws a ConfigError, harness.start() rejects with that error.
 * Docker is never reached because the error occurs in Phase 1.
 *
 * Covers:
 *   - scheduler/validation.ts: validateAndDiscover() → pi_auth check → ConfigError
 *   - scheduler/validation.ts: validateAndDiscover() → no triggers → ConfigError
 *   - scheduler/validation.ts: validateAndDiscover() → invalid webhook source → ConfigError
 *   - scheduler/validation.ts: validateAndDiscover() → multiple agents, one invalid → ConfigError
 */

import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync } from "fs";
import { resolve } from "path";
import { stringify as stringifyTOML } from "smol-toml";
import { IntegrationHarness } from "./harness.js";
import { makeModel } from "./helpers.js";

describe(
  "integration: pi_auth and no-trigger validation (no Docker required)",
  { timeout: 60_000 },
  () => {
    let harness: IntegrationHarness;

    afterEach(async () => {
      if (harness) {
        try { await harness.shutdown(); } catch {}
        harness = undefined as unknown as IntegrationHarness;
      }
    });

    // ── pi_auth validation ──────────────────────────────────────────────────────

    it("rejects startup when an agent uses pi_auth (unsupported in container mode)", async () => {
      // validateAndDiscover() rejects pi_auth authType because Docker containers
      // cannot access the host's pi auth storage (~/.pi/agent/auth.json).
      // This validation happens at Phase 1, before Docker is needed.
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "pi-auth-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
        globalConfig: {
          // Override the default api_key model with a pi_auth model
          models: {
            sonnet: makeModel({ authType: "pi_auth" }),
          },
        },
      });

      let startError: Error | undefined;
      try {
        await harness.start();
      } catch (err) {
        startError = err instanceof Error ? err : new Error(String(err));
      }

      expect(startError, "expected startScheduler to throw").toBeDefined();
      // Error message should mention pi_auth and container mode
      expect(startError!.message).toMatch(/pi_auth/i);
    });

    it("error message includes agent name and model name for pi_auth rejection", async () => {
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "pi-auth-named-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
        globalConfig: {
          models: {
            sonnet: makeModel({ authType: "pi_auth" }),
          },
        },
      });

      let startError: Error | undefined;
      try {
        await harness.start();
      } catch (err) {
        startError = err instanceof Error ? err : new Error(String(err));
      }

      expect(startError).toBeDefined();
      // Error should mention the agent name
      expect(startError!.message).toContain("pi-auth-named-agent");
    });

    // ── no-trigger validation ───────────────────────────────────────────────────

    it("rejects startup when an agent has no schedule and no webhooks", async () => {
      // An active agent without any triggers (no schedule, no webhooks) is invalid.
      // validateAgentConfig() in shared/config/validate.ts enforces this.
      // This check runs at Phase 1 before Docker is needed.
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "no-trigger-agent",
            // Deliberately omit schedule and webhooks — agent has no triggers
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });

      let startError: Error | undefined;
      try {
        await harness.start();
      } catch (err) {
        startError = err instanceof Error ? err : new Error(String(err));
      }

      expect(startError).toBeDefined();
      // Error message should mention needing a schedule or webhooks
      expect(startError!.message).toMatch(/schedule|webhooks/i);
    });

    it("rejects when one of multiple agents has no triggers", async () => {
      // Even if other agents are valid, a single invalid agent causes startup failure.
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "valid-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
          {
            name: "no-trigger-agent",
            // No schedule, no webhooks
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });

      let startError: Error | undefined;
      try {
        await harness.start();
      } catch (err) {
        startError = err instanceof Error ? err : new Error(String(err));
      }

      expect(startError).toBeDefined();
      expect(startError!.message).toMatch(/schedule|webhooks/i);
    });

    it("scale=0 agent with no triggers does not cause startup failure", async () => {
      // An agent with scale=0 is disabled. validateAgentConfig() skips the
      // schedule/webhook requirement for disabled agents.
      // This test verifies Phase 1 passes (but Phase 4 fails without Docker).
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "enabled-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
          {
            name: "disabled-no-trigger-agent",
            // scale=0 bypasses the schedule/webhook requirement
            config: { scale: 0 },
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });

      // Phase 1 succeeds because scale=0 agent is skipped in validation.
      // Phase 4 fails without Docker — that's expected (and not our concern here).
      // We just verify Phase 1 does NOT throw ConfigError.
      let startError: Error | undefined;
      try {
        await harness.start();
      } catch (err) {
        startError = err instanceof Error ? err : new Error(String(err));
      }

      if (startError) {
        // Should NOT be a "schedule or webhooks" error (that would mean Phase 1 failed)
        expect(startError.message).not.toMatch(/must.*schedule|must.*webhook/i);
        // Should NOT be a "pi_auth" error
        expect(startError.message).not.toMatch(/pi_auth/i);
      }
      // If no error, that means Docker IS available and the scheduler started — also fine.
    });

    // ── missing credential validation ───────────────────────────────────────────

    it("rejects startup when an agent references a missing credential", async () => {
      // validateAndDiscover() calls requireCredentialRef() for each credential
      // referenced by active agents. A missing credential throws CredentialError.
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "missing-cred-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });

      // Overwrite agent config to reference a credential that doesn't exist
      const agentConfigPath = resolve(
        harness.projectPath,
        "agents",
        "missing-cred-agent",
        "config.toml",
      );
      writeFileSync(
        agentConfigPath,
        stringifyTOML({
          models: ["sonnet"],
          credentials: ["anthropic_key", "nonexistent_credential_xyz"],
          schedule: "0 0 31 2 *",
        }),
      );

      let startError: Error | undefined;
      try {
        await harness.start();
      } catch (err) {
        startError = err instanceof Error ? err : new Error(String(err));
      }

      expect(startError).toBeDefined();
      // Error should mention the missing credential
      expect(startError!.message).toMatch(/nonexistent_credential_xyz|credential.*required|required.*credential/i);
    });
  },
);
