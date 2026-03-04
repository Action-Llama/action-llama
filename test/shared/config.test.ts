import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";
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

  it("loads valid config.json", () => {
    const config: GlobalConfig = {
      docker: { enabled: false },
    };
    writeFileSync(resolve(tmpDir, "config.json"), JSON.stringify(config));
    const loaded = loadGlobalConfig(tmpDir);
    expect(loaded.docker?.enabled).toBe(false);
  });

  it("returns empty config when config.json is missing", () => {
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

  it("loads agent config.json and injects name from directory", () => {
    const agentDir = resolve(tmpDir, "dev");
    mkdirSync(agentDir, { recursive: true });
    // config.json on disk does NOT contain name — it's injected by loadAgentConfig
    const agentOnDisk = {
      credentials: ["github-token"],
      model: { provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium", authType: "api_key" },
      schedule: "*/5 * * * *",
      prompt: "Do stuff",
      repos: ["acme/app"],
      params: { triggerLabel: "agent", assignee: "bot" },
    };
    writeFileSync(resolve(agentDir, "config.json"), JSON.stringify(agentOnDisk));
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

  it("discovers agents with config.json", () => {
    for (const name of ["dev", "reviewer"]) {
      const dir = resolve(tmpDir, name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(resolve(dir, "config.json"), "{}");
    }
    const agents = discoverAgents(tmpDir);
    expect(agents).toEqual(["dev", "reviewer"]);
  });

  it("excludes dotfile and node_modules directories", () => {
    for (const name of [".al", ".workspace", "dev"]) {
      const dir = resolve(tmpDir, name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(resolve(dir, "config.json"), "{}");
    }
    const agents = discoverAgents(tmpDir);
    expect(agents).toEqual(["dev"]);
  });

  it("returns empty array for missing path", () => {
    const agents = discoverAgents(resolve(tmpDir, "nonexistent"));
    expect(agents).toEqual([]);
  });

  it("skips directories without config.json", () => {
    mkdirSync(resolve(tmpDir, "empty-dir"), { recursive: true });
    const agents = discoverAgents(tmpDir);
    expect(agents).toEqual([]);
  });
});
