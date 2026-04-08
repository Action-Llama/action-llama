/**
 * Integration tests: shared/environment.ts utility functions — no Docker required.
 *
 * The environment module provides utilities for managing .env.toml files and
 * environment configs. Several functions are pure or only require a temp directory.
 *
 * Functions tested:
 *   - writeEnvToml(projectPath, updates) — creates/updates .env.toml
 *   - validateEnvironmentName(name) — validates environment name format
 *   - deepMerge(base, override) — deep merges two objects
 *
 * These don't require Docker or the scheduler.
 *
 * Covers:
 *   - shared/environment.ts: writeEnvToml() — creates new, merges into existing,
 *     deletes keys where value is undefined, throws ConfigError for malformed TOML
 *   - shared/environment.ts: validateEnvironmentName() — valid/invalid names
 *   - shared/environment.ts: deepMerge() — nested merge, arrays replaced, undefined skipped
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const {
  writeEnvToml,
  validateEnvironmentName,
  deepMerge,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/shared/environment.js"
);

describe("integration: shared/environment.ts (no Docker required)", () => {

  // ── writeEnvToml ──────────────────────────────────────────────────────────

  describe("writeEnvToml", () => {
    it("creates .env.toml when file does not exist", () => {
      const dir = mkdtempSync(join(tmpdir(), "al-env-test-"));
      writeEnvToml(dir, { environment: "dev", projectName: "my-project" });

      const content = readFileSync(join(dir, ".env.toml"), "utf-8");
      expect(content).toContain("environment");
      expect(content).toContain("dev");
      expect(content).toContain("projectName");
    });

    it("merges into existing .env.toml", () => {
      const dir = mkdtempSync(join(tmpdir(), "al-env-test-"));
      // Write initial file
      writeFileSync(join(dir, ".env.toml"), 'environment = "prod"\n');

      // Merge in a new key
      writeEnvToml(dir, { projectName: "my-app" });

      const content = readFileSync(join(dir, ".env.toml"), "utf-8");
      expect(content).toContain("environment");
      expect(content).toContain("prod");
      expect(content).toContain("projectName");
      expect(content).toContain("my-app");
    });

    it("overwrites existing value in .env.toml", () => {
      const dir = mkdtempSync(join(tmpdir(), "al-env-test-"));
      writeFileSync(join(dir, ".env.toml"), 'environment = "dev"\n');

      writeEnvToml(dir, { environment: "staging" });

      const content = readFileSync(join(dir, ".env.toml"), "utf-8");
      expect(content).toContain("staging");
      expect(content).not.toContain("dev");
    });

    it("deletes key when value is undefined", () => {
      const dir = mkdtempSync(join(tmpdir(), "al-env-test-"));
      writeFileSync(join(dir, ".env.toml"), 'environment = "dev"\nprojectName = "my-app"\n');

      // Delete environment key by passing undefined
      writeEnvToml(dir, { environment: undefined });

      const content = readFileSync(join(dir, ".env.toml"), "utf-8");
      expect(content).not.toContain("environment");
      expect(content).toContain("projectName");
    });

    it("throws ConfigError for malformed existing .env.toml", () => {
      const dir = mkdtempSync(join(tmpdir(), "al-env-test-"));
      writeFileSync(join(dir, ".env.toml"), "not = valid = toml [\n");

      expect(() => writeEnvToml(dir, { environment: "test" })).toThrow(/ConfigError|Error/i);
    });
  });

  // ── validateEnvironmentName ───────────────────────────────────────────────

  describe("validateEnvironmentName", () => {
    it("returns true for valid environment names", () => {
      expect(validateEnvironmentName("dev")).toBe(true);
      expect(validateEnvironmentName("production")).toBe(true);
      expect(validateEnvironmentName("my-env")).toBe(true);
      expect(validateEnvironmentName("env-123")).toBe(true);
    });

    it("returns error for empty name", () => {
      const result = validateEnvironmentName("");
      expect(typeof result).toBe("string");
      expect(result).toMatch(/required/i);
    });

    it("returns error for name longer than 50 chars", () => {
      const longName = "a".repeat(51);
      const result = validateEnvironmentName(longName);
      expect(typeof result).toBe("string");
      expect(result).toMatch(/50/);
    });

    it("accepts exactly 50-char name", () => {
      const name = "a".repeat(50);
      expect(validateEnvironmentName(name)).toBe(true);
    });

    it("returns error for name with uppercase letters", () => {
      const result = validateEnvironmentName("MyEnv");
      expect(typeof result).toBe("string");
      expect(result).toMatch(/lowercase/i);
    });

    it("returns error for name with leading hyphen", () => {
      const result = validateEnvironmentName("-my-env");
      expect(typeof result).toBe("string");
    });

    it("returns error for name with trailing hyphen", () => {
      const result = validateEnvironmentName("my-env-");
      expect(typeof result).toBe("string");
    });

    it("returns error for name with underscore", () => {
      const result = validateEnvironmentName("my_env");
      expect(typeof result).toBe("string");
    });
  });

  // ── deepMerge ────────────────────────────────────────────────────────────

  describe("deepMerge", () => {
    it("merges flat objects with override taking precedence", () => {
      const base = { a: 1, b: 2 };
      const override = { b: 20, c: 30 };
      const result = deepMerge(base, override);
      expect(result.a).toBe(1);
      expect(result.b).toBe(20); // overridden
      expect((result as any).c).toBe(30); // new key
    });

    it("deep-merges nested objects", () => {
      const base = { gateway: { port: 8080, url: "http://localhost" } };
      const override = { gateway: { port: 9090 } };
      const result = deepMerge(base, override);
      expect(result.gateway.port).toBe(9090);
      expect(result.gateway.url).toBe("http://localhost"); // preserved
    });

    it("replaces arrays (not concatenated)", () => {
      const base = { items: [1, 2, 3] };
      const override = { items: [4, 5] };
      const result = deepMerge(base, override);
      expect(result.items).toEqual([4, 5]);
    });

    it("skips undefined values in override", () => {
      const base = { a: 1, b: 2 };
      const result = deepMerge(base, { b: undefined });
      expect(result.b).toBe(2); // unchanged since override value is undefined
    });

    it("does not modify the original base object", () => {
      const base = { a: 1 };
      deepMerge(base, { a: 2 });
      expect(base.a).toBe(1); // original unchanged
    });
  });
});
