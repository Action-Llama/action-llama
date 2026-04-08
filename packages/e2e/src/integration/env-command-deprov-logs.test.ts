/**
 * Integration tests: cli/commands/env.ts deprov(), prov(), and logs() error guards
 * — no Docker required.
 *
 * The `al env deprov`, `al env prov`, and `al env logs` commands each have
 * early-exit error guards that can be tested without Docker, SSH, or real
 * cloud provisioning:
 *
 *   deprov(name, opts):
 *     1. Non-existent environment → ConfigError "not found"
 *     2. Environment with no [server] section → ConfigError "has no [server] config"
 *
 *   prov(name):
 *     3. Invalid name (uppercase) → ConfigError "Invalid environment name"
 *     4. Invalid name (leading hyphen) → ConfigError "Invalid environment name"
 *     5. Already-existing environment with REPLACE_ME host proceeds to
 *        setupVpsCloud (interactive, so we only test the guard path).
 *        — Actually, this path still calls setupVpsCloud; only guard paths tested.
 *
 *   logs(name, opts):
 *     6. No name and no .env.toml binding → ConfigError "No environment specified"
 *     7. Non-existent environment name → ConfigError "not found"
 *     8. Environment with no [server] config → ConfigError "has no [server] config"
 *
 * All tests create minimal environment files in ~/.action-llama/environments/
 * with uniquely-timestamped names and clean up in afterEach.
 *
 * Covers:
 *   - cli/commands/env.ts: deprov() non-existent env → ConfigError "not found"
 *   - cli/commands/env.ts: deprov() env with no [server] → ConfigError "has no [server]"
 *   - cli/commands/env.ts: prov() invalid name → ConfigError "Invalid environment name"
 *   - cli/commands/env.ts: logs() no name, no .env.toml → ConfigError "No environment specified"
 *   - cli/commands/env.ts: logs() non-existent env → ConfigError "not found"
 *   - cli/commands/env.ts: logs() env with no [server] → ConfigError "has no [server] config"
 */

