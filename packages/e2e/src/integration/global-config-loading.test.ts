/**
 * Integration tests: loadProjectConfig and loadGlobalConfig — no Docker required.
 *
 * Tests the layered config loading behavior directly without starting the
 * scheduler or requiring Docker:
 *
 *   - loadProjectConfig(): reads raw config.toml; returns {} when missing;
 *     throws ConfigError for malformed TOML
 *   - loadGlobalConfig(): returns default telemetry when no config.toml;
 *     applies .env.toml gateway overrides (deep merge); sets projectName from
 *     .env.toml; throws for invalid defaultAgentScale (non-integer, negative,
 *     fractional); throws for malformed .env.toml
 *
 * Covers:
 *   - shared/config/load-project.ts: loadProjectConfig(), loadGlobalConfig()
 *     deep-merge path, defaultAgentScale validation, projectName extraction
 *   - shared/environment.ts: loadEnvToml(), deepMerge() via loadGlobalConfig()
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { stringify as stringifyTOML } from "smol-toml";
import {
  loadProjectConfig,
  loadGlobalConfig,
} from "@action-llama/action-llama/internals/config";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "al-global-cfg-test-"));
}

// ---------------------------------------------------------------------------
// loadProjectConfig
// ---------------------------------------------------------------------------

describe("global-config-loading: loadProjectConfig", { timeout: 10_000 }, () => {
  it("returns an empty object when config.toml does not exist", () => {
    const dir = makeTempDir();
    const config = loadProjectConfig(dir);
    expect(config).toEqual({});
  });

  it("parses a valid config.toml and returns its contents", () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, "config.toml"),
      stringifyTOML({
        scale: 3,
        models: { sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514" } },
        gateway: { port: 9090 },
      }),
    );

    const config = loadProjectConfig(dir);
    expect(config.scale).toBe(3);
    expect((config as any).gateway?.port).toBe(9090);
  });

  it("throws ConfigError for malformed config.toml", () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "config.toml"), "this = [invalid TOML {{{\n");

    expect(() => loadProjectConfig(dir)).toThrow(/config\.toml|parse/i);
  });

  it("does NOT apply .env.toml overrides (raw project config only)", () => {
    const dir = makeTempDir();
    // Write config.toml with scale=2
    writeFileSync(
      join(dir, "config.toml"),
      stringifyTOML({ scale: 2 }),
    );
    // Write .env.toml with scale override
    writeFileSync(
      join(dir, ".env.toml"),
      stringifyTOML({ scale: 99 }),
    );

    // loadProjectConfig should return the raw value (no .env.toml merge)
    const config = loadProjectConfig(dir);
    expect(config.scale).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// loadGlobalConfig
// ---------------------------------------------------------------------------

describe("global-config-loading: loadGlobalConfig", { timeout: 10_000 }, () => {
  it("returns default telemetry config when no config.toml exists", () => {
    const dir = makeTempDir();
    const config = loadGlobalConfig(dir);

    // Should have default telemetry
    expect(config.telemetry).toBeDefined();
    expect(config.telemetry!.enabled).toBe(false);
    expect(config.telemetry!.provider).toBe("none");
  });

  it("preserves existing telemetry config when config.toml defines it", () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, "config.toml"),
      stringifyTOML({
        telemetry: { enabled: true, provider: "custom" },
      }),
    );

    const config = loadGlobalConfig(dir);
    expect(config.telemetry?.enabled).toBe(true);
    expect(config.telemetry?.provider).toBe("custom");
  });

  it("applies .env.toml gateway port override via deep merge", () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, "config.toml"),
      stringifyTOML({
        gateway: { port: 8080 },
        scale: 2,
      }),
    );
    // .env.toml overrides only gateway.port
    writeFileSync(
      join(dir, ".env.toml"),
      stringifyTOML({ gateway: { port: 9999 } }),
    );

    const config = loadGlobalConfig(dir);
    expect((config as any).gateway?.port).toBe(9999);
    // Other fields are preserved
    expect(config.scale).toBe(2);
  });

  it("sets projectName from .env.toml projectName field", () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, ".env.toml"),
      stringifyTOML({ projectName: "my-project" }),
    );

    const config = loadGlobalConfig(dir);
    expect(config.projectName).toBe("my-project");
  });

  it("throws ConfigError when defaultAgentScale is a negative integer", () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, "config.toml"),
      stringifyTOML({ defaultAgentScale: -1 }),
    );

    expect(() => loadGlobalConfig(dir)).toThrow(/defaultAgentScale/i);
  });

  it("throws ConfigError when defaultAgentScale is a fractional number", () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, "config.toml"),
      stringifyTOML({ defaultAgentScale: 1.5 }),
    );

    expect(() => loadGlobalConfig(dir)).toThrow(/defaultAgentScale/i);
  });

  it("accepts defaultAgentScale = 0 (disables all agents by default)", () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, "config.toml"),
      stringifyTOML({ defaultAgentScale: 0 }),
    );

    const config = loadGlobalConfig(dir);
    expect(config.defaultAgentScale).toBe(0);
  });

  it("throws ConfigError when .env.toml has malformed TOML syntax", () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, ".env.toml"), "this = [invalid TOML {{{\n");

    expect(() => loadGlobalConfig(dir)).toThrow(/\.env\.toml|parse/i);
  });
});
