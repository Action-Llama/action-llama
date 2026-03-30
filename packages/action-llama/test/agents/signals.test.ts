import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { installSignalCommands, readSignals, ensureSignalDir } from "../../src/agents/signals.js";

describe("signals", () => {
  let tmpDir: string;
  let binDir: string;
  let signalDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-signals-test-"));
    binDir = join(tmpDir, "bin");
    signalDir = join(tmpDir, "signals");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("ensureSignalDir", () => {
    it("creates the signal directory if it does not exist", () => {
      const newDir = join(tmpDir, "signal-subdir", "nested");
      expect(existsSync(newDir)).toBe(false);
      ensureSignalDir(newDir);
      expect(existsSync(newDir)).toBe(true);
    });

    it("is idempotent — does not throw if directory already exists", () => {
      mkdirSync(signalDir, { recursive: true });
      expect(() => ensureSignalDir(signalDir)).not.toThrow();
      expect(existsSync(signalDir)).toBe(true);
    });
  });

  describe("installSignalCommands", () => {
    it("creates all four signal scripts", () => {
      installSignalCommands(binDir, signalDir);

      expect(existsSync(join(binDir, "al-rerun"))).toBe(true);
      expect(existsSync(join(binDir, "al-status"))).toBe(true);
      expect(existsSync(join(binDir, "al-return"))).toBe(true);
      expect(existsSync(join(binDir, "al-exit"))).toBe(true);
    });

    it("creates signal directory", () => {
      installSignalCommands(binDir, signalDir);
      expect(existsSync(signalDir)).toBe(true);
    });

    it("generates valid shell scripts with shebang", () => {
      installSignalCommands(binDir, signalDir);
      const content = readFileSync(join(binDir, "al-rerun"), "utf-8");
      expect(content.startsWith("#!/bin/sh")).toBe(true);
    });

    it("scripts reference AL_SIGNAL_DIR", () => {
      installSignalCommands(binDir, signalDir);
      const content = readFileSync(join(binDir, "al-rerun"), "utf-8");
      expect(content).toContain("$AL_SIGNAL_DIR");
    });
  });

  describe("readSignals", () => {
    it("returns defaults when signal dir does not exist", () => {
      const signals = readSignals("/tmp/nonexistent-dir-xyz");
      expect(signals.rerun).toBe(false);
      expect(signals.status).toBeUndefined();
      expect(signals.returnValue).toBeUndefined();
      expect(signals.exitCode).toBeUndefined();
    });

    it("returns defaults when signal dir is empty", () => {
      mkdirSync(signalDir, { recursive: true });
      const signals = readSignals(signalDir);
      expect(signals.rerun).toBe(false);
    });

    it("detects rerun signal", () => {
      mkdirSync(signalDir, { recursive: true });
      writeFileSync(join(signalDir, "rerun"), "");
      const signals = readSignals(signalDir);
      expect(signals.rerun).toBe(true);
    });

    it("reads status text", () => {
      mkdirSync(signalDir, { recursive: true });
      writeFileSync(join(signalDir, "status"), "reviewing PR #42");
      const signals = readSignals(signalDir);
      expect(signals.status).toBe("reviewing PR #42");
    });

    it("reads return value", () => {
      mkdirSync(signalDir, { recursive: true });
      writeFileSync(join(signalDir, "return"), "PR looks good. Approved.");
      const signals = readSignals(signalDir);
      expect(signals.returnValue).toBe("PR looks good. Approved.");
    });

    it("reads exit code", () => {
      mkdirSync(signalDir, { recursive: true });
      writeFileSync(join(signalDir, "exit"), "10");
      const signals = readSignals(signalDir);
      expect(signals.exitCode).toBe(10);
    });

    it("handles invalid exit code gracefully", () => {
      mkdirSync(signalDir, { recursive: true });
      writeFileSync(join(signalDir, "exit"), "abc");
      const signals = readSignals(signalDir);
      expect(signals.exitCode).toBeUndefined();
    });

    it("reads all signal types simultaneously", () => {
      mkdirSync(signalDir, { recursive: true });
      writeFileSync(join(signalDir, "rerun"), "");
      writeFileSync(join(signalDir, "status"), "working");
      writeFileSync(join(signalDir, "return"), "result data");

      const signals = readSignals(signalDir);
      expect(signals.rerun).toBe(true);
      expect(signals.status).toBe("working");
      expect(signals.returnValue).toBe("result data");
      // exitCode should be undefined since we didn't write it
      expect(signals.exitCode).toBeUndefined();
    });
  });
});
