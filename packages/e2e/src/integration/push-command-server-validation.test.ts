/**
 * Integration tests: cli/commands/push.ts additional validation guards — no Docker required.
 *
 * Tests the validation guards that occur AFTER environment resolution
 * but BEFORE SSH connections:
 *
 *   1. Environment found but has no [server] section → ConfigError
 *   2. Project has no agents → ConfigError "No agents found"
 *   3. Named agent not found → ConfigError "not found" + available agents
 *
 * These tests create real environment files in ~/.action-llama/environments/
 * using unique names and clean up in afterEach.
 *
 * Test scenarios (no Docker required):
 *   1. --env points to env with no [server] section → ConfigError "has no [server]"
 *   2. Error for missing [server] includes the env name
 *   3. Project with no agents → ConfigError "No agents found"
 *   4. --agent pointing to nonexistent agent → ConfigError "not found"
 *   5. Error for missing agent includes the agent name
 *   6. Error for missing agent mentions available agents
 *
 * Covers:
 *   - cli/commands/push.ts: envConfig.server check → ConfigError "has no [server]"
 *   - cli/commands/push.ts: agents.length === 0 → ConfigError "No agents found"
 *   - cli/commands/push.ts: named agent not found → ConfigError with agent name
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
  existsSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { stringify as stringifyTOML } from "smol-toml";

const { execute: pushExecute } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cli/commands/push.js"
);

const { ConfigError } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/shared/errors.js"
);

const {
  writeEnvironmentConfig,
  environmentPath,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/shared/environment.js"
);

const BASE_ENV_NAME = `push-test-env-${Date.now()}`;
const createdEnvs: string[] = [];

/** Create a minimal valid project directory with config.toml. */
function setupProject(projectDir: string): void {
  mkdirSync(projectDir, { recursive: true });
  const globalConfig = {
    models: {
      sonnet: {
        provider: "anthropic",
        model: "claude-3-5-sonnet-20241022",
        authType: "api_key",
      },
    },
  };
  writeFileSync(join(projectDir, "config.toml"), stringifyTOML(globalConfig as any));
}

/** Add a minimal agent to the project. */
function addAgent(projectDir: string, agentName: string): void {
  const agentDir = join(projectDir, "agents", agentName);
  mkdirSync(agentDir, { recursive: true });

  writeFileSync(join(agentDir, "SKILL.md"), `# ${agentName}\nTest agent.`);

  const agentConfig = {
    schedule: "0 * * * *",
    models: [{ name: "sonnet" }],
  };
  writeFileSync(join(agentDir, "config.toml"), stringifyTOML(agentConfig as any));
}

describe(
  "integration: cli/commands/push.ts server validation guards (no Docker required)",
  { timeout: 30_000 },
  () => {
    let projectDir: string;

    beforeEach(() => {
      projectDir = mkdtempSync(join(tmpdir(), "al-push-srv-test-"));
      setupProject(projectDir);
      // Clear AL_ENV to avoid interference
      delete process.env.AL_ENV;
    });

    afterEach(() => {
      rmSync(projectDir, { recursive: true, force: true });
      delete process.env.AL_ENV;
      // Clean up any environments created during tests
      for (const name of createdEnvs) {
        try {
          const envFilePath = environmentPath(name);
          if (existsSync(envFilePath)) {
            rmSync(envFilePath);
          }
        } catch {
          // ignore cleanup errors
        }
      }
      createdEnvs.length = 0;
    });

    // ── Environment has no [server] section ───────────────────────────────────

    it("throws ConfigError when environment has no [server] section", async () => {
      const envName = `${BASE_ENV_NAME}-noserver`;
      createdEnvs.push(envName);

      // Write an env config without [server]
      writeEnvironmentConfig(envName, { projectName: "test" } as any);

      await expect(
        pushExecute({ project: projectDir, env: envName })
      ).rejects.toSatisfy(
        (e: unknown) => e instanceof ConfigError && (e as ConfigError).message.includes("[server]"),
      );
    });

    it("ConfigError for missing [server] mentions the environment name", async () => {
      const envName = `${BASE_ENV_NAME}-noserverN`;
      createdEnvs.push(envName);

      writeEnvironmentConfig(envName, { projectName: "test" } as any);

      let caught: Error | undefined;
      try {
        await pushExecute({ project: projectDir, env: envName });
      } catch (err) {
        if (err instanceof Error) caught = err;
      }

      expect(caught).toBeDefined();
      expect(caught!.message).toContain(envName);
    });

    // ── No agents in project ──────────────────────────────────────────────────

    it("throws ConfigError when project has no agents", async () => {
      const envName = `${BASE_ENV_NAME}-noagents`;
      createdEnvs.push(envName);

      // Create env with [server] section but minimal config
      writeEnvironmentConfig(envName, {
        server: { host: "1.2.3.4" },
      } as any);

      await expect(
        pushExecute({ project: projectDir, env: envName })
      ).rejects.toSatisfy(
        (e: unknown) => e instanceof ConfigError && (e as ConfigError).message.includes("No agents found"),
      );
    });

    it("ConfigError for no agents is a ConfigError instance", async () => {
      const envName = `${BASE_ENV_NAME}-noagentsCI`;
      createdEnvs.push(envName);

      writeEnvironmentConfig(envName, { server: { host: "1.2.3.4" } } as any);

      let caught: unknown;
      try {
        await pushExecute({ project: projectDir, env: envName });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeDefined();
      expect(caught instanceof ConfigError).toBe(true);
    });

    // ── Named agent not found ─────────────────────────────────────────────────

    it("throws ConfigError when --agent points to nonexistent agent", async () => {
      const envName = `${BASE_ENV_NAME}-noagent`;
      createdEnvs.push(envName);

      writeEnvironmentConfig(envName, { server: { host: "1.2.3.4" } } as any);
      addAgent(projectDir, "real-agent");

      await expect(
        pushExecute({ project: projectDir, env: envName, agent: "nonexistent-agent" })
      ).rejects.toSatisfy(
        (e: unknown) => e instanceof ConfigError && (e as ConfigError).message.includes("nonexistent-agent"),
      );
    });

    it("ConfigError for missing agent includes available agents", async () => {
      const envName = `${BASE_ENV_NAME}-agentlist`;
      createdEnvs.push(envName);

      writeEnvironmentConfig(envName, { server: { host: "1.2.3.4" } } as any);
      addAgent(projectDir, "available-agent");

      let caught: Error | undefined;
      try {
        await pushExecute({ project: projectDir, env: envName, agent: "missing-agent" });
      } catch (err) {
        if (err instanceof Error) caught = err;
      }

      expect(caught).toBeDefined();
      expect(caught!.message).toContain("available-agent");
    });
  },
);
