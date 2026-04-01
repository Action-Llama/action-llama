/**
 * Integration tests: SKILL.md parsing error paths during scheduler startup — no Docker required.
 *
 * loadAgentConfig() reads and parses each agent's SKILL.md file, extracting YAML
 * frontmatter for portable config fields (name, description, etc.). If the
 * frontmatter is malformed YAML, parseFrontmatter() throws which is wrapped
 * into a ConfigError in loadAgentConfig().
 *
 * These errors occur in validateAndDiscover() → loadAgentConfig() at Phase 1,
 * before any Phase 2 (persistence), Phase 3 (gateway), or Phase 4 (Docker).
 *
 * Covers:
 *   - shared/frontmatter.ts: parseFrontmatter() — malformed YAML throws Error
 *   - shared/config/load-agent.ts: loadAgentConfig() wraps parseFrontmatter error in ConfigError
 *   - scheduler/validation.ts: validateAndDiscover() propagates ConfigError on SKILL.md parse failure
 */

import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync } from "fs";
import { resolve } from "path";
import { IntegrationHarness } from "./harness.js";

describe(
  "integration: SKILL.md parse errors during startup (no Docker required)",
  { timeout: 60_000 },
  () => {
    let harness: IntegrationHarness;

    afterEach(async () => {
      if (harness) {
        try { await harness.shutdown(); } catch {}
        harness = undefined as unknown as IntegrationHarness;
      }
    });

    it("rejects when an agent SKILL.md has malformed YAML frontmatter", async () => {
      // loadAgentConfig() calls parseFrontmatter() which calls parseYAML().
      // Malformed YAML in the frontmatter throws an error wrapped in ConfigError.
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "bad-skill-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });

      // Overwrite SKILL.md with malformed YAML frontmatter
      const skillPath = resolve(harness.projectPath, "agents", "bad-skill-agent", "SKILL.md");
      writeFileSync(
        skillPath,
        [
          "---",
          "name: bad-skill-agent",
          "description: {invalid yaml: [unclosed bracket",  // malformed YAML
          "---",
          "",
          "# Bad Agent",
        ].join("\n"),
      );

      let startError: Error | undefined;
      try {
        await harness.start();
      } catch (err) {
        startError = err instanceof Error ? err : new Error(String(err));
      }

      expect(startError, "expected startScheduler to throw").toBeDefined();
      // Error should reference the SKILL.md file path
      expect(startError!.message).toMatch(/SKILL\.md|skill\.md|parsing/i);
    });

    it("loads successfully when SKILL.md frontmatter is valid YAML with extra fields", async () => {
      // parseFrontmatter() ignores unknown frontmatter fields gracefully.
      // Extra fields like 'license', 'compatibility' are passed through without error.
      // This confirms the happy path: no ConfigError for well-formed SKILL.md.
      // (Scheduler will eventually fail at Phase 4 Docker check in no-Docker envs,
      //  but the SKILL.md parsing succeeds.)
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "good-skill-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });

      // Overwrite SKILL.md with valid frontmatter including extra/unknown fields
      const skillPath = resolve(harness.projectPath, "agents", "good-skill-agent", "SKILL.md");
      writeFileSync(
        skillPath,
        [
          "---",
          "name: good-skill-agent",
          "description: A test agent with extra frontmatter fields",
          "license: MIT",
          "compatibility:",
          "  action-llama: '>= 0.20.0'",
          "  node: '>= 20'",
          "custom_field: some_value",
          "---",
          "",
          "# Good Skill Agent",
          "This is a test agent.",
        ].join("\n"),
      );

      // Scheduler startup should NOT fail due to SKILL.md parsing.
      // It should fail at Phase 4 (Docker) in no-Docker environments, OR succeed
      // in Docker environments. We catch any error and verify it's not a SKILL.md error.
      let startError: Error | undefined;
      try {
        await harness.start();
      } catch (err) {
        startError = err instanceof Error ? err : new Error(String(err));
      }

      // If there is an error, it should NOT be about SKILL.md parsing
      if (startError) {
        expect(startError.message).not.toMatch(/SKILL\.md.*parsing|Error parsing.*SKILL\.md/i);
      }
      // If no error (Docker environment), the test trivially passes
    });
  },
);
