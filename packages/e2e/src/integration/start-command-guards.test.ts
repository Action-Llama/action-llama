/**
 * Integration tests: cli/commands/start.ts execute() validation guards — no Docker required.
 *
 * The `al start` command (cli/commands/start.ts) performs two early validation
 * checks before running any scheduler or credential logic:
 *
 *   1. SKILL.md guard — if a SKILL.md file exists in the project path, throw
 *      an Error because the path looks like an agent directory (not a project).
 *      This prevents users from accidentally running `al start` inside an
 *      agent subdirectory instead of the project root.
 *
 *   2. Gateway API key security check — if `--web-ui` or `--expose` is
 *      requested, and the `gateway_api_key/default` credential is absent,
 *      throw a ConfigError. This prevents accidentally exposing the gateway
 *      without authentication.
 *
 * Both guards throw before calling runDoctor(), loadGlobalConfig(), or
 * startScheduler(), so they can be tested without Docker, credentials
 * (except for the API key check), or a real project structure.
 *
 * Test scenarios (no Docker required):
 *   1. Project path contains SKILL.md → throw Error with "agent directory" message
 *   2. Project path has no SKILL.md → guard passes (does not throw for this check)
 *   3. webUi=true without gateway_api_key → throw ConfigError "Gateway API key required"
 *   4. expose=true without gateway_api_key → throw ConfigError "Gateway API key required"
 *   5. webUi=false, expose=false → API key guard is not checked (skipped)
 *   6. SKILL.md guard is checked before API key guard (SKILL.md error takes priority)
 *
 * Covers:
 *   - cli/commands/start.ts: existsSync(SKILL.md) guard → throw Error (lines 18-23)
 *   - cli/commands/start.ts: credentialExists("gateway_api_key") guard → throw ConfigError (lines 25-30)
 *   - cli/commands/start.ts: webUi=false && expose=false → skip API key check
 *   - cli/commands/start.ts: SKILL.md check precedes credentialExists check
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { setDefaultBackend, resetDefaultBackend } from "@action-llama/action-llama/internals/credentials";
import { FilesystemBackend } from "@action-llama/action-llama/internals/filesystem-backend";

const { execute: startExecute } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cli/commands/start.js"
);

const { ConfigError } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/shared/errors.js"
);

describe(
  "integration: cli/commands/start.ts execute() validation guards (no Docker required)",
  { timeout: 30_000 },
  () => {
    let tmpDir: string;
    let credDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "al-start-guard-"));
      credDir = mkdtempSync(join(tmpdir(), "al-start-creds-"));
      // Point credential system at a fresh, empty directory
      setDefaultBackend(new FilesystemBackend(credDir));
    });

    afterEach(() => {
      resetDefaultBackend();
      rmSync(tmpDir, { recursive: true, force: true });
      rmSync(credDir, { recursive: true, force: true });
    });

    it("throws Error with 'agent directory' message when SKILL.md exists in project path", async () => {
      // Create a SKILL.md file in the temp dir (simulating an agent directory)
      writeFileSync(join(tmpDir, "SKILL.md"), "# My Agent\n\nThis is a test agent.");

      await expect(
        startExecute({ project: tmpDir })
      ).rejects.toThrow("looks like an agent directory");
    });

    it("throws an Error (not ConfigError) for SKILL.md guard", async () => {
      writeFileSync(join(tmpDir, "SKILL.md"), "# Agent");

      await expect(
        startExecute({ project: tmpDir })
      ).rejects.toSatisfy(
        (err: unknown) => err instanceof Error && !(err instanceof ConfigError)
      );
    });

    it("SKILL.md guard message includes project path and 'al start' hint", async () => {
      writeFileSync(join(tmpDir, "SKILL.md"), "# Agent");

      let caughtError: Error | undefined;
      try {
        await startExecute({ project: tmpDir });
      } catch (err) {
        if (err instanceof Error) caughtError = err;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError!.message).toContain("al start");
      expect(caughtError!.message).toContain("project root");
    });

    it("throws ConfigError 'Gateway API key required' when webUi=true and no gateway_api_key credential", async () => {
      // No SKILL.md → SKILL.md guard passes
      // No gateway_api_key credential → API key guard triggers
      await expect(
        startExecute({ project: tmpDir, webUi: true })
      ).rejects.toSatisfy(
        (err: unknown) => err instanceof ConfigError &&
          (err as ConfigError).message.includes("Gateway API key required")
      );
    });

    it("throws ConfigError 'Gateway API key required' when expose=true and no gateway_api_key credential", async () => {
      await expect(
        startExecute({ project: tmpDir, expose: true })
      ).rejects.toSatisfy(
        (err: unknown) => err instanceof ConfigError &&
          (err as ConfigError).message.includes("Gateway API key required")
      );
    });

    it("SKILL.md guard takes priority over API key guard — error is Error not ConfigError when both conditions exist", async () => {
      // Both: SKILL.md exists AND no gateway_api_key
      writeFileSync(join(tmpDir, "SKILL.md"), "# Agent");

      let caughtError: Error | undefined;
      try {
        await startExecute({ project: tmpDir, webUi: true });
      } catch (err) {
        if (err instanceof Error) caughtError = err;
      }

      expect(caughtError).toBeDefined();
      // Should be the SKILL.md error, not the ConfigError
      expect(caughtError!.message).toContain("agent directory");
      expect(caughtError! instanceof ConfigError).toBe(false);
    });

    it("gateway API key check is skipped when webUi=false and expose=false (but fails later on missing config)", async () => {
      // No SKILL.md, no webUi, no expose → API key guard is skipped.
      // The command will then call runDoctor() which may throw for missing agents,
      // but NOT for the API key. The error message should NOT contain "Gateway API key".
      let caughtError: Error | undefined;
      try {
        await startExecute({ project: tmpDir, webUi: false, expose: false });
      } catch (err) {
        if (err instanceof Error) caughtError = err;
      }

      // An error is expected (no agents configured), but it should not be the API key error
      expect(caughtError).toBeDefined();
      expect(caughtError!.message).not.toContain("Gateway API key required");
    });
  },
);
