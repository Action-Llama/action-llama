/**
 * Integration tests: agents/signals.ts — no Docker required.
 *
 * The signals module provides file-based IPC between agent shell scripts
 * and the runner. readSignals() reads signal files from a directory to
 * detect rerun/status/return/exit signals written by al-rerun/al-status/
 * al-return/al-exit commands.
 *
 * The module has no direct test coverage. readSignals() is a pure
 * filesystem-reading function that is easy to test by creating temporary
 * signal directories.
 *
 * Test scenarios (no Docker required):
 *   1. readSignals: returns defaults when signalDir doesn't exist
 *   2. readSignals: returns defaults when signalDir is empty
 *   3. readSignals: rerun:true when 'rerun' file exists
 *   4. readSignals: status populated from 'status' file
 *   5. readSignals: returnValue populated from 'return' file
 *   6. readSignals: exitCode populated from 'exit' file (valid int)
 *   7. readSignals: exitCode undefined for non-numeric 'exit' file
 *   8. readSignals: trims whitespace from file contents
 *   9. readSignals: reads all signals simultaneously
 *  10. ensureSignalDir: creates directory if not exists
 *
 * Covers:
 *   - agents/signals.ts: readSignals() all branches
 *   - agents/signals.ts: ensureSignalDir()
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const { readSignals, ensureSignalDir } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/agents/signals.js"
);

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "al-signals-test-"));
}

describe("integration: agents/signals.ts (no Docker required)", () => {

  // ── readSignals() ─────────────────────────────────────────────────────────

  describe("readSignals()", () => {
    it("returns defaults when signalDir doesn't exist", () => {
      const result = readSignals("/tmp/nonexistent-signal-dir-12345");
      expect(result.rerun).toBe(false);
      expect(result.status).toBeUndefined();
      expect(result.returnValue).toBeUndefined();
      expect(result.exitCode).toBeUndefined();
    });

    it("returns defaults when signalDir is empty", () => {
      const dir = makeTempDir();
      const result = readSignals(dir);
      expect(result.rerun).toBe(false);
      expect(result.status).toBeUndefined();
    });

    it("returns rerun:true when 'rerun' file exists", () => {
      const dir = makeTempDir();
      writeFileSync(join(dir, "rerun"), ""); // empty file signals rerun
      const result = readSignals(dir);
      expect(result.rerun).toBe(true);
    });

    it("returns rerun:false when 'rerun' file does not exist", () => {
      const dir = makeTempDir();
      const result = readSignals(dir);
      expect(result.rerun).toBe(false);
    });

    it("reads status from 'status' file", () => {
      const dir = makeTempDir();
      writeFileSync(join(dir, "status"), "Running analysis...");
      const result = readSignals(dir);
      expect(result.status).toBe("Running analysis...");
    });

    it("reads returnValue from 'return' file", () => {
      const dir = makeTempDir();
      writeFileSync(join(dir, "return"), '{"result":"success"}');
      const result = readSignals(dir);
      expect(result.returnValue).toBe('{"result":"success"}');
    });

    it("reads exitCode from 'exit' file (valid integer)", () => {
      const dir = makeTempDir();
      writeFileSync(join(dir, "exit"), "42");
      const result = readSignals(dir);
      expect(result.exitCode).toBe(42);
    });

    it("exitCode is 0 for '0' in exit file", () => {
      const dir = makeTempDir();
      writeFileSync(join(dir, "exit"), "0");
      const result = readSignals(dir);
      expect(result.exitCode).toBe(0);
    });

    it("exitCode is undefined for non-numeric 'exit' file", () => {
      const dir = makeTempDir();
      writeFileSync(join(dir, "exit"), "not-a-number");
      const result = readSignals(dir);
      expect(result.exitCode).toBeUndefined();
    });

    it("trims whitespace from file contents", () => {
      const dir = makeTempDir();
      writeFileSync(join(dir, "status"), "  my status  \n");
      writeFileSync(join(dir, "return"), "  my value  \n");
      writeFileSync(join(dir, "exit"), "  5  \n");
      const result = readSignals(dir);
      expect(result.status).toBe("my status");
      expect(result.returnValue).toBe("my value");
      expect(result.exitCode).toBe(5);
    });

    it("reads all signals simultaneously", () => {
      const dir = makeTempDir();
      writeFileSync(join(dir, "rerun"), "");
      writeFileSync(join(dir, "status"), "processing");
      writeFileSync(join(dir, "return"), "done");
      writeFileSync(join(dir, "exit"), "0");
      const result = readSignals(dir);
      expect(result.rerun).toBe(true);
      expect(result.status).toBe("processing");
      expect(result.returnValue).toBe("done");
      expect(result.exitCode).toBe(0);
    });
  });

  // ── ensureSignalDir() ─────────────────────────────────────────────────────

  describe("ensureSignalDir()", () => {
    it("creates the signal directory if it doesn't exist", () => {
      const dir = join(makeTempDir(), "nested", "signal-dir");
      expect(existsSync(dir)).toBe(false);
      ensureSignalDir(dir);
      expect(existsSync(dir)).toBe(true);
    });

    it("is a no-op when directory already exists", () => {
      const dir = makeTempDir();
      expect(() => ensureSignalDir(dir)).not.toThrow();
      expect(existsSync(dir)).toBe(true);
    });

    it("creates nested directory structure (recursive)", () => {
      const base = makeTempDir();
      const nested = join(base, "a", "b", "c", "signals");
      ensureSignalDir(nested);
      expect(existsSync(nested)).toBe(true);
    });
  });
});