import { describe, it, expect, afterEach } from "vitest";
import { existsSync, rmSync, mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const {
  deprov: envDeprov,
  prov: envProv,
  logs: envLogs,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cli/commands/env.js"
);

const {
  writeEnvironmentConfig,
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

// ── Helpers ────────────────────────────────────────────────────────────────

const UNIQUE = `al-test-deprov-${Date.now()}`;
let counter = 0;
function uniqueName(): string {
  return `${UNIQUE}-${++counter}`;
}

// Track created environment files for cleanup
const createdEnvs: string[] = [];

afterEach(() => {
  for (const name of createdEnvs.splice(0)) {
    try {
      const p = environmentPath(name);
      if (existsSync(p)) rmSync(p);
    } catch { /* best effort */ }
  }
});

/** Write a minimal environment file with [server] section and register for cleanup. */
function writeServerEnv(name: string): void {
  writeEnvironmentConfig(name, {
    server: { host: "192.0.2.1", user: "root", port: 22 },
  });
  createdEnvs.push(name);
}

/** Write a minimal environment file WITHOUT a [server] section. */
function writeNonServerEnv(name: string): void {
  writeEnvironmentConfig(name, {
    gateway: { url: "http://example.com:8080" },
  } as any);
  createdEnvs.push(name);
}

// ── deprov() error guards ─────────────────────────────────────────────────

describe(
  "integration: cli/commands/env.ts deprov() error guards (no Docker required)",
  { timeout: 30_000 },
  () => {
    it("throws ConfigError when environment does not exist", async () => {
      const name = uniqueName();
      // Do NOT create the env file

      await expect(
        envDeprov(name, { project: "/tmp/nonexistent-project" })
      ).rejects.toSatisfy(
        (err: unknown) => err instanceof ConfigError && (err as ConfigError).message.includes("not found")
      );
    });

    it("deprov() not-found error is a ConfigError (not plain Error)", async () => {
      const name = uniqueName();
      let caught: unknown;
      try {
        await envDeprov(name, { project: "/tmp/nonexistent-project" });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      expect(caught instanceof ConfigError).toBe(true);
    });

    it("throws ConfigError when environment has no [server] config", async () => {
      const name = uniqueName();
      writeNonServerEnv(name);

      await expect(
        envDeprov(name, { project: "/tmp/nonexistent-project" })
      ).rejects.toSatisfy(
        (err: unknown) =>
          err instanceof ConfigError &&
          (err as ConfigError).message.includes("has no [server] config")
      );
    });

    it("deprov() error for missing [server] references the environment name", async () => {
      const name = uniqueName();
      writeNonServerEnv(name);

      let caught: ConfigError | undefined;
      try {
        await envDeprov(name, { project: "/tmp/nonexistent-project" });
      } catch (err) {
        if (err instanceof ConfigError) caught = err;
      }
      expect(caught).toBeDefined();
      expect(caught!.message).toContain(name);
    });
  },
);

// ── prov() error guards ───────────────────────────────────────────────────

describe(
  "integration: cli/commands/env.ts prov() error guards (no Docker required)",
  { timeout: 30_000 },
  () => {
    it("throws ConfigError when environment name is invalid (uppercase)", async () => {
      await expect(
        envProv("InvalidName")
      ).rejects.toSatisfy(
        (err: unknown) =>
          err instanceof ConfigError &&
          (err as ConfigError).message.includes("Invalid environment name")
      );
    });

    it("throws ConfigError when environment name starts with a hyphen", async () => {
      await expect(
        envProv("-leading-hyphen")
      ).rejects.toSatisfy(
        (err: unknown) =>
          err instanceof ConfigError &&
          (err as ConfigError).message.includes("Invalid environment name")
      );
    });

    it("throws ConfigError when environment name has underscore", async () => {
      await expect(
        envProv("bad_name")
      ).rejects.toSatisfy(
        (err: unknown) =>
          err instanceof ConfigError &&
          (err as ConfigError).message.includes("Invalid environment name")
      );
    });

    it("prov() invalid name error is a ConfigError instance", async () => {
      let caught: unknown;
      try {
        await envProv("INVALID");
      } catch (err) {
        caught = err;
      }
      expect(caught instanceof ConfigError).toBe(true);
    });

    it("prov() invalid name error includes the bad name", async () => {
      const badName = "BAD_NAME";
      let caught: ConfigError | undefined;
      try {
        await envProv(badName);
      } catch (err) {
        if (err instanceof ConfigError) caught = err;
      }
      expect(caught).toBeDefined();
      expect(caught!.message).toContain(badName);
    });
  },
);

// ── logs() error guards ───────────────────────────────────────────────────

describe(
  "integration: cli/commands/env.ts logs() error guards (no Docker required)",
  { timeout: 30_000 },
  () => {
    it("throws ConfigError when no environment name and no .env.toml binding", async () => {
      const projectDir = mkdtempSync(join(tmpdir(), "al-env-logs-"));

      await expect(
        envLogs(undefined, { project: projectDir })
      ).rejects.toSatisfy(
        (err: unknown) =>
          err instanceof ConfigError &&
          (err as ConfigError).message.includes("No environment specified")
      );
    });

    it("logs() no-env error is a ConfigError instance", async () => {
      const projectDir = mkdtempSync(join(tmpdir(), "al-env-logs-"));
      let caught: unknown;
      try {
        await envLogs(undefined, { project: projectDir });
      } catch (err) {
        caught = err;
      }
      expect(caught instanceof ConfigError).toBe(true);
    });

    it("throws ConfigError when named environment does not exist", async () => {
      const name = uniqueName();
      // Do NOT create the env file

      await expect(
        envLogs(name, { project: "/tmp/nonexistent" })
      ).rejects.toSatisfy(
        (err: unknown) =>
          err instanceof ConfigError &&
          (err as ConfigError).message.includes("not found")
      );
    });

    it("throws ConfigError when environment has no [server] section", async () => {
      const name = uniqueName();
      writeNonServerEnv(name);

      await expect(
        envLogs(name, { project: "/tmp/nonexistent" })
      ).rejects.toSatisfy(
        (err: unknown) =>
          err instanceof ConfigError &&
          (err as ConfigError).message.includes("has no [server] config")
      );
    });

    it("logs() no-server error references the environment name", async () => {
      const name = uniqueName();
      writeNonServerEnv(name);

      let caught: ConfigError | undefined;
      try {
        await envLogs(name, { project: "/tmp/nonexistent" });
      } catch (err) {
        if (err instanceof ConfigError) caught = err;
      }
      expect(caught).toBeDefined();
      expect(caught!.message).toContain(name);
    });

    it("logs() not-found error references the environment name", async () => {
      const name = uniqueName();

      let caught: ConfigError | undefined;
      try {
        await envLogs(name, { project: "/tmp/nonexistent" });
      } catch (err) {
        if (err instanceof ConfigError) caught = err;
      }
      expect(caught).toBeDefined();
      expect(caught!.message).toContain(name);
    });
  },
);
