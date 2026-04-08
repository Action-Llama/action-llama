/**
 * Integration tests: cli/commands/push.ts execute() validation guards — no Docker required.
 *
 * The `al push` command performs several early validation checks before
 * attempting SSH connections or file transfers:
 *
 *   1. No environment specified — resolveEnvironmentName() returns undefined when
 *      no --env flag, no AL_ENV env var, and no .env.toml environment binding.
 *      Throws ConfigError "No environment specified."
 *
 *   2. Nonexistent environment — resolveEnvironmentName() returns the env name but
 *      loadEnvironmentConfig() cannot find the file in ~/.action-llama/environments/.
 *      Throws ConfigError "not found."
 *
 * Both guards throw before any SSH connection or filesystem access to the remote
 * server, so they can be tested without Docker or a running server.
 *
 * Test scenarios (no Docker required):
 *   1. No --env, no AL_ENV, no .env.toml → throws ConfigError "No environment specified"
 *   2. --env pointing to nonexistent environment → throws ConfigError "not found"
 *   3. AL_ENV pointing to nonexistent environment → throws ConfigError "not found"
 *   4. .env.toml with environment binding to nonexistent env → throws ConfigError "not found"
 *   5. Error for no env is a ConfigError (not plain Error)
 *   6. Error for nonexistent env includes the env name
 *   7. Error for nonexistent env is a ConfigError
 *
 * Covers:
 *   - cli/commands/push.ts: resolveEnvironmentName() returns undefined → ConfigError
 *   - cli/commands/push.ts: loadEnvironmentConfig() throws for nonexistent env
 *   - shared/environment.ts: resolveEnvironmentName() — cliEnv / AL_ENV / .env.toml paths
 *   - shared/environment.ts: loadEnvironmentConfig() not-found → ConfigError
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const { execute: pushExecute } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cli/commands/push.js"
);

const { ConfigError } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/shared/errors.js"
);

/** Create a minimal valid project directory with config.toml. */
function setupProject(projectDir: string): void {
  writeFileSync(
    join(projectDir, "config.toml"),
    '[models.sonnet]\nprovider = "anthropic"\nmodel = "claude-sonnet-4-20250514"\nauthType = "api_key"\n'
  );
  // Create a minimal agent so that "no agents found" doesn't trigger first
  const agentDir = join(projectDir, "agents", "my-agent");
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(
    join(agentDir, "SKILL.md"),
    "---\ndescription: test agent\n---\n\n# my-agent\n\nTest agent.\n"
  );
  writeFileSync(join(agentDir, "config.toml"), 'models = ["sonnet"]\nschedule = "0 0 31 2 *"\n');
}

describe(
  "integration: cli/commands/push.ts execute() validation guards (no Docker required)",
  { timeout: 30_000 },
  () => {
    let projectDir: string;
    let originalAlEnv: string | undefined;

    beforeEach(() => {
      projectDir = mkdtempSync(join(tmpdir(), "al-push-guard-"));
      setupProject(projectDir);
      // Save and clear AL_ENV to avoid side-effects from environment
      originalAlEnv = process.env.AL_ENV;
      delete process.env.AL_ENV;
    });

    afterEach(() => {
      rmSync(projectDir, { recursive: true, force: true });
      // Restore AL_ENV
      if (originalAlEnv !== undefined) {
        process.env.AL_ENV = originalAlEnv;
      } else {
        delete process.env.AL_ENV;
      }
    });

    // ── No environment specified ─────────────────────────────────────────────

    it("throws ConfigError when no --env, no AL_ENV, and no .env.toml", async () => {
      await expect(
        pushExecute({ project: projectDir })
      ).rejects.toSatisfy(
        (e: unknown) => e instanceof ConfigError && (e as ConfigError).message.includes("No environment specified")
      );
    });

    it("error for missing env is a ConfigError (not plain Error)", async () => {
      let caught: unknown;
      try {
        await pushExecute({ project: projectDir });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeDefined();
      expect(caught instanceof ConfigError).toBe(true);
    });

    it("error message mentions environment when none specified", async () => {
      let caughtError: Error | undefined;
      try {
        await pushExecute({ project: projectDir });
      } catch (err) {
        if (err instanceof Error) caughtError = err;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError!.message.toLowerCase()).toContain("environment");
    });

    // ── Nonexistent environment ──────────────────────────────────────────────

    it("throws ConfigError when --env points to nonexistent environment", async () => {
      const nonexistentEnv = `test-env-push-${Date.now()}-nonexistent`;

      await expect(
        pushExecute({ project: projectDir, env: nonexistentEnv })
      ).rejects.toSatisfy(
        (e: unknown) => e instanceof ConfigError
      );
    });

    it("error for nonexistent env includes the env name", async () => {
      const nonexistentEnv = `test-push-env-${Date.now()}-nope`;

      let caughtError: Error | undefined;
      try {
        await pushExecute({ project: projectDir, env: nonexistentEnv });
      } catch (err) {
        if (err instanceof Error) caughtError = err;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError!.message).toContain(nonexistentEnv);
    });

    it("error for nonexistent env is a ConfigError", async () => {
      const nonexistentEnv = `test-push-env-${Date.now()}-gone`;

      let caught: unknown;
      try {
        await pushExecute({ project: projectDir, env: nonexistentEnv });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeDefined();
      expect(caught instanceof ConfigError).toBe(true);
    });

    // ── AL_ENV resolves to nonexistent environment ────────────────────────────

    it("throws ConfigError when AL_ENV points to nonexistent environment", async () => {
      const nonexistentEnv = `al-env-test-${Date.now()}-none`;
      process.env.AL_ENV = nonexistentEnv;

      await expect(
        pushExecute({ project: projectDir })
      ).rejects.toSatisfy(
        (e: unknown) => e instanceof ConfigError && (e as ConfigError).message.includes(nonexistentEnv)
      );
    });

    // ── .env.toml environment binding to nonexistent env ─────────────────────

    it("throws ConfigError when .env.toml environment binding points to nonexistent env", async () => {
      const nonexistentEnv = `env-toml-test-${Date.now()}-nothere`;

      // Write .env.toml with environment binding
      writeFileSync(
        join(projectDir, ".env.toml"),
        `environment = "${nonexistentEnv}"\n`
      );

      await expect(
        pushExecute({ project: projectDir })
      ).rejects.toSatisfy(
        (e: unknown) => e instanceof ConfigError && (e as ConfigError).message.includes(nonexistentEnv)
      );
    });

    // ── --env takes precedence over AL_ENV ────────────────────────────────────

    it("--env flag takes precedence over AL_ENV (both nonexistent, --env name used in error)", async () => {
      process.env.AL_ENV = `al-env-test-${Date.now()}-should-not-appear`;
      const cliEnv = `cli-env-test-${Date.now()}-used-in-error`;

      let caughtError: Error | undefined;
      try {
        await pushExecute({ project: projectDir, env: cliEnv });
      } catch (err) {
        if (err instanceof Error) caughtError = err;
      }

      expect(caughtError).toBeDefined();
      // The CLI --env name should appear in the error, not AL_ENV
      expect(caughtError!.message).toContain(cliEnv);
    });
  },
);
