/**
 * Integration tests: cli/commands/doctor.ts execute() validation guards — no Docker required.
 *
 * The `al doctor` command (cli/commands/doctor.ts) has two early-exit guards
 * and a `skipCredentials` option that can be tested without Docker:
 *
 *   1. SKILL.md guard — if a SKILL.md exists in the project path, throw a
 *      ConfigError (note: start.ts throws Error; doctor.ts throws ConfigError).
 *      This message says "Run 'al doctor' from the project root".
 *
 *   2. No agents found — if no agent directories exist, log a message and return
 *      without throwing. The function completes silently.
 *
 *   3. skipCredentials: true — skip the credential prompting/checking phase.
 *      For an empty credentials project, the function should not throw.
 *
 *   4. Unknown fields in config.toml — when global config has unrecognized keys,
 *      doctor collects validation errors and throws ConfigError with "validation error(s)".
 *
 * Note: doctor.ts throws ConfigError for its SKILL.md guard,
 * while start.ts throws a plain Error. This is intentional.
 *
 * Test scenarios (no Docker required):
 *   1. SKILL.md in project path → throws ConfigError with "agent directory" message
 *   2. ConfigError (not plain Error) for SKILL.md guard
 *   3. Message says "al doctor" (not "al start")
 *   4. No agents → function returns without throwing (silent mode)
 *   5. Project with valid agent, skipCredentials=true → function completes (no cred prompts)
 *   6. Global config with unknown field → throws ConfigError "validation error(s)"
 *
 * Covers:
 *   - cli/commands/doctor.ts: existsSync(SKILL.md) guard → throw ConfigError (lines 25-30)
 *   - cli/commands/doctor.ts: agents.length === 0 → return early (lines 33-36)
 *   - cli/commands/doctor.ts: skipCredentials:true → skips credential checks (lines 455-458)
 *   - cli/commands/doctor.ts: detectGlobalConfigUnknownFields() → validationErrors (lines 58-62)
 *   - cli/commands/doctor.ts: validationErrors.length > 0 → throw ConfigError (lines 450-454)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { setDefaultBackend, resetDefaultBackend } from "@action-llama/action-llama/internals/credentials";
import { FilesystemBackend } from "@action-llama/action-llama/internals/filesystem-backend";

const { execute: doctorExecute } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cli/commands/doctor.js"
);

const { ConfigError } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/shared/errors.js"
);

describe(
  "integration: cli/commands/doctor.ts execute() validation guards (no Docker required)",
  { timeout: 30_000 },
  () => {
    let tmpDir: string;
    let credDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "al-doctor-guard-"));
      credDir = mkdtempSync(join(tmpdir(), "al-doctor-creds-"));
      setDefaultBackend(new FilesystemBackend(credDir));
    });

    afterEach(() => {
      resetDefaultBackend();
      rmSync(tmpDir, { recursive: true, force: true });
      rmSync(credDir, { recursive: true, force: true });
    });

    /** Create a minimal valid project with one agent. */
    function setupMinimalProject(): void {
      // Global config
      writeFileSync(join(tmpDir, "config.toml"), '[models.sonnet]\nprovider = "anthropic"\nmodel = "claude-3-5-sonnet-20241022"\nauthType = "api_key"\n');
      // Agent
      const agentDir = join(tmpDir, "agents", "my-agent");
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(join(agentDir, "SKILL.md"), '---\ndescription: "Test"\n---\n\n# My Agent\n');
      writeFileSync(join(agentDir, "config.toml"), 'models = ["sonnet"]\ncredentials = ["anthropic_key"]\nschedule = "0 0 31 2 *"\n');
    }

    it("throws ConfigError when SKILL.md exists in project path", async () => {
      writeFileSync(join(tmpDir, "SKILL.md"), "# Agent");

      await expect(
        doctorExecute({ project: tmpDir, silent: true, skipCredentials: true })
      ).rejects.toSatisfy(
        (err: unknown) => err instanceof ConfigError &&
          (err as ConfigError).message.includes("agent directory")
      );
    });

    it("throws ConfigError (not plain Error) for SKILL.md guard in doctor", async () => {
      writeFileSync(join(tmpDir, "SKILL.md"), "# Agent");

      let caught: unknown;
      try {
        await doctorExecute({ project: tmpDir, silent: true, skipCredentials: true });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeDefined();
      expect(caught instanceof ConfigError).toBe(true);
    });

    it("SKILL.md guard message references 'al doctor' not 'al start'", async () => {
      writeFileSync(join(tmpDir, "SKILL.md"), "# Agent");

      let caughtError: ConfigError | undefined;
      try {
        await doctorExecute({ project: tmpDir, silent: true, skipCredentials: true });
      } catch (err) {
        if (err instanceof ConfigError) caughtError = err;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError!.message).toContain("al doctor");
    });

    it("no agents found → returns without throwing (silent mode)", async () => {
      // Write global config but no agents directory
      writeFileSync(join(tmpDir, "config.toml"), '[models.sonnet]\nprovider = "anthropic"\nmodel = "claude-3-5-sonnet-20241022"\nauthType = "api_key"\n');
      // agents/ directory does not exist → discoverAgents returns []
      
      // Should return without throwing
      await expect(
        doctorExecute({ project: tmpDir, silent: true, skipCredentials: true })
      ).resolves.toBeUndefined();
    });

    it("valid agent project with skipCredentials=true completes without credential errors", async () => {
      setupMinimalProject();

      // With skipCredentials=true, doctor skips credential prompting.
      // Should complete without throwing (no credentials needed).
      await expect(
        doctorExecute({
          project: tmpDir,
          silent: true,
          skipCredentials: true,
          checkOnly: true,
        })
      ).resolves.toBeUndefined();
    });

    it("global config with unknown field → throws ConfigError with 'validation error(s)'", async () => {
      // Write a global config with an unknown top-level field
      writeFileSync(
        join(tmpDir, "config.toml"),
        '[models.sonnet]\nprovider = "anthropic"\nmodel = "claude-3-5-sonnet-20241022"\nauthType = "api_key"\n\n[unknown_section]\nfoo = "bar"\n'
      );
      // Need at least one agent for doctor to get past the "no agents" check
      const agentDir = join(tmpDir, "agents", "my-agent");
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(join(agentDir, "SKILL.md"), '---\ndescription: "Test"\n---\n\n# My Agent\n');
      writeFileSync(join(agentDir, "config.toml"), 'models = ["sonnet"]\ncredentials = ["anthropic_key"]\nschedule = "0 0 31 2 *"\n');

      let caughtError: ConfigError | undefined;
      try {
        await doctorExecute({
          project: tmpDir,
          silent: true,
          skipCredentials: true,
          checkOnly: true,
        });
      } catch (err) {
        if (err instanceof ConfigError) caughtError = err;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError!.message).toContain("validation error(s)");
    });
  },
);
