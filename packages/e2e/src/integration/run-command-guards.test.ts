/**
 * Integration tests: cli/commands/run.ts execute() validation guards — no Docker required.
 *
 * The `al run` command (cli/commands/run.ts) performs two early validation
 * checks before attempting to contact the scheduler gateway:
 *
 *   1. SKILL.md guard — if SKILL.md exists in the project path, throw
 *      an Error because the path looks like an agent directory (same as start.ts).
 *
 *   2. Agent not found — check discoverAgents() for the agent name. If not
 *      found, throw an Error with "Agent '<name>' not found" plus a list of
 *      available agents (or "No agents found" if project has no agents).
 *
 * Both guards throw before any network call to the gateway, so they can be
 * tested without Docker or a running scheduler.
 *
 * Test scenarios (no Docker required):
 *   1. SKILL.md in project path → throw Error with "agent directory" message
 *   2. Agent name not in discoverAgents → throw Error "not found" with available list
 *   3. No agents at all → throw Error "not found" with "No agents found"
 *   4. SKILL.md guard takes priority over agent-not-found check
 *
 * Covers:
 *   - cli/commands/run.ts: existsSync(SKILL.md) guard → throw Error (lines 10-15)
 *   - cli/commands/run.ts: !agentNames.includes(agent) → throw Error (lines 18-21)
 *   - cli/commands/run.ts: agentNames.length === 0 → "No agents found." in error (line 19)
 *   - cli/commands/run.ts: agentNames available → "Available agents: ..." in error (line 19)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { setDefaultBackend, resetDefaultBackend } from "@action-llama/action-llama/internals/credentials";
import { FilesystemBackend } from "@action-llama/action-llama/internals/filesystem-backend";

const { execute: runExecute } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cli/commands/run.js"
);

const { ConfigError } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/shared/errors.js"
);

describe(
  "integration: cli/commands/run.ts execute() validation guards (no Docker required)",
  { timeout: 30_000 },
  () => {
    let tmpDir: string;
    let credDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "al-run-guard-"));
      credDir = mkdtempSync(join(tmpdir(), "al-run-creds-"));
      setDefaultBackend(new FilesystemBackend(credDir));
    });

    afterEach(() => {
      resetDefaultBackend();
      rmSync(tmpDir, { recursive: true, force: true });
      rmSync(credDir, { recursive: true, force: true });
    });

    it("throws Error with 'agent directory' message when SKILL.md exists in project path", async () => {
      writeFileSync(join(tmpDir, "SKILL.md"), "# My Agent\n");

      await expect(
        runExecute("some-agent", undefined, { project: tmpDir })
      ).rejects.toThrow("looks like an agent directory");
    });

    it("throws Error (not ConfigError) for SKILL.md guard in run command", async () => {
      writeFileSync(join(tmpDir, "SKILL.md"), "# Agent");

      let caught: unknown;
      try {
        await runExecute("some-agent", undefined, { project: tmpDir });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeDefined();
      expect(caught instanceof Error).toBe(true);
      expect(caught instanceof ConfigError).toBe(false);
    });

    it("throws Error 'not found' when agent name is not in the project", async () => {
      // Write global config and one agent
      writeFileSync(join(tmpDir, "config.toml"), '[models.sonnet]\nprovider = "anthropic"\nmodel = "claude-3-5-sonnet-20241022"\nauthType = "api_key"\n');
      const agentDir = join(tmpDir, "agents", "real-agent");
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(join(agentDir, "SKILL.md"), "---\ndescription: test\n---\n# real-agent\n");
      writeFileSync(join(agentDir, "config.toml"), 'models = ["sonnet"]\nschedule = "0 0 31 2 *"\n');

      await expect(
        runExecute("nonexistent-agent", undefined, { project: tmpDir })
      ).rejects.toThrow('Agent "nonexistent-agent" not found');
    });

    it("error includes available agents list when project has agents", async () => {
      writeFileSync(join(tmpDir, "config.toml"), '[models.sonnet]\nprovider = "anthropic"\nmodel = "claude-3-5-sonnet-20241022"\nauthType = "api_key"\n');
      const agentDir = join(tmpDir, "agents", "alpha-agent");
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(join(agentDir, "SKILL.md"), "---\ndescription: test\n---\n# alpha-agent\n");
      writeFileSync(join(agentDir, "config.toml"), 'models = ["sonnet"]\nschedule = "0 0 31 2 *"\n');

      let caughtError: Error | undefined;
      try {
        await runExecute("beta-agent", undefined, { project: tmpDir });
      } catch (err) {
        if (err instanceof Error) caughtError = err;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError!.message).toContain("alpha-agent");
      expect(caughtError!.message).toContain("Available agents:");
    });

    it("error includes 'No agents found' when project has no agents", async () => {
      writeFileSync(join(tmpDir, "config.toml"), '[models.sonnet]\nprovider = "anthropic"\nmodel = "claude-3-5-sonnet-20241022"\nauthType = "api_key"\n');
      // No agents/ directory

      let caughtError: Error | undefined;
      try {
        await runExecute("any-agent", undefined, { project: tmpDir });
      } catch (err) {
        if (err instanceof Error) caughtError = err;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError!.message).toContain("No agents found");
    });

    it("SKILL.md guard takes priority over agent-not-found check", async () => {
      // SKILL.md exists AND the agent doesn't exist
      writeFileSync(join(tmpDir, "SKILL.md"), "# Agent");

      let caughtError: Error | undefined;
      try {
        await runExecute("nonexistent-agent", undefined, { project: tmpDir });
      } catch (err) {
        if (err instanceof Error) caughtError = err;
      }

      expect(caughtError).toBeDefined();
      // Should be the SKILL.md error, not the agent-not-found error
      expect(caughtError!.message).toContain("agent directory");
      expect(caughtError!.message).not.toContain("not found");
    });
  },
);
