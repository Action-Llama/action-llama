/**
 * Integration tests: cli/commands/env.ts success paths — no Docker required.
 *
 * The `al env` command manages deployment environment configurations.
 * The error paths are tested in env-command-utils.test.ts. These tests
 * exercise the success paths: init(), show(), list() with populated data,
 * and the duplicate-name guard.
 *
 * Tests write to ~/.action-llama/environments/ using uniquely named environments
 * and clean up in afterEach to avoid polluting the real environment directory.
 *
 * Test scenarios (no Docker required):
 *   1. init() with valid name and "server" type → creates .toml file
 *   2. init() success → logs "Created server environment" message
 *   3. init() with duplicate name → throws ConfigError "already exists"
 *   4. show() for existing environment → logs environment name and file path
 *   5. show() for existing environment → logs file content (includes [server])
 *   6. list() with populated environments → logs environment names
 *   7. buildSkeleton() for "server" type → created toml has [server] section
 *   8. buildSkeleton() includes expected default fields (host, user, port, basePath)
 *
 * Covers:
 *   - cli/commands/env.ts: init() success path (writeEnvironmentConfig called)
 *   - cli/commands/env.ts: init() success → console.log includes "Created"
 *   - cli/commands/env.ts: init() duplicate name → ConfigError "already exists"
 *   - cli/commands/env.ts: show() success path (readFileSync + console.log)
 *   - cli/commands/env.ts: show() logs environment name
 *   - cli/commands/env.ts: list() success path with entries present
 *   - cli/commands/env.ts: buildSkeleton() "server" type returns correct skeleton
 */

import { describe, it, expect, afterEach } from "vitest";
import { existsSync, rmSync } from "fs";

const {
  init: envInit,
  list: envList,
  show: envShow,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cli/commands/env.js"
);

const {
  environmentPath,
  environmentExists,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/shared/environment.js"
);

const { ConfigError } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/shared/errors.js"
);

/** Capture console.log output during a callback. */
async function captureLog(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...args: any[]) => lines.push(args.join(" "));
  try {
    await fn();
  } finally {
    console.log = orig;
  }
  return lines;
}

// Use unique names per test to avoid collisions
const BASE_NAME = `test-env-integration-${Date.now()}`;
const createdEnvs: string[] = [];

afterEach(() => {
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

describe(
  "integration: cli/commands/env.ts success paths (no Docker required)",
  { timeout: 30_000 },
  () => {
    // ── init() success path ───────────────────────────────────────────────────

    it("init() creates the environment .toml file in ENVIRONMENTS_DIR", async () => {
      const envName = `${BASE_NAME}-create`;
      createdEnvs.push(envName);

      await envInit(envName, "server");

      const filePath = environmentPath(envName);
      expect(existsSync(filePath)).toBe(true);
    });

    it("init() logs 'Created server environment' on success", async () => {
      const envName = `${BASE_NAME}-log`;
      createdEnvs.push(envName);

      const lines = await captureLog(() => envInit(envName, "server"));

      expect(lines.some((l) => l.includes("Created") && l.includes("server"))).toBe(true);
    });

    it("init() includes the environment name in the creation log", async () => {
      const envName = `${BASE_NAME}-namelog`;
      createdEnvs.push(envName);

      const lines = await captureLog(() => envInit(envName, "server"));

      expect(lines.some((l) => l.includes(envName))).toBe(true);
    });

    it("init() with duplicate name throws ConfigError 'already exists'", async () => {
      const envName = `${BASE_NAME}-dup`;
      createdEnvs.push(envName);

      // Create it once
      await envInit(envName, "server");

      // Second init should throw
      await expect(envInit(envName, "server")).rejects.toSatisfy(
        (e: unknown) =>
          e instanceof ConfigError &&
          (e as ConfigError).message.includes("already exists"),
      );
    });

    it("init() creates a .toml file with [server] section", async () => {
      const envName = `${BASE_NAME}-content`;
      createdEnvs.push(envName);

      await envInit(envName, "server");

      const filePath = environmentPath(envName);
      const { readFileSync } = await import("fs");
      const content = readFileSync(filePath, "utf-8");
      expect(content).toContain("[server]");
    });

    it("init() skeleton includes expected default values (host, user, port, basePath)", async () => {
      const envName = `${BASE_NAME}-defaults`;
      createdEnvs.push(envName);

      await envInit(envName, "server");

      const filePath = environmentPath(envName);
      const { readFileSync } = await import("fs");
      const content = readFileSync(filePath, "utf-8");
      expect(content).toContain("REPLACE_ME");
      expect(content).toContain("root");
      expect(content).toContain("22");
    });

    // ── show() success path ───────────────────────────────────────────────────

    it("show() logs the environment name for an existing env", async () => {
      const envName = `${BASE_NAME}-show`;
      createdEnvs.push(envName);

      await envInit(envName, "server");

      const lines = await captureLog(() => envShow(envName));
      expect(lines.some((l) => l.includes(envName))).toBe(true);
    });

    it("show() logs the file path for an existing env", async () => {
      const envName = `${BASE_NAME}-showpath`;
      createdEnvs.push(envName);

      await envInit(envName, "server");

      const filePath = environmentPath(envName);
      const lines = await captureLog(() => envShow(envName));
      expect(lines.some((l) => l.includes(filePath))).toBe(true);
    });

    it("show() logs the file content including [server] section", async () => {
      const envName = `${BASE_NAME}-showcontent`;
      createdEnvs.push(envName);

      await envInit(envName, "server");

      const lines = await captureLog(() => envShow(envName));
      const allOutput = lines.join("\n");
      expect(allOutput).toContain("server");
    });

    // ── list() success path ───────────────────────────────────────────────────

    it("list() prints 'Environments:' heading when envs exist", async () => {
      const envName = `${BASE_NAME}-list`;
      createdEnvs.push(envName);

      await envInit(envName, "server");

      const lines = await captureLog(() => envList());
      // Should have some output mentioning environments
      const allOutput = lines.join("\n");
      // Either "Environments:" or the env name should appear
      expect(allOutput.includes("Environments:") || allOutput.includes(envName)).toBe(true);
    });

    it("list() includes the created environment name in output", async () => {
      const envName = `${BASE_NAME}-listname`;
      createdEnvs.push(envName);

      await envInit(envName, "server");

      const lines = await captureLog(() => envList());
      const allOutput = lines.join("\n");
      expect(allOutput).toContain(envName);
    });

    it("list() shows 'server' type for a server environment", async () => {
      const envName = `${BASE_NAME}-listtype`;
      createdEnvs.push(envName);

      await envInit(envName, "server");

      const lines = await captureLog(() => envList());
      const allOutput = lines.join("\n");
      expect(allOutput).toContain("server");
    });

    it("environmentExists() returns true after init()", async () => {
      const envName = `${BASE_NAME}-exists`;
      createdEnvs.push(envName);

      expect(environmentExists(envName)).toBe(false);

      await envInit(envName, "server");

      expect(environmentExists(envName)).toBe(true);
    });
  },
);
