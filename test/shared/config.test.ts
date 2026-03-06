import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";
import { stringify as stringifyTOML } from "smol-toml";
import { loadGlobalConfig, loadAgentConfig, discoverAgents } from "../../src/shared/config.js";
import type { GlobalConfig } from "../../src/shared/config.js";

describe("loadGlobalConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads valid config.toml", () => {
    const config = { docker: { enabled: false } };
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML(config));
    const loaded = loadGlobalConfig(tmpDir);
    expect(loaded.docker?.enabled).toBe(false);
  });

  it("ignores config.json", () => {
    writeFileSync(resolve(tmpDir, "config.json"), JSON.stringify({ docker: { enabled: true } }));
    const loaded = loadGlobalConfig(tmpDir);
    expect(loaded).toEqual({});
  });

  it("returns empty config when no config file exists", () => {
    const loaded = loadGlobalConfig(tmpDir);
    expect(loaded).toEqual({});
  });
});

describe("loadAgentConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads agent-config.toml and injects name from directory", () => {
    const agentDir = resolve(tmpDir, "dev");
    mkdirSync(agentDir, { recursive: true });
    const agentOnDisk = {
      credentials: ["github_token:default"],
      model: { provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium", authType: "api_key" },
      schedule: "*/5 * * * *",
      repos: ["acme/app"],
      params: { triggerLabel: "agent", assignee: "bot" },
    };
    writeFileSync(resolve(agentDir, "agent-config.toml"), stringifyTOML(agentOnDisk as Record<string, unknown>));
    const loaded = loadAgentConfig(tmpDir, "dev");
    expect(loaded.name).toBe("dev");
    expect(loaded.repos).toEqual(["acme/app"]);
    expect(loaded.model.model).toBe("claude-sonnet-4-20250514");
  });

  it("throws when agent config is missing", () => {
    expect(() => loadAgentConfig(tmpDir, "nonexistent")).toThrow("Agent config not found");
  });
});

describe("discoverAgents", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("discovers agents with agent-config.toml", () => {
    for (const name of ["dev", "reviewer"]) {
      const dir = resolve(tmpDir, name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(resolve(dir, "agent-config.toml"), "");
    }
    const agents = discoverAgents(tmpDir);
    expect(agents).toEqual(["dev", "reviewer"]);
  });

  it("excludes dotfile and node_modules directories", () => {
    for (const name of [".al", ".workspace", "dev"]) {
      const dir = resolve(tmpDir, name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(resolve(dir, "agent-config.toml"), "");
    }
    const agents = discoverAgents(tmpDir);
    expect(agents).toEqual(["dev"]);
  });

  it("returns empty array for missing path", () => {
    const agents = discoverAgents(resolve(tmpDir, "nonexistent"));
    expect(agents).toEqual([]);
  });

  it("skips directories without config files", () => {
    mkdirSync(resolve(tmpDir, "empty-dir"), { recursive: true });
    const agents = discoverAgents(tmpDir);
    expect(agents).toEqual([]);
  });
});
