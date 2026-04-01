/**
 * Integration tests: config utility functions — no Docker required.
 *
 * These tests exercise pure filesystem-based utility functions exported from
 * @action-llama/action-llama/internals/config. No scheduler, no Docker, no harness.
 *
 * Functions covered:
 *   - loadSharedFiles() — reads shared/ directory contents; empty/missing returns {}
 *   - discoverAgents() — finds agent directories with SKILL.md; sorted, hidden skipped
 *   - validateAgentName() — rejects hyphens at start/end, consecutive hyphens, underscore
 *   - getAgentScale() — reads scale field from per-agent config.toml
 *   - getProjectScale() — reads scale field from project config.toml
 *
 * Covers:
 *   - shared/config/load-agent.ts: loadSharedFiles(), discoverAgents(), getAgentScale()
 *   - shared/config/load-project.ts: getProjectScale()
 *   - shared/config/validate.ts: validateAgentName() — edge cases
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { stringify as stringifyTOML } from "smol-toml";
import { stringify as stringifyYAML } from "yaml";
import {
  loadSharedFiles,
  discoverAgents,
  validateAgentName,
  getAgentScale,
  getProjectScale,
} from "@action-llama/action-llama/internals/config";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "al-config-utils-test-"));
}

/**
 * Write a minimal global config.toml with a "sonnet" model definition.
 */
function writeGlobalConfig(projectPath: string): void {
  writeFileSync(
    join(projectPath, "config.toml"),
    stringifyTOML({
      models: {
        sonnet: {
          provider: "anthropic",
          model: "claude-sonnet-4-20250514",
          thinkingLevel: "medium",
          authType: "api_key",
        },
      },
    }),
  );
}

/**
 * Write a minimal SKILL.md and config.toml for an agent.
 * Also writes a global config.toml at the project root if not already present.
 */
function writeMinimalAgent(
  projectPath: string,
  agentName: string,
  opts?: { scale?: number; schedule?: string },
): void {
  // Ensure global config with model definitions exists
  writeGlobalConfig(projectPath);

  const agentDir = join(projectPath, "agents", agentName);
  mkdirSync(agentDir, { recursive: true });

  const yamlStr = stringifyYAML({ name: agentName }).trimEnd();
  writeFileSync(
    join(agentDir, "SKILL.md"),
    `---\n${yamlStr}\n---\n\n# ${agentName}\nTest agent.\n`,
  );

  const cfg: Record<string, unknown> = {
    models: ["sonnet"],
    credentials: ["anthropic_key"],
    schedule: opts?.schedule ?? "*/5 * * * *",
  };
  if (opts?.scale !== undefined) cfg.scale = opts.scale;
  writeFileSync(join(agentDir, "config.toml"), stringifyTOML(cfg));
}

// ---------------------------------------------------------------------------
// loadSharedFiles
// ---------------------------------------------------------------------------

describe("config-utils: loadSharedFiles", { timeout: 10_000 }, () => {
  it("returns an empty object when the project has no shared/ directory", () => {
    const dir = makeTempDir();
    const result = loadSharedFiles(dir);
    expect(result).toEqual({});
  });

  it("returns an empty object when shared/ exists but is empty", () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, "shared"), { recursive: true });
    const result = loadSharedFiles(dir);
    expect(result).toEqual({});
  });

  it("reads a top-level file from shared/ directory", () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, "shared"), { recursive: true });
    writeFileSync(join(dir, "shared", "utils.sh"), "#!/bin/sh\necho ok\n");

    const result = loadSharedFiles(dir);
    expect(result["shared/utils.sh"]).toBe("#!/bin/sh\necho ok\n");
  });

  it("reads multiple files and keys are prefixed with 'shared/'", () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, "shared"), { recursive: true });
    writeFileSync(join(dir, "shared", "a.txt"), "alpha");
    writeFileSync(join(dir, "shared", "b.txt"), "beta");

    const result = loadSharedFiles(dir);
    expect(result["shared/a.txt"]).toBe("alpha");
    expect(result["shared/b.txt"]).toBe("beta");
    expect(Object.keys(result)).toHaveLength(2);
  });

  it("reads files from nested subdirectories", () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, "shared", "config"), { recursive: true });
    writeFileSync(join(dir, "shared", "config", "settings.json"), '{"key":"value"}');

    const result = loadSharedFiles(dir);
    expect(result["shared/config/settings.json"]).toBe('{"key":"value"}');
  });

  it("skips hidden files (starting with '.')", () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, "shared"), { recursive: true });
    writeFileSync(join(dir, "shared", ".hidden"), "secret");
    writeFileSync(join(dir, "shared", "visible.txt"), "public");

    const result = loadSharedFiles(dir);
    // Hidden files are skipped
    expect(result["shared/.hidden"]).toBeUndefined();
    // Visible file is included
    expect(result["shared/visible.txt"]).toBe("public");
  });
});

// ---------------------------------------------------------------------------
// discoverAgents
// ---------------------------------------------------------------------------

