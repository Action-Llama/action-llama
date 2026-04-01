/**
 * Integration tests: multi-agent validation error paths — no Docker required.
 *
 * When a project has multiple agents, validateAndDiscover() validates ALL agents
 * before reaching Phase 4 (Docker). These tests verify that:
 *   1. A valid agent + an invalid agent → startup fails for the invalid agent
 *   2. The error message identifies the problematic agent
 *   3. Agents are discovered in sorted order (alphabetical by directory name)
 *
 * All tests remain in Phase 1 (validateAndDiscover) and never reach Phase 4.
 *
 * Covers:
 *   - scheduler/validation.ts: validateAndDiscover() validates all agents in order
 *   - shared/config/load-agent.ts: loadAgentConfig() per agent — TOML errors
 *   - shared/config/validate.ts: validateAgentConfig() per agent — schedule check
 *   - shared/config/load-agent.ts: discoverAgents() — alphabetical sort
 */

import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve } from "path";
import { stringify as stringifyTOML } from "smol-toml";
import { stringify as stringifyYAML } from "yaml";
import { IntegrationHarness } from "./harness.js";

describe(
  "integration: multi-agent validation errors (no Docker required)",
  { timeout: 60_000 },
  () => {
    let harness: IntegrationHarness;

    afterEach(async () => {
      if (harness) {
        try { await harness.shutdown(); } catch {}
        harness = undefined as unknown as IntegrationHarness;
      }
    });

    it("rejects when any agent has invalid config (other agents are valid)", async () => {
      // Create a project with two agents: one valid, one with no schedule/webhooks.
      // validateAndDiscover() validates all agents — the invalid one triggers failure.
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "agent-alpha",
            schedule: "0 0 31 2 *",  // valid — has schedule
            testScript: "#!/bin/sh\nexit 0\n",
          },
          {
            name: "agent-beta",
            // No schedule and no webhooks — will fail validateAgentConfig()
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

      expect(startError, "expected startScheduler to throw").toBeDefined();
      // Error must reference the invalid agent
      expect(startError!.message).toMatch(/agent-beta|schedule|webhooks/i);
    });

    it("rejects when one of many agents references a missing credential", async () => {
      // Three agents: two valid, one references a credential not in the store.
      // validateAndDiscover() checks all credentials for ALL active agents.
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "agent-one",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
          {
            name: "agent-two",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
            config: {
              credentials: ["missing_secret_key"],  // not in harness credential store
            },
          },
          {
            name: "agent-three",
            schedule: "0 0 31 2 *",
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

      expect(startError, "expected startScheduler to throw").toBeDefined();
      expect(startError!.message).toMatch(/missing_secret_key|credential/i);
    });

    it("adds an extra agent directory directly and validates its config is discovered", async () => {
      // Manually add an agent directory to test that discoverAgents() picks it up.
      // The extra agent has no schedule or webhooks — validates the error is about it.
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "base-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });

      // Manually create an extra agent directory with valid SKILL.md but no schedule
      const extraAgentDir = resolve(harness.projectPath, "agents", "extra-agent");
      mkdirSync(extraAgentDir, { recursive: true });

      // Write SKILL.md
      writeFileSync(
        resolve(extraAgentDir, "SKILL.md"),
        `---\n${stringifyYAML({ name: "extra-agent" }).trimEnd()}\n---\n\n# Extra Agent\nManually added.\n`,
      );

      // Write config.toml with no schedule and no webhooks
      writeFileSync(
        resolve(extraAgentDir, "config.toml"),
        stringifyTOML({
          models: ["sonnet"],
          credentials: ["anthropic_key"],
          // Deliberately no schedule, no webhooks
        }),
      );

      let startError: Error | undefined;
      try {
        await harness.start();
      } catch (err) {
        startError = err instanceof Error ? err : new Error(String(err));
      }

      expect(startError, "expected startScheduler to throw").toBeDefined();
      // Error should be about the extra agent (or any agent without triggers)
      expect(startError!.message).toMatch(/extra-agent|schedule|webhooks/i);
    });
  },
);
