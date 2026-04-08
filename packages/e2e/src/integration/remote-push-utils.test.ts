/**
 * Integration tests: remote/push.ts pure functions — no Docker required.
 *
 * Tests the pure utility functions exported from remote/push.ts:
 *
 *   1. computePkgHash(projectPath) — SHA-256 hash of package.json + package-lock.json
 *   2. buildSystemdUnit(projectName, basePath, binPaths, gatewayPort, expose) —
 *      generates a systemd unit file string
 *
 * All tests run without any network, SSH, or Docker setup.
 *
 * Covers:
 *   - remote/push.ts: computePkgHash() — hashes both package files when present
 *   - remote/push.ts: computePkgHash() — stable hash (same input → same output)
 *   - remote/push.ts: computePkgHash() — changes when package.json changes
 *   - remote/push.ts: computePkgHash() — handles missing package files (uses fallback string)
 *   - remote/push.ts: computePkgHash() — returns 64-char hex string (SHA-256)
 *   - remote/push.ts: buildSystemdUnit() — contains project name in Description
 *   - remote/push.ts: buildSystemdUnit() — contains basePath in ExecStart
 *   - remote/push.ts: buildSystemdUnit() — includes -e flag when expose is true (default)
 *   - remote/push.ts: buildSystemdUnit() — omits -e flag when expose is false
 *   - remote/push.ts: buildSystemdUnit() — includes --port when gatewayPort is provided
 *   - remote/push.ts: buildSystemdUnit() — omits --port when gatewayPort is not provided
 *   - remote/push.ts: buildSystemdUnit() — includes node PATH when binPaths.nodePath is set
 *   - remote/push.ts: buildSystemdUnit() — omits extra PATH when binPaths is undefined
 *   - remote/push.ts: buildSystemdUnit() — is a valid systemd unit string ([Unit] section)
 *   - remote/push.ts: buildSystemdUnit() — WantedBy=multi-user.target in [Install] section
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const {
  computePkgHash,
  buildSystemdUnit,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/remote/push.js"
);

// ── computePkgHash ─────────────────────────────────────────────────────────

describe("integration: remote/push.ts pure functions (no Docker required)", { timeout: 15_000 }, () => {

  describe("computePkgHash(projectPath)", () => {
    it("returns a 64-character hex string (SHA-256)", () => {
      const dir = mkdtempSync(join(tmpdir(), "al-hash-test-"));
      writeFileSync(join(dir, "package.json"), '{"name": "test"}');
      writeFileSync(join(dir, "package-lock.json"), '{"lockfileVersion": 3}');
      const hash = computePkgHash(dir);
      expect(typeof hash).toBe("string");
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("is stable — same files produce same hash", () => {
      const dir = mkdtempSync(join(tmpdir(), "al-hash-stable-"));
      writeFileSync(join(dir, "package.json"), '{"name": "test", "version": "1.0.0"}');
      writeFileSync(join(dir, "package-lock.json"), '{"lockfileVersion": 3, "packages": {}}');
      const hash1 = computePkgHash(dir);
      const hash2 = computePkgHash(dir);
      expect(hash1).toBe(hash2);
    });

    it("changes when package.json content changes", () => {
      const dir = mkdtempSync(join(tmpdir(), "al-hash-change-"));
      writeFileSync(join(dir, "package.json"), '{"name": "v1"}');
      writeFileSync(join(dir, "package-lock.json"), '{"lockfileVersion": 3}');
      const hash1 = computePkgHash(dir);

      writeFileSync(join(dir, "package.json"), '{"name": "v2"}');
      const hash2 = computePkgHash(dir);
      expect(hash1).not.toBe(hash2);
    });

    it("handles missing package.json gracefully (uses 'missing:package.json' string)", () => {
      const dir = mkdtempSync(join(tmpdir(), "al-hash-missing-"));
      // Don't create any files
      const hash = computePkgHash(dir);
      expect(typeof hash).toBe("string");
      expect(hash).toHaveLength(64);
    });

    it("handles missing both files — produces consistent hash", () => {
      const dir = mkdtempSync(join(tmpdir(), "al-hash-both-missing-"));
      const hash1 = computePkgHash(dir);
      const hash2 = computePkgHash(dir);
      expect(hash1).toBe(hash2);
    });

    it("different directories with different content produce different hashes", () => {
      const dir1 = mkdtempSync(join(tmpdir(), "al-hash-dir1-"));
      const dir2 = mkdtempSync(join(tmpdir(), "al-hash-dir2-"));
      writeFileSync(join(dir1, "package.json"), '{"name": "project-a"}');
      writeFileSync(join(dir2, "package.json"), '{"name": "project-b"}');
      const hash1 = computePkgHash(dir1);
      const hash2 = computePkgHash(dir2);
      expect(hash1).not.toBe(hash2);
    });
  });

  // ── buildSystemdUnit ───────────────────────────────────────────────────────

  describe("buildSystemdUnit(projectName, basePath, binPaths?, gatewayPort?, expose?)", () => {
    const BASE_PATH = "/opt/action-llama";
    const PROJECT_NAME = "my-project";

    it("is a valid systemd unit string with [Unit] section", () => {
      const unit = buildSystemdUnit(PROJECT_NAME, BASE_PATH);
      expect(unit).toContain("[Unit]");
      expect(unit).toContain("[Service]");
      expect(unit).toContain("[Install]");
    });

    it("contains project name in Description", () => {
      const unit = buildSystemdUnit(PROJECT_NAME, BASE_PATH);
      expect(unit).toContain(PROJECT_NAME);
    });

    it("contains basePath in ExecStart", () => {
      const unit = buildSystemdUnit(PROJECT_NAME, BASE_PATH);
      expect(unit).toContain(BASE_PATH);
    });

    it("includes WantedBy=multi-user.target", () => {
      const unit = buildSystemdUnit(PROJECT_NAME, BASE_PATH);
      expect(unit).toContain("WantedBy=multi-user.target");
    });

    it("includes -e expose flag by default (when expose is undefined)", () => {
      const unit = buildSystemdUnit(PROJECT_NAME, BASE_PATH);
      expect(unit).toContain(" -e");
    });

    it("includes -e expose flag when expose is true", () => {
      const unit = buildSystemdUnit(PROJECT_NAME, BASE_PATH, undefined, undefined, true);
      expect(unit).toContain(" -e");
    });

    it("omits -e expose flag when expose is false", () => {
      const unit = buildSystemdUnit(PROJECT_NAME, BASE_PATH, undefined, undefined, false);
      expect(unit).not.toContain(" -e");
    });

    it("includes --port flag when gatewayPort is provided", () => {
      const unit = buildSystemdUnit(PROJECT_NAME, BASE_PATH, undefined, 9090);
      expect(unit).toContain("--port 9090");
    });

    it("omits --port flag when gatewayPort is not provided", () => {
      const unit = buildSystemdUnit(PROJECT_NAME, BASE_PATH);
      expect(unit).not.toContain("--port");
    });

    it("includes node PATH when binPaths.nodePath is set", () => {
      const binPaths = { nodePath: "/usr/local/bin/node", nodeVersion: "v22.0.0", dockerVersion: "25.0.0" };
      const unit = buildSystemdUnit(PROJECT_NAME, BASE_PATH, binPaths);
      expect(unit).toContain("/usr/local/bin");
      expect(unit).toContain("PATH=");
    });

    it("omits extra PATH when binPaths is undefined", () => {
      const unit = buildSystemdUnit(PROJECT_NAME, BASE_PATH, undefined);
      // Should not have an extra PATH= line (only NODE_ENV=production)
      const envLines = unit.split("\n").filter((l: string) => l.includes("Environment=PATH="));
      expect(envLines.length).toBe(0);
    });

    it("sets ExecStart to use the local al binary from node_modules", () => {
      const unit = buildSystemdUnit(PROJECT_NAME, BASE_PATH);
      expect(unit).toContain("node_modules/.bin/al");
    });

    it("sets NODE_ENV=production", () => {
      const unit = buildSystemdUnit(PROJECT_NAME, BASE_PATH);
      expect(unit).toContain("NODE_ENV=production");
    });

    it("sets RestartSec=5 for restart delay", () => {
      const unit = buildSystemdUnit(PROJECT_NAME, BASE_PATH);
      expect(unit).toContain("RestartSec=5");
    });

    it("uses Restart=on-failure", () => {
      const unit = buildSystemdUnit(PROJECT_NAME, BASE_PATH);
      expect(unit).toContain("Restart=on-failure");
    });

    it("includes --headless and -w flags in ExecStart", () => {
      const unit = buildSystemdUnit(PROJECT_NAME, BASE_PATH);
      expect(unit).toContain("--headless");
      expect(unit).toContain("-w");
    });
  });
});
