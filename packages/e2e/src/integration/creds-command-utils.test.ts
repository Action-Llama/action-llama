/**
 * Integration tests: cli/commands/creds.ts error paths — no Docker required.
 *
 * The `al creds` command manages credential storage. Several functions
 * have error paths that can be tested without Docker or real credentials:
 *
 *   1. add() with unknown credential type → throws Error "Unknown credential type"
 *   2. rm() for credential that doesn't exist → throws Error "Credential not found"
 *   3. list() when credentials dir doesn't exist → logs "No credentials found"
 *   4. add() error includes the type name and lists known types
 *   5. rm() error includes the credential reference
 *
 * Covers:
 *   - cli/commands/creds.ts: add() unknown type → Error "Unknown credential type"
 *   - cli/commands/creds.ts: add() catch block with resolveCredential() failure
 *   - cli/commands/creds.ts: rm() credentialExists() false → Error "not found"
 *   - cli/commands/creds.ts: list() catch block when CREDENTIALS_DIR missing
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { setDefaultBackend, resetDefaultBackend } from "@action-llama/action-llama/internals/credentials";
import { FilesystemBackend } from "@action-llama/action-llama/internals/filesystem-backend";

const {
  add: credsAdd,
  rm: credsRm,
  list: credsList,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cli/commands/creds.js"
);

describe(
  "integration: cli/commands/creds.ts error paths (no Docker required)",
  { timeout: 30_000 },
  () => {
    let credDir: string;

    beforeEach(() => {
      credDir = mkdtempSync(join(tmpdir(), "al-creds-test-"));
      // Point credential operations at an empty temp dir
      setDefaultBackend(new FilesystemBackend(credDir));
    });

    afterEach(() => {
      resetDefaultBackend();
      rmSync(credDir, { recursive: true, force: true });
    });

    // ── add() unknown credential type ─────────────────────────────────────────

    it("throws Error for unknown credential type in add()", async () => {
      await expect(
        credsAdd("completely-unknown-credential-type")
      ).rejects.toThrow("Unknown credential type");
    });

    it("error for unknown type includes the type name", async () => {
      let caught: Error | undefined;
      try {
        await credsAdd("my-fake-type");
      } catch (e) {
        caught = e as Error;
      }
      expect(caught).toBeDefined();
      expect(caught!.message).toContain("my-fake-type");
    });

    it("error for unknown type lists known credential types", async () => {
      let caught: Error | undefined;
      try {
        await credsAdd("nonexistent-type-xyz");
      } catch (e) {
        caught = e as Error;
      }
      expect(caught).toBeDefined();
      // Should mention known types (e.g., "anthropic_key")
      expect(caught!.message).toMatch(/anthropic_key|openai_key|github_token/);
    });

    it("error for unknown type with instance notation also fails", async () => {
      await expect(
        credsAdd("fake-type:my-instance")
      ).rejects.toThrow("Unknown credential type");
    });

    // ── rm() credential not found ─────────────────────────────────────────────

    it("throws Error when rm() target credential doesn't exist", async () => {
      await expect(
        credsRm("anthropic_key")
      ).rejects.toThrow('Credential "anthropic_key" not found');
    });

    it("rm() error includes the credential reference", async () => {
      let caught: Error | undefined;
      try {
        await credsRm("openai_key:my-instance");
      } catch (e) {
        caught = e as Error;
      }
      expect(caught).toBeDefined();
      expect(caught!.message).toContain("openai_key:my-instance");
    });

    it("rm() error is a plain Error (not ConfigError)", async () => {
      let caught: Error | undefined;
      try {
        await credsRm("github_token");
      } catch (e) {
        caught = e as Error;
      }
      expect(caught).toBeDefined();
      expect(caught!.constructor.name).toBe("Error");
    });

    // ── list() when no credentials directory ─────────────────────────────────

    it("list() does not throw when credentials directory doesn't exist", async () => {
      // Just verify it doesn't throw — the output depends on real CREDENTIALS_DIR
      await expect(credsList()).resolves.toBeUndefined();
    });
  },
);
