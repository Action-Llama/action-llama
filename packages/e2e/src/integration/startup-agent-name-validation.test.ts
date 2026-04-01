/**
 * Integration tests: agent name validation during scheduler startup — no Docker required.
 *
 * Agent directory names are used as agent names. validateAgentConfig() calls
 * validateAgentName() which enforces naming rules:
 *   - 1–64 characters
 *   - Only lowercase letters, numbers, and hyphens
 *   - Cannot start or end with a hyphen
 *   - No consecutive hyphens
 *   - "default" is reserved
 *
 * If a directory under agents/ has SKILL.md but an invalid name, the scheduler
 * fails at Phase 1 (validateAndDiscover) before reaching Phase 4 (Docker).
 *
 * Covers:
 *   - shared/config/validate.ts: validateAgentName() — uppercase/underscore rejection
 *   - shared/config/validate.ts: validateAgentName() — "default" reserved name rejection
 *   - shared/config/validate.ts: validateAgentName() — name too long (> 64 chars)
 *   - shared/config/load-agent.ts: discoverAgents() discovers directories regardless of name validity
 *   - scheduler/validation.ts: validateAndDiscover() → validateAgentConfig() → validateAgentName()
 */

import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import { stringify as stringifyTOML } from "smol-toml";
import { stringify as stringifyYAML } from "yaml";
import { IntegrationHarness } from "./harness.js";

/** Write a minimal agent directory with SKILL.md and config.toml */
function writeMinimalAgent(projectPath: string, agentName: string, schedule = "0 0 31 2 *"): void {
  const agentDir = resolve(projectPath, "agents", agentName);
  mkdirSync(agentDir, { recursive: true });

  const yamlStr = stringifyYAML({ name: agentName }).trimEnd();
  writeFileSync(
    resolve(agentDir, "SKILL.md"),
    `---\n${yamlStr}\n---\n\n# ${agentName}\nTest agent.\n`,
  );

  writeFileSync(
    resolve(agentDir, "config.toml"),
    stringifyTOML({
      models: ["sonnet"],
      credentials: ["anthropic_key"],
      schedule,
    }),
  );
}

describe(
  "integration: agent name validation during startup (no Docker required)",
  { timeout: 60_000 },
  () => {
    let harness: IntegrationHarness;

    afterEach(async () => {
      if (harness) {
        try { await harness.shutdown(); } catch {}
        harness = undefined as unknown as IntegrationHarness;
      }
    });

    it("rejects when an agent directory name contains uppercase letters", async () => {
      // validateAgentName() rejects names with uppercase letters.
      // The directory name becomes the agent name. discoverAgents() finds it,
      // loadAgentConfig() returns it, validateAgentConfig() rejects it.
      harness = await IntegrationHarness.create({ agents: [] });

      // Add an agent directory with an uppercase name
      writeMinimalAgent(harness.projectPath, "MyAgent");

      let startError: Error | undefined;
      try {
        await harness.start();
      } catch (err) {
        startError = err instanceof Error ? err : new Error(String(err));
      }

      expect(startError, "expected startScheduler to throw").toBeDefined();
      expect(startError!.message).toMatch(/MyAgent|invalid|lowercase/i);
    });

    it("rejects when an agent directory name is the reserved word 'default'", async () => {
      // "default" is explicitly reserved and throws ConfigError.
      harness = await IntegrationHarness.create({ agents: [] });

      // Add an agent directory named "default"
      writeMinimalAgent(harness.projectPath, "default");

      let startError: Error | undefined;
      try {
        await harness.start();
      } catch (err) {
        startError = err instanceof Error ? err : new Error(String(err));
      }

      expect(startError, "expected startScheduler to throw").toBeDefined();
      expect(startError!.message).toMatch(/default.*reserved|reserved.*default/i);
    });

    it("rejects when an agent directory name exceeds 64 characters", async () => {
      // validateAgentName() rejects names longer than 64 characters.
      const longName = "a".repeat(65);  // 65 lowercase letters — exceeds limit
      harness = await IntegrationHarness.create({ agents: [] });

      writeMinimalAgent(harness.projectPath, longName);

      let startError: Error | undefined;
      try {
        await harness.start();
      } catch (err) {
        startError = err instanceof Error ? err : new Error(String(err));
      }

      expect(startError, "expected startScheduler to throw").toBeDefined();
      expect(startError!.message).toMatch(/invalid|64 characters|1-64/i);
    });
  },
);
