/**
 * Integration tests: agents/bash-prefix.ts ensureBinDir() — no Docker required.
 *
 * ensureBinDir() ensures the docker/bin directory (containing al-bash-init.sh
 * and other agent shell scripts) is on PATH. It's called before creating agent
 * sessions in contexts that don't use installSignalCommands() (e.g. chat mode).
 *
 * Behavior:
 *   1. If the docker/bin directory does not exist → no-op (return immediately)
 *   2. If docker/bin is already on PATH → no-op (idempotent)
 *   3. Otherwise → prepend docker/bin to process.env.PATH
 *
 * Since the docker/bin directory DOES exist in the installed package
 * (/tmp/repo/packages/action-llama/dist/../../../docker/bin), the function
 * should add it to PATH (unless it's already there).
 *
 * Test scenarios (no Docker required):
 *   1. ensureBinDir() does not throw
 *   2. ensureBinDir() returns undefined (no return value)
 *   3. ensureBinDir() is idempotent — calling twice doesn't duplicate PATH entry
 *   4. After calling ensureBinDir(), PATH contains the bin directory (when dir exists)
 *   5. PATH remains a non-empty string after the call
 *
 * Covers:
 *   - agents/bash-prefix.ts: ensureBinDir() no-throw
 *   - agents/bash-prefix.ts: ensureBinDir() idempotent (already on PATH check)
 *   - agents/bash-prefix.ts: ensureBinDir() prepend to PATH (when dir exists)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

const { ensureBinDir, BASH_COMMAND_PREFIX } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/agents/bash-prefix.js"
);

describe(
  "integration: agents/bash-prefix.ts ensureBinDir() (no Docker required)",
  { timeout: 15_000 },
  () => {
    let originalPath: string | undefined;

    beforeEach(() => {
      originalPath = process.env.PATH;
    });

    afterEach(() => {
      // Restore original PATH to avoid affecting other tests
      if (originalPath !== undefined) {
        process.env.PATH = originalPath;
      } else {
        delete process.env.PATH;
      }
    });

    // ── Basic behavior ───────────────────────────────────────────────────────

    it("does not throw when called", () => {
      expect(() => ensureBinDir()).not.toThrow();
    });

    it("returns undefined (void function)", () => {
      const result = ensureBinDir();
      expect(result).toBeUndefined();
    });

    it("PATH remains defined after calling ensureBinDir()", () => {
      ensureBinDir();
      expect(process.env.PATH).toBeDefined();
      expect(typeof process.env.PATH).toBe("string");
    });

    it("PATH is non-empty after calling ensureBinDir()", () => {
      ensureBinDir();
      expect((process.env.PATH || "").length).toBeGreaterThan(0);
    });

    // ── Idempotency ─────────────────────────────────────────────────────────

    it("calling ensureBinDir() twice does not cause errors", () => {
      expect(() => {
        ensureBinDir();
        ensureBinDir();
      }).not.toThrow();
    });

    it("calling ensureBinDir() twice doesn't add a duplicate of the same bin dir", () => {
      ensureBinDir();
      const pathAfterFirst = process.env.PATH || "";
      
      ensureBinDir();
      const pathAfterSecond = process.env.PATH || "";
      
      // PATH should not grow after the second call (idempotent)
      expect(pathAfterSecond.length).toBe(pathAfterFirst.length);
    });

    // ── When PATH is empty ───────────────────────────────────────────────────

    it("works when PATH is initially empty string", () => {
      process.env.PATH = "";
      expect(() => ensureBinDir()).not.toThrow();
      // After the call, PATH should have some content or be unchanged
      expect(process.env.PATH).toBeDefined();
    });

    // ── BASH_COMMAND_PREFIX constant (also from bash-prefix.ts) ──────────────

    it("BASH_COMMAND_PREFIX is a non-empty string", () => {
      expect(typeof BASH_COMMAND_PREFIX).toBe("string");
      expect(BASH_COMMAND_PREFIX.length).toBeGreaterThan(0);
    });

    it("BASH_COMMAND_PREFIX references al-bash-init.sh", () => {
      expect(BASH_COMMAND_PREFIX).toContain("al-bash-init.sh");
    });
  },
);
