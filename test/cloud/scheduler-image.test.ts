import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";
import { collectProjectFiles } from "../../src/cloud/scheduler-image.js";

describe("collectProjectFiles", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-sched-img-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("collects agent files from agents/ subdirectory", () => {
    // Standard project layout: agents live under agents/<name>/
    mkdirSync(resolve(tmpDir, "agents", "dev"), { recursive: true });
    writeFileSync(resolve(tmpDir, "agents", "dev", "agent-config.toml"), 'schedule = "*/5 * * * *"');
    writeFileSync(resolve(tmpDir, "agents", "dev", "ACTIONS.md"), "# Dev agent");

    mkdirSync(resolve(tmpDir, "agents", "reviewer"), { recursive: true });
    writeFileSync(resolve(tmpDir, "agents", "reviewer", "agent-config.toml"), 'schedule = "0 * * * *"');

    const files = collectProjectFiles(tmpDir);

    expect(files["agents/dev/agent-config.toml"]).toBe('schedule = "*/5 * * * *"');
    expect(files["agents/dev/ACTIONS.md"]).toBe("# Dev agent");
    expect(files["agents/reviewer/agent-config.toml"]).toBe('schedule = "0 * * * *"');
  });

  it("includes config.toml when present", () => {
    writeFileSync(resolve(tmpDir, "config.toml"), "[local]\nenabled = true");

    const files = collectProjectFiles(tmpDir);
    expect(files["config.toml"]).toBe("[local]\nenabled = true");
  });

  it("includes project Dockerfile when present", () => {
    writeFileSync(resolve(tmpDir, "Dockerfile"), "FROM node:20");

    const files = collectProjectFiles(tmpDir);
    expect(files["Dockerfile"]).toBe("FROM node:20");
  });

  it("excludes dotfile and node_modules directories", () => {
    mkdirSync(resolve(tmpDir, "agents", ".hidden"), { recursive: true });
    writeFileSync(resolve(tmpDir, "agents", ".hidden", "agent-config.toml"), "");

    mkdirSync(resolve(tmpDir, "agents", "node_modules"), { recursive: true });
    writeFileSync(resolve(tmpDir, "agents", "node_modules", "agent-config.toml"), "");

    mkdirSync(resolve(tmpDir, "agents", "dev"), { recursive: true });
    writeFileSync(resolve(tmpDir, "agents", "dev", "agent-config.toml"), "ok");

    const files = collectProjectFiles(tmpDir);
    expect(Object.keys(files)).toEqual(["agents/dev/agent-config.toml"]);
  });

  it("skips directories without agent-config.toml", () => {
    mkdirSync(resolve(tmpDir, "agents", "empty-dir"), { recursive: true });
    writeFileSync(resolve(tmpDir, "agents", "empty-dir", "README.md"), "nope");

    const files = collectProjectFiles(tmpDir);
    expect(Object.keys(files)).toEqual([]);
  });

  it("returns empty when agents/ directory does not exist", () => {
    const files = collectProjectFiles(tmpDir);
    expect(Object.keys(files)).toEqual([]);
  });

  it("collected paths match discoverAgents layout for scheduler entrypoint", () => {
    // This test ensures the scheduler image file layout is compatible with
    // discoverAgents(). The scheduler runs with -p /app/static/project, so
    // discoverAgents looks at /app/static/project/agents/<name>/agent-config.toml.
    // collectProjectFiles must produce paths under agents/<name>/ to match.
    mkdirSync(resolve(tmpDir, "agents", "my-agent"), { recursive: true });
    writeFileSync(resolve(tmpDir, "agents", "my-agent", "agent-config.toml"), "x");

    const files = collectProjectFiles(tmpDir);
    const agentPaths = Object.keys(files).filter((p) => p.startsWith("agents/"));

    // Every agent file path must be agents/<name>/<file>
    for (const p of agentPaths) {
      const parts = p.split("/");
      expect(parts[0]).toBe("agents");
      expect(parts.length).toBe(3);
    }
  });
});