describe("config-utils: discoverAgents", { timeout: 10_000 }, () => {
  it("returns an empty array when the project path does not exist", () => {
    const result = discoverAgents("/tmp/nonexistent-project-al-test");
    expect(result).toEqual([]);
  });

  it("returns an empty array when agents/ directory does not exist", () => {
    const dir = makeTempDir();
    const result = discoverAgents(dir);
    expect(result).toEqual([]);
  });

  it("returns an empty array when agents/ directory is empty", () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, "agents"), { recursive: true });
    const result = discoverAgents(dir);
    expect(result).toEqual([]);
  });

  it("skips directories that have no SKILL.md", () => {
    const dir = makeTempDir();
    // Create agent dir with config.toml but NO SKILL.md
    const agentDir = join(dir, "agents", "no-skill-agent");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, "config.toml"), "");

    const result = discoverAgents(dir);
    expect(result).toEqual([]);
  });

  it("discovers directories that have SKILL.md", () => {
    const dir = makeTempDir();
    writeMinimalAgent(dir, "alpha-agent");

    const result = discoverAgents(dir);
    expect(result).toContain("alpha-agent");
  });

  it("returns agents sorted alphabetically", () => {
    const dir = makeTempDir();
    writeMinimalAgent(dir, "zebra-agent");
    writeMinimalAgent(dir, "alpha-agent");
    writeMinimalAgent(dir, "mango-agent");

    const result = discoverAgents(dir);
    expect(result).toEqual(["alpha-agent", "mango-agent", "zebra-agent"]);
  });

  it("skips hidden directories (starting with '.')", () => {
    const dir = makeTempDir();
    // Hidden directory with SKILL.md should still be skipped
    const hiddenDir = join(dir, "agents", ".hidden-agent");
    mkdirSync(hiddenDir, { recursive: true });
    writeFileSync(join(hiddenDir, "SKILL.md"), "---\nname: hidden\n---\n# Hidden\n");

    writeMinimalAgent(dir, "visible-agent");

    const result = discoverAgents(dir);
    expect(result).toEqual(["visible-agent"]);
  });

  it("skips non-directory entries in agents/", () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, "agents"), { recursive: true });
    // Write a file (not a directory) in agents/
    writeFileSync(join(dir, "agents", "not-a-dir.txt"), "plain file");

    const result = discoverAgents(dir);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// validateAgentName — edge cases not covered by startup tests
// ---------------------------------------------------------------------------

describe("config-utils: validateAgentName edge cases", { timeout: 10_000 }, () => {
  it("accepts a valid lowercase alphanumeric name", () => {
    expect(() => validateAgentName("my-agent")).not.toThrow();
    expect(() => validateAgentName("agent1")).not.toThrow();
    expect(() => validateAgentName("a")).not.toThrow();
  });

  it("rejects a name ending with a hyphen", () => {
    expect(() => validateAgentName("my-agent-")).toThrow(/invalid/i);
  });

  it("rejects a name starting with a hyphen", () => {
    expect(() => validateAgentName("-my-agent")).toThrow(/invalid/i);
  });

  it("rejects a name with consecutive hyphens", () => {
    expect(() => validateAgentName("my--agent")).toThrow(/invalid/i);
  });

  it("rejects a name with underscores", () => {
    expect(() => validateAgentName("my_agent")).toThrow(/invalid/i);
  });

  it("rejects an empty name", () => {
    expect(() => validateAgentName("")).toThrow(/invalid/i);
  });

  it("rejects a name of exactly 65 characters (one over limit)", () => {
    const name65 = "a".repeat(65);
    expect(() => validateAgentName(name65)).toThrow(/invalid|64/i);
  });

  it("accepts a name of exactly 64 characters (at limit)", () => {
    // 64 lowercase letters — exactly at the limit
    const name64 = "a".repeat(64);
    expect(() => validateAgentName(name64)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// getAgentScale / getProjectScale
// ---------------------------------------------------------------------------

describe("config-utils: getAgentScale and getProjectScale", { timeout: 10_000 }, () => {
  it("getAgentScale returns 1 when no scale field is set in config.toml", () => {
    const dir = makeTempDir();
    writeMinimalAgent(dir, "scale-agent"); // no scale override

    const scale = getAgentScale(dir, "scale-agent");
    expect(scale).toBe(1);
  });

  it("getAgentScale returns the configured scale when set in config.toml", () => {
    const dir = makeTempDir();
    writeMinimalAgent(dir, "scaled-agent", { scale: 3 });

    const scale = getAgentScale(dir, "scaled-agent");
    expect(scale).toBe(3);
  });

  it("getAgentScale returns 0 for a disabled agent (scale=0)", () => {
    const dir = makeTempDir();
    writeMinimalAgent(dir, "disabled-agent", { scale: 0 });

    const scale = getAgentScale(dir, "disabled-agent");
    expect(scale).toBe(0);
  });

  it("getProjectScale returns default 5 when no scale in config.toml", () => {
    const dir = makeTempDir();
    // Write a minimal config.toml without a scale field
    writeFileSync(
      join(dir, "config.toml"),
      stringifyTOML({ models: { sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514" } } }),
    );

    const scale = getProjectScale(dir);
    expect(scale).toBe(5);
  });

  it("getProjectScale returns configured value when scale is set in config.toml", () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, "config.toml"),
      stringifyTOML({
        scale: 10,
        models: { sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514" } },
      }),
    );

    const scale = getProjectScale(dir);
    expect(scale).toBe(10);
  });
});
