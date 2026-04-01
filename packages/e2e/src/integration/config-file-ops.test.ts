/**
 * Integration tests: config file operation functions — no Docker required.
 *
 * Tests the read/write utility functions from @action-llama/action-llama/internals/config
 * that are not covered by startup-flow tests:
 *   - loadAgentBody() — extracts body from SKILL.md after YAML frontmatter
 *   - loadAgentRuntimeConfig() — parses per-agent config.toml
 *   - updateAgentRuntimeField() — writes a single field to per-agent config.toml
 *   - updateProjectScale() — writes scale to project config.toml
 *
 * None of these functions start the scheduler or require Docker.
 *
 * Covers:
 *   - shared/config/load-agent.ts: loadAgentBody(), loadAgentRuntimeConfig(),
 *     updateAgentRuntimeField()
 *   - shared/config/load-project.ts: updateProjectScale()
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { stringify as stringifyTOML, parse as parseTOML } from "smol-toml";
import {
  loadAgentBody,
  loadAgentRuntimeConfig,
  updateAgentRuntimeField,
  updateProjectScale,
} from "@action-llama/action-llama/internals/config";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "al-config-fileops-test-"));
}

/**
 * Create an agents/<agentName> directory and write a SKILL.md file.
 */
function writeSkillMd(projectPath: string, agentName: string, content: string): void {
  const agentDir = join(projectPath, "agents", agentName);
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, "SKILL.md"), content);
}

/**
 * Create an agents/<agentName> directory and write a config.toml file.
 */
function writeAgentConfig(
  projectPath: string,
  agentName: string,
  config: Record<string, unknown>,
): void {
  const agentDir = join(projectPath, "agents", agentName);
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, "config.toml"), stringifyTOML(config));
}

// ---------------------------------------------------------------------------
// loadAgentBody
// ---------------------------------------------------------------------------

describe("config-file-ops: loadAgentBody", { timeout: 10_000 }, () => {
  it("returns empty string when SKILL.md does not exist", () => {
    const dir = makeTempDir();
    // No SKILL.md at all
    const body = loadAgentBody(dir, "no-skill-agent");
    expect(body).toBe("");
  });

  it("returns the markdown body after YAML frontmatter", () => {
    const dir = makeTempDir();
    writeSkillMd(
      dir,
      "body-agent",
      "---\nname: body-agent\n---\n\n# My Agent\n\nThis is the body.\n",
    );

    const body = loadAgentBody(dir, "body-agent");
    expect(body).toContain("# My Agent");
    expect(body).toContain("This is the body.");
    // Should not contain frontmatter
    expect(body).not.toContain("name: body-agent");
  });

  it("returns the full content when SKILL.md has no frontmatter", () => {
    const dir = makeTempDir();
    writeSkillMd(dir, "no-fm-agent", "# No Frontmatter\n\nJust content.\n");

    const body = loadAgentBody(dir, "no-fm-agent");
    expect(body).toContain("# No Frontmatter");
    expect(body).toContain("Just content.");
  });

  it("returns empty string when SKILL.md has only frontmatter and no body", () => {
    const dir = makeTempDir();
    writeSkillMd(dir, "fm-only-agent", "---\nname: fm-only-agent\n---\n");

    const body = loadAgentBody(dir, "fm-only-agent");
    expect(body.trim()).toBe("");
  });
});

// ---------------------------------------------------------------------------
// loadAgentRuntimeConfig
// ---------------------------------------------------------------------------

describe("config-file-ops: loadAgentRuntimeConfig", { timeout: 10_000 }, () => {
  it("returns an empty object when config.toml does not exist", () => {
    const dir = makeTempDir();
    // Create agents/<name> directory with no config.toml
    mkdirSync(join(dir, "agents", "nocfg-agent"), { recursive: true });

    const config = loadAgentRuntimeConfig(dir, "nocfg-agent");
    expect(config).toEqual({});
  });

  it("parses a valid config.toml and returns its contents", () => {
    const dir = makeTempDir();
    writeAgentConfig(dir, "cfg-agent", {
      models: ["sonnet"],
      credentials: ["anthropic_key"],
      schedule: "*/5 * * * *",
      scale: 2,
    });

    const config = loadAgentRuntimeConfig(dir, "cfg-agent");
    expect(config.models).toEqual(["sonnet"]);
    expect(config.credentials).toEqual(["anthropic_key"]);
    expect(config.schedule).toBe("*/5 * * * *");
    expect(config.scale).toBe(2);
  });

  it("throws ConfigError when config.toml has invalid TOML syntax", () => {
    const dir = makeTempDir();
    const agentDir = join(dir, "agents", "bad-toml-agent");
    mkdirSync(agentDir, { recursive: true });
    // Write deliberately invalid TOML
    writeFileSync(join(agentDir, "config.toml"), "this = [invalid TOML {{{\n");

    expect(() => loadAgentRuntimeConfig(dir, "bad-toml-agent")).toThrow(/config\.toml|parse/i);
  });
});

// ---------------------------------------------------------------------------
// updateAgentRuntimeField
// ---------------------------------------------------------------------------

describe("config-file-ops: updateAgentRuntimeField", { timeout: 10_000 }, () => {
  it("creates a new config.toml when the file does not exist", () => {
    const dir = makeTempDir();
    const agentDir = join(dir, "agents", "new-cfg-agent");
    mkdirSync(agentDir, { recursive: true });

    // No config.toml yet
    expect(existsSync(join(agentDir, "config.toml"))).toBe(false);

    updateAgentRuntimeField(dir, "new-cfg-agent", "scale", 3);

    expect(existsSync(join(agentDir, "config.toml"))).toBe(true);
    const written = parseTOML(readFileSync(join(agentDir, "config.toml"), "utf-8")) as Record<string, unknown>;
    expect(written.scale).toBe(3);
  });

  it("updates an existing field in config.toml without affecting other fields", () => {
    const dir = makeTempDir();
    writeAgentConfig(dir, "update-agent", {
      models: ["sonnet"],
      credentials: ["anthropic_key"],
      schedule: "*/5 * * * *",
      scale: 1,
    });

    updateAgentRuntimeField(dir, "update-agent", "scale", 5);

    const updated = parseTOML(
      readFileSync(join(dir, "agents", "update-agent", "config.toml"), "utf-8"),
    ) as Record<string, unknown>;

    // Updated field
    expect(updated.scale).toBe(5);
    // Other fields preserved
    expect(updated.models).toEqual(["sonnet"]);
    expect(updated.credentials).toEqual(["anthropic_key"]);
    expect(updated.schedule).toBe("*/5 * * * *");
  });

  it("adds a new field when it did not exist before", () => {
    const dir = makeTempDir();
    writeAgentConfig(dir, "add-field-agent", {
      models: ["sonnet"],
      credentials: ["anthropic_key"],
      schedule: "*/5 * * * *",
    });

    // Add maxWorkQueueSize (was not in original config)
    updateAgentRuntimeField(dir, "add-field-agent", "maxWorkQueueSize", 10);

    const updated = parseTOML(
      readFileSync(join(dir, "agents", "add-field-agent", "config.toml"), "utf-8"),
    ) as Record<string, unknown>;

    expect(updated.maxWorkQueueSize).toBe(10);
    // Existing fields preserved
    expect(updated.models).toEqual(["sonnet"]);
  });

  it("updates a string field (e.g., schedule)", () => {
    const dir = makeTempDir();
    writeAgentConfig(dir, "str-field-agent", {
      models: ["sonnet"],
      credentials: ["anthropic_key"],
      schedule: "*/5 * * * *",
    });

    updateAgentRuntimeField(dir, "str-field-agent", "schedule", "0 9 * * 1");

    const updated = parseTOML(
      readFileSync(join(dir, "agents", "str-field-agent", "config.toml"), "utf-8"),
    ) as Record<string, unknown>;

    expect(updated.schedule).toBe("0 9 * * 1");
  });
});

// ---------------------------------------------------------------------------
// updateProjectScale
// ---------------------------------------------------------------------------

describe("config-file-ops: updateProjectScale", { timeout: 10_000 }, () => {
  it("writes scale to an existing project config.toml", () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, "config.toml"),
      stringifyTOML({
        models: { sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514" } },
      }),
    );

    updateProjectScale(dir, 7);

    const updated = parseTOML(
      readFileSync(join(dir, "config.toml"), "utf-8"),
    ) as Record<string, unknown>;
    expect(updated.scale).toBe(7);
  });

  it("creates config.toml if it does not exist and writes scale", () => {
    const dir = makeTempDir();
    // No config.toml
    expect(existsSync(join(dir, "config.toml"))).toBe(false);

    updateProjectScale(dir, 4);

    expect(existsSync(join(dir, "config.toml"))).toBe(true);
    const written = parseTOML(
      readFileSync(join(dir, "config.toml"), "utf-8"),
    ) as Record<string, unknown>;
    expect(written.scale).toBe(4);
  });

  it("overwrites an existing scale value in project config.toml", () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, "config.toml"),
      stringifyTOML({
        scale: 2,
        models: { sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514" } },
      }),
    );

    updateProjectScale(dir, 8);

    const updated = parseTOML(
      readFileSync(join(dir, "config.toml"), "utf-8"),
    ) as Record<string, unknown>;
    expect(updated.scale).toBe(8);
  });
});
