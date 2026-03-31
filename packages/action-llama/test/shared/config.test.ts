import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";
import { stringify as stringifyTOML } from "smol-toml";
import { loadGlobalConfig, loadProjectConfig, loadAgentConfig, loadAgentBody, discoverAgents, validateAgentName, loadSharedFiles, updateProjectScale, getProjectScale, getAgentScale, updateAgentRuntimeField } from "../../src/shared/config.js";
import type { GlobalConfig } from "../../src/shared/config.js";
import { ENVIRONMENTS_DIR } from "../../src/shared/paths.js";

/** Helper to write a config.toml with named models. */
function writeModelsConfig(dir: string, models: Record<string, unknown>, extra?: Record<string, unknown>) {
  writeFileSync(resolve(dir, "config.toml"), stringifyTOML({ models, ...extra }));
}

/** Helper to write SKILL.md (portable fields only) and per-agent config.toml (runtime fields). */
function writeSkillMd(dir: string, agentName: string, opts: { models: string[]; credentials?: string[]; schedule?: string; hooks?: unknown; description?: string; params?: unknown; scale?: number; timeout?: number; maxWorkQueueSize?: number }) {
  const agentDir = resolve(dir, "agents", agentName);
  mkdirSync(agentDir, { recursive: true });

  // Write portable SKILL.md
  const fmLines = ["---"];
  fmLines.push(`name: ${agentName}`);
  if (opts.description) fmLines.push(`description: ${opts.description}`);
  fmLines.push("---", "", `# ${agentName} Agent`, "", "Custom agent.", "");
  writeFileSync(resolve(agentDir, "SKILL.md"), fmLines.join("\n"));

  // Write per-agent config.toml
  const runtime: Record<string, unknown> = { models: opts.models };
  if (opts.credentials?.length) runtime.credentials = opts.credentials;
  if (opts.schedule) runtime.schedule = opts.schedule;
  if (opts.hooks) runtime.hooks = opts.hooks;
  if (opts.params) runtime.params = opts.params;
  if (opts.scale !== undefined) runtime.scale = opts.scale;
  if (opts.timeout !== undefined) runtime.timeout = opts.timeout;
  if (opts.maxWorkQueueSize !== undefined) runtime.maxWorkQueueSize = opts.maxWorkQueueSize;
  writeFileSync(resolve(agentDir, "config.toml"), stringifyTOML(runtime));
}

const SONNET_MODEL = {
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
  thinkingLevel: "medium",
  authType: "api_key",
};

const HAIKU_MODEL = {
  provider: "anthropic",
  model: "claude-haiku-4-5-20251001",
  authType: "api_key",
};

describe("loadGlobalConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads valid config.toml with [local]", () => {
    const config = { local: { enabled: false } };
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML(config));
    const loaded = loadGlobalConfig(tmpDir);
    expect(loaded.local?.enabled).toBe(false);
  });

  it("ignores config.json", () => {
    writeFileSync(resolve(tmpDir, "config.json"), JSON.stringify({ local: { enabled: true } }));
    const loaded = loadGlobalConfig(tmpDir);
    expect(loaded).toEqual({
      telemetry: {
        enabled: false,
        provider: "none",
      },
    });
  });

  it("returns empty config when no config file exists", () => {
    const loaded = loadGlobalConfig(tmpDir);
    expect(loaded).toEqual({
      telemetry: {
        enabled: false,
        provider: "none",
      },
    });
  });

  it("loads named model definitions", () => {
    writeModelsConfig(tmpDir, { sonnet: SONNET_MODEL, haiku: HAIKU_MODEL });
    const loaded = loadGlobalConfig(tmpDir);
    expect(loaded.models).toBeDefined();
    expect(loaded.models!.sonnet.provider).toBe("anthropic");
    expect(loaded.models!.haiku.model).toBe("claude-haiku-4-5-20251001");
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

  it("resolves named model references and injects name from directory", () => {
    writeModelsConfig(tmpDir, { sonnet: SONNET_MODEL });
    writeSkillMd(tmpDir, "dev", {
      models: ["sonnet"],
      credentials: ["github_token"],
      schedule: "*/5 * * * *",
      params: { repos: ["acme/app"], triggerLabel: "agent", assignee: "bot" },
    });
    const loaded = loadAgentConfig(tmpDir, "dev");
    expect(loaded.name).toBe("dev");
    expect((loaded.params as any).repos).toEqual(["acme/app"]);
    expect(loaded.models[0].model).toBe("claude-sonnet-4-20250514");
  });

  it("resolves multiple models as a fallback chain", () => {
    writeModelsConfig(tmpDir, { sonnet: SONNET_MODEL, haiku: HAIKU_MODEL });
    writeSkillMd(tmpDir, "dev", {
      models: ["sonnet", "haiku"],
      credentials: ["github_token"],
      schedule: "*/5 * * * *",
    });
    const loaded = loadAgentConfig(tmpDir, "dev");
    expect(loaded.models).toHaveLength(2);
    expect(loaded.models[0].model).toBe("claude-sonnet-4-20250514");
    expect(loaded.models[1].model).toBe("claude-haiku-4-5-20251001");
  });

  it("loads agent config with hooks", () => {
    writeModelsConfig(tmpDir, { sonnet: SONNET_MODEL });
    writeSkillMd(tmpDir, "with-hooks", {
      models: ["sonnet"],
      credentials: ["github_token"],
      schedule: "0 * * * *",
      hooks: {
        pre: ["gh repo clone acme/app /tmp/repo --depth 1", "curl -o /tmp/flags.json https://api.test/flags"],
        post: ["upload-artifacts.sh"],
      },
    });
    const loaded = loadAgentConfig(tmpDir, "with-hooks");

    expect(loaded.hooks?.pre).toHaveLength(2);
    expect(loaded.hooks?.pre![0]).toBe("gh repo clone acme/app /tmp/repo --depth 1");
    expect(loaded.hooks?.post).toHaveLength(1);
    expect(loaded.hooks?.post![0]).toBe("upload-artifacts.sh");
  });

  it("loads agent config without hooks", () => {
    writeModelsConfig(tmpDir, { sonnet: SONNET_MODEL });
    writeSkillMd(tmpDir, "no-hooks", {
      models: ["sonnet"],
      credentials: ["github_token"],
      schedule: "*/5 * * * *",
    });
    const loaded = loadAgentConfig(tmpDir, "no-hooks");
    expect(loaded.hooks).toBeUndefined();
  });

  it("throws when agent SKILL.md is missing", () => {
    expect(() => loadAgentConfig(tmpDir, "nonexistent")).toThrow("Agent config not found");
  });

  it("throws when agent has no models field", () => {
    writeModelsConfig(tmpDir, { sonnet: SONNET_MODEL });
    const agentDir = resolve(tmpDir, "agents", "dev");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(resolve(agentDir, "SKILL.md"), `---
name: dev
---

# Dev
`);
    // Write config.toml without models field
    writeFileSync(resolve(agentDir, "config.toml"), stringifyTOML({
      credentials: ["github_token"],
      schedule: "*/5 * * * *",
    }));
    expect(() => loadAgentConfig(tmpDir, "dev")).toThrow("must have a \"models\" field");
  });

  it("throws when referenced model name is not defined", () => {
    writeModelsConfig(tmpDir, { sonnet: SONNET_MODEL });
    writeSkillMd(tmpDir, "dev", {
      models: ["nonexistent"],
      credentials: ["github_token"],
      schedule: "*/5 * * * *",
    });
    expect(() => loadAgentConfig(tmpDir, "dev")).toThrow("not defined in config.toml");
  });

  it("throws when global config has no models defined", () => {
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({ gateway: { port: 8080 } }));
    writeSkillMd(tmpDir, "dev", {
      models: ["sonnet"],
      credentials: ["github_token"],
      schedule: "*/5 * * * *",
    });
    expect(() => loadAgentConfig(tmpDir, "dev")).toThrow("No models defined");
  });

  it("lists available model names in error message", () => {
    writeModelsConfig(tmpDir, { sonnet: SONNET_MODEL, haiku: HAIKU_MODEL });
    writeSkillMd(tmpDir, "dev", {
      models: ["gpt4o"],
      credentials: ["github_token"],
      schedule: "*/5 * * * *",
    });
    expect(() => loadAgentConfig(tmpDir, "dev")).toThrow("Available: sonnet, haiku");
  });

  it("includes file path in YAML parse error", () => {
    writeModelsConfig(tmpDir, { sonnet: SONNET_MODEL });
    const agentDir = resolve(tmpDir, "agents", "bad-yaml");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(resolve(agentDir, "SKILL.md"), `---
name: [
  - broken
---

# Bad
`);
    // Also write a valid per-agent config.toml so only SKILL.md parsing fails
    writeFileSync(resolve(agentDir, "config.toml"), stringifyTOML({ models: ["sonnet"] }));
    expect(() => loadAgentConfig(tmpDir, "bad-yaml")).toThrow(/SKILL\.md/);
  });

  it("includes file path in TOML parse error for config.toml", () => {
    writeFileSync(resolve(tmpDir, "config.toml"), "models = {invalid toml");
    expect(() => loadProjectConfig(tmpDir)).toThrow(/config\.toml/);
  });

  it("loads description from frontmatter", () => {
    writeModelsConfig(tmpDir, { sonnet: SONNET_MODEL });
    writeSkillMd(tmpDir, "dev", {
      models: ["sonnet"],
      credentials: ["github_token"],
      schedule: "*/5 * * * *",
      description: "Solves GitHub issues by writing code",
    });

    const loaded = loadAgentConfig(tmpDir, "dev");
    expect(loaded.description).toBe("Solves GitHub issues by writing code");
  });

  it("loads maxWorkQueueSize from agent config.toml", () => {
    writeModelsConfig(tmpDir, { sonnet: SONNET_MODEL });
    writeSkillMd(tmpDir, "dev", {
      models: ["sonnet"],
      credentials: ["github_token"],
      maxWorkQueueSize: 50,
    });

    const loaded = loadAgentConfig(tmpDir, "dev");
    expect(loaded.maxWorkQueueSize).toBe(50);
  });

  it("maxWorkQueueSize is undefined when not set in agent config.toml", () => {
    writeModelsConfig(tmpDir, { sonnet: SONNET_MODEL });
    writeSkillMd(tmpDir, "dev", {
      models: ["sonnet"],
      credentials: ["github_token"],
    });

    const loaded = loadAgentConfig(tmpDir, "dev");
    expect(loaded.maxWorkQueueSize).toBeUndefined();
  });
});

describe("loadAgentBody", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns the body after frontmatter", () => {
    const agentDir = resolve(tmpDir, "agents", "dev");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(resolve(agentDir, "SKILL.md"), `---
name: dev
---

# Dev Agent

Do the work.
`);

    const body = loadAgentBody(tmpDir, "dev");
    expect(body).toContain("# Dev Agent");
    expect(body).toContain("Do the work.");
    expect(body).not.toContain("name: dev");
  });

  it("returns empty string for missing SKILL.md", () => {
    const body = loadAgentBody(tmpDir, "nonexistent");
    expect(body).toBe("");
  });

  it("throws ConfigError when SKILL.md has invalid YAML frontmatter", () => {
    const agentDir = resolve(tmpDir, "agents", "broken");
    mkdirSync(agentDir, { recursive: true });
    // YAML with an undefined alias will cause parseYAML to throw
    writeFileSync(resolve(agentDir, "SKILL.md"), "---\nkey: *undefined_alias\n---\n\n# Body");

    expect(() => loadAgentBody(tmpDir, "broken")).toThrow(/Error parsing/);
  });
});

describe("discoverAgents — additional edge cases", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-discover-"));
    mkdirSync(resolve(tmpDir, "agents"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("skips 'node_modules' directory via excluded set", () => {
    // Create node_modules directory inside agents/
    const nodeModulesDir = resolve(tmpDir, "agents", "node_modules");
    mkdirSync(nodeModulesDir, { recursive: true });
    writeFileSync(resolve(nodeModulesDir, "SKILL.md"), "---\n---\n");

    const agents = discoverAgents(tmpDir);
    expect(agents).not.toContain("node_modules");
    expect(agents).toEqual([]);
  });

  it("skips regular files (non-directories) inside agents/", () => {
    // Create a regular file alongside a real agent directory
    const agentDir = resolve(tmpDir, "agents", "worker");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(resolve(agentDir, "SKILL.md"), "---\n---\n");
    // This file should be skipped by the isDirectory() check
    writeFileSync(resolve(tmpDir, "agents", "not-a-dir.txt"), "content");

    const agents = discoverAgents(tmpDir);
    expect(agents).toEqual(["worker"]);
    expect(agents).not.toContain("not-a-dir.txt");
  });
});

describe("loadGlobalConfig projectName", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("extracts projectName from .env.toml onto returned config", () => {
    writeFileSync(resolve(tmpDir, ".env.toml"), 'projectName = "my-project"\n');
    const loaded = loadGlobalConfig(tmpDir);
    expect(loaded.projectName).toBe("my-project");
  });

  it("does not include projectName when .env.toml omits it", () => {
    writeFileSync(resolve(tmpDir, ".env.toml"), '[gateway]\nport = 9090\n');
    const loaded = loadGlobalConfig(tmpDir);
    expect(loaded.projectName).toBeUndefined();
  });

  it("does not deep-merge projectName from config.toml", () => {
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({
      projectName: "from-config-toml",
    } as Record<string, unknown>));
    const loaded = loadGlobalConfig(tmpDir);
    writeFileSync(resolve(tmpDir, ".env.toml"), 'projectName = "from-env-toml"\n');
    const loaded2 = loadGlobalConfig(tmpDir);
    expect(loaded2.projectName).toBe("from-env-toml");
  });
});

describe("loadGlobalConfig three-layer merge", () => {
  let tmpDir: string;
  const testEnvName = `test-merge-${Date.now()}`;
  const testEnvPath = resolve(ENVIRONMENTS_DIR, `${testEnvName}.toml`);

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    try { rmSync(testEnvPath); } catch {}
  });

  it("merges .env.toml overrides into config.toml", () => {
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({
      gateway: { port: 8080 },
    }));
    writeFileSync(resolve(tmpDir, ".env.toml"), stringifyTOML({
      gateway: { port: 9090 },
    }));

    const loaded = loadGlobalConfig(tmpDir);
    expect(loaded.gateway?.port).toBe(9090);
  });

  it("merges environment config over project config", () => {
    mkdirSync(ENVIRONMENTS_DIR, { recursive: true });
    writeFileSync(testEnvPath, stringifyTOML({
      gateway: { url: "https://cloud.example.com" },
    }));
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({
      gateway: { port: 8080 },
    }));

    const loaded = loadGlobalConfig(tmpDir, testEnvName);
    expect(loaded.gateway?.port).toBe(8080);
    expect(loaded.gateway?.url).toBe("https://cloud.example.com");
  });

  it("environment overrides .env.toml overrides config.toml", () => {
    mkdirSync(ENVIRONMENTS_DIR, { recursive: true });
    writeFileSync(testEnvPath, stringifyTOML({
      gateway: { port: 7070 },
    }));
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({
      gateway: { port: 8080 },
    }));
    writeFileSync(resolve(tmpDir, ".env.toml"), stringifyTOML({
      gateway: { port: 9090 },
    }));

    const loaded = loadGlobalConfig(tmpDir, testEnvName);
    expect(loaded.gateway?.port).toBe(7070);
  });

  it("loadProjectConfig does not include environment layers", () => {
    mkdirSync(ENVIRONMENTS_DIR, { recursive: true });
    writeFileSync(testEnvPath, stringifyTOML({
      gateway: { url: "https://cloud.example.com" },
    }));
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({
      gateway: { port: 8080 },
    }));
    writeFileSync(resolve(tmpDir, ".env.toml"), `environment = "${testEnvName}"\n`);

    const raw = loadProjectConfig(tmpDir);
    expect(raw.gateway?.port).toBe(8080);
    expect(raw.gateway?.url).toBeUndefined();
  });
});

describe("validateAgentName", () => {
  it("rejects 'default' as agent name", () => {
    expect(() => validateAgentName("default")).toThrow('reserved');
  });

  it("accepts valid agent names", () => {
    expect(() => validateAgentName("dev")).not.toThrow();
    expect(() => validateAgentName("my-agent")).not.toThrow();
    expect(() => validateAgentName("a")).not.toThrow();
  });

  it("rejects invalid agent names", () => {
    expect(() => validateAgentName("")).toThrow();
    expect(() => validateAgentName("Invalid")).toThrow();
    expect(() => validateAgentName("-bad")).toThrow();
  });

  it("rejects consecutive hyphens", () => {
    expect(() => validateAgentName("my--agent")).toThrow();
  });

  it("allows up to 64 characters", () => {
    const name64 = "a".repeat(64);
    expect(() => validateAgentName(name64)).not.toThrow();
    const name65 = "a".repeat(65);
    expect(() => validateAgentName(name65)).toThrow();
  });
});

describe("project scale configuration", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads config with scale set", () => {
    const config = { scale: 4 };
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML(config));
    const loaded = loadGlobalConfig(tmpDir);
    expect(loaded.scale).toBe(4);
  });

  it("handles default behavior when scale is not set", () => {
    const config = { gateway: { port: 8080 } };
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML(config));
    const loaded = loadGlobalConfig(tmpDir);
    expect(loaded.scale).toBeUndefined();
  });

  it("preserves scale value through config merge layers", () => {
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({ scale: 4 }));
    writeFileSync(resolve(tmpDir, ".env.toml"), stringifyTOML({
      gateway: { port: 9090 },
    }));
    const loaded = loadGlobalConfig(tmpDir);
    expect(loaded.scale).toBe(4);
    expect(loaded.gateway?.port).toBe(9090);
  });
});

describe("agent runtime overrides", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("applies scale from per-agent config.toml", () => {
    writeModelsConfig(tmpDir, { sonnet: SONNET_MODEL });
    writeSkillMd(tmpDir, "dev", {
      models: ["sonnet"],
      credentials: ["github_token"],
      schedule: "*/5 * * * *",
      scale: 5,
    });

    const loaded = loadAgentConfig(tmpDir, "dev");
    expect(loaded.scale).toBe(5);
  });

  it("applies timeout from per-agent config.toml", () => {
    writeModelsConfig(tmpDir, { sonnet: SONNET_MODEL });
    writeSkillMd(tmpDir, "dev", {
      models: ["sonnet"],
      credentials: ["github_token"],
      schedule: "*/5 * * * *",
      timeout: 3600,
    });

    const loaded = loadAgentConfig(tmpDir, "dev");
    expect(loaded.timeout).toBe(3600);
  });

  it("does not read scale/timeout from SKILL.md (they belong in per-agent config.toml)", () => {
    writeModelsConfig(tmpDir, { sonnet: SONNET_MODEL });
    const agentDir = resolve(tmpDir, "agents", "dev");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(resolve(agentDir, "SKILL.md"), `---
name: dev
---

# Dev
`);
    // Write per-agent config.toml without scale/timeout
    writeFileSync(resolve(agentDir, "config.toml"), stringifyTOML({
      credentials: ["github_token"],
      models: ["sonnet"],
      schedule: "*/5 * * * *",
    }));

    const loaded = loadAgentConfig(tmpDir, "dev");
    expect(loaded.scale).toBeUndefined();
    expect(loaded.timeout).toBeUndefined();
  });

  it("applies scale/timeout from per-agent config.toml", () => {
    writeModelsConfig(tmpDir, { sonnet: SONNET_MODEL });
    writeSkillMd(tmpDir, "dev", {
      models: ["sonnet"],
      credentials: ["github_token"],
      schedule: "*/5 * * * *",
      scale: 8,
      timeout: 7200,
    });

    const loaded = loadAgentConfig(tmpDir, "dev");
    expect(loaded.scale).toBe(8);
    expect(loaded.timeout).toBe(7200);
  });

  it("allows scale = 0 to disable an agent", () => {
    writeModelsConfig(tmpDir, { sonnet: SONNET_MODEL });
    writeSkillMd(tmpDir, "dev", {
      models: ["sonnet"],
      credentials: ["github_token"],
      schedule: "*/5 * * * *",
      scale: 0,
    });

    const loaded = loadAgentConfig(tmpDir, "dev");
    expect(loaded.scale).toBe(0);
  });
});

describe("defaultAgentScale", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads defaultAgentScale from config.toml", () => {
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({ defaultAgentScale: 3 }));
    const loaded = loadGlobalConfig(tmpDir);
    expect(loaded.defaultAgentScale).toBe(3);
  });

  it("applies defaultAgentScale to agent when no per-agent override", () => {
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({
      models: { sonnet: SONNET_MODEL },
      defaultAgentScale: 4,
    }));
    writeSkillMd(tmpDir, "dev", {
      models: ["sonnet"],
      credentials: ["github_token"],
      schedule: "*/5 * * * *",
    });

    const loaded = loadAgentConfig(tmpDir, "dev");
    expect(loaded.scale).toBe(4);
  });

  it("per-agent override takes precedence over defaultAgentScale", () => {
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({
      models: { sonnet: SONNET_MODEL },
      defaultAgentScale: 4,
    }));
    writeSkillMd(tmpDir, "dev", {
      models: ["sonnet"],
      credentials: ["github_token"],
      schedule: "*/5 * * * *",
      scale: 2,
    });

    const loaded = loadAgentConfig(tmpDir, "dev");
    expect(loaded.scale).toBe(2);
  });

  it("agent scale is undefined when neither defaultAgentScale nor override is set", () => {
    writeModelsConfig(tmpDir, { sonnet: SONNET_MODEL });
    writeSkillMd(tmpDir, "dev", {
      models: ["sonnet"],
      credentials: ["github_token"],
      schedule: "*/5 * * * *",
    });

    const loaded = loadAgentConfig(tmpDir, "dev");
    expect(loaded.scale).toBeUndefined();
  });

  it("validates: rejects negative defaultAgentScale", () => {
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({ defaultAgentScale: -1 }));
    expect(() => loadGlobalConfig(tmpDir)).toThrow("non-negative integer");
  });

  it("validates: rejects non-integer defaultAgentScale", () => {
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({ defaultAgentScale: 2.5 }));
    expect(() => loadGlobalConfig(tmpDir)).toThrow("non-negative integer");
  });

  it("allows defaultAgentScale = 0 to disable all agents by default", () => {
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({
      models: { sonnet: SONNET_MODEL },
      defaultAgentScale: 0,
    }));
    writeSkillMd(tmpDir, "dev", {
      models: ["sonnet"],
      credentials: ["github_token"],
      schedule: "*/5 * * * *",
    });

    const loaded = loadAgentConfig(tmpDir, "dev");
    expect(loaded.scale).toBe(0);
  });

  it("merges defaultAgentScale through config layers", () => {
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({ defaultAgentScale: 2 }));
    writeFileSync(resolve(tmpDir, ".env.toml"), stringifyTOML({ defaultAgentScale: 5 }));
    const loaded = loadGlobalConfig(tmpDir);
    expect(loaded.defaultAgentScale).toBe(5);
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

  it("discovers agents with SKILL.md", () => {
    for (const name of ["dev", "reviewer"]) {
      const dir = resolve(tmpDir, "agents", name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(resolve(dir, "SKILL.md"), "---\n---\n");
    }
    const agents = discoverAgents(tmpDir);
    expect(agents).toEqual(["dev", "reviewer"]);
  });

  it("excludes dotfile and node_modules directories", () => {
    for (const name of [".al", ".workspace", "dev"]) {
      const dir = resolve(tmpDir, "agents", name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(resolve(dir, "SKILL.md"), "---\n---\n");
    }
    const agents = discoverAgents(tmpDir);
    expect(agents).toEqual(["dev"]);
  });

  it("returns empty array for missing path", () => {
    const agents = discoverAgents(resolve(tmpDir, "nonexistent"));
    expect(agents).toEqual([]);
  });

  it("skips directories without SKILL.md", () => {
    mkdirSync(resolve(tmpDir, "empty-dir"), { recursive: true });
    const agents = discoverAgents(tmpDir);
    expect(agents).toEqual([]);
  });
});

describe("loadSharedFiles", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty object when shared/ does not exist", () => {
    expect(loadSharedFiles(tmpDir)).toEqual({});
  });

  it("returns empty object when shared/ is a file, not a directory", () => {
    writeFileSync(resolve(tmpDir, "shared"), "not a directory");
    expect(loadSharedFiles(tmpDir)).toEqual({});
  });

  it("loads files from shared/ with prefixed keys", () => {
    const sharedDir = resolve(tmpDir, "shared");
    mkdirSync(sharedDir, { recursive: true });
    writeFileSync(resolve(sharedDir, "conventions.md"), "# Conventions\nUse TypeScript.");
    writeFileSync(resolve(sharedDir, "repo-layout.md"), "# Layout\nsrc/ and test/");

    const files = loadSharedFiles(tmpDir);
    expect(Object.keys(files).sort()).toEqual([
      "shared/conventions.md",
      "shared/repo-layout.md",
    ]);
    expect(files["shared/conventions.md"]).toBe("# Conventions\nUse TypeScript.");
    expect(files["shared/repo-layout.md"]).toBe("# Layout\nsrc/ and test/");
  });

  it("recurses into subdirectories", () => {
    const sharedDir = resolve(tmpDir, "shared");
    mkdirSync(resolve(sharedDir, "team"), { recursive: true });
    writeFileSync(resolve(sharedDir, "top.md"), "top");
    writeFileSync(resolve(sharedDir, "team", "policy.md"), "policy");

    const files = loadSharedFiles(tmpDir);
    expect(files["shared/top.md"]).toBe("top");
    expect(files["shared/team/policy.md"]).toBe("policy");
  });

  it("skips dotfiles", () => {
    const sharedDir = resolve(tmpDir, "shared");
    mkdirSync(sharedDir, { recursive: true });
    writeFileSync(resolve(sharedDir, ".hidden"), "secret");
    writeFileSync(resolve(sharedDir, "visible.md"), "visible");

    const files = loadSharedFiles(tmpDir);
    expect(Object.keys(files)).toEqual(["shared/visible.md"]);
  });

  it("returns empty object for empty shared/ directory", () => {
    mkdirSync(resolve(tmpDir, "shared"), { recursive: true });
    expect(loadSharedFiles(tmpDir)).toEqual({});
  });
});

describe("updateProjectScale", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes scale to config.toml", () => {
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({ models: { sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514" } } }));

    updateProjectScale(tmpDir, 3);

    const loaded = loadGlobalConfig(tmpDir);
    expect(loaded.scale).toBe(3);
  });

  it("overwrites existing scale", () => {
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({
      models: { sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514" } },
      scale: 1,
    }));

    updateProjectScale(tmpDir, 7);

    const loaded = loadGlobalConfig(tmpDir);
    expect(loaded.scale).toBe(7);
  });
});

describe("getProjectScale", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns scale from config.toml", () => {
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({
      models: { sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514" } },
      scale: 4,
    }));

    expect(getProjectScale(tmpDir)).toBe(4);
  });

  it("returns default scale of 5 when scale is not set", () => {
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({ models: { sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514" } } }));

    expect(getProjectScale(tmpDir)).toBe(5);
  });
});

describe("getAgentScale", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-test-"));
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({ models: { sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514" } } }));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns scale from per-agent config.toml", () => {
    writeSkillMd(tmpDir, "dev", { models: ["sonnet"], credentials: [], schedule: "*/5 * * * *", scale: 2 });

    expect(getAgentScale(tmpDir, "dev")).toBe(2);
  });

  it("returns 1 when scale is not set in agent config", () => {
    writeSkillMd(tmpDir, "dev", { models: ["sonnet"], credentials: [], schedule: "*/5 * * * *" });

    expect(getAgentScale(tmpDir, "dev")).toBe(1);
  });
});

describe("updateAgentRuntimeField", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-test-"));
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({ models: { sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514" } } }));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates config.toml with the field when it doesn't exist", () => {
    // Set up agent with base config.toml (including models required by loadAgentConfig)
    writeSkillMd(tmpDir, "dev", { models: ["sonnet"], credentials: [], schedule: "*/5 * * * *" });

    updateAgentRuntimeField(tmpDir, "dev", "scale", 3);

    const config = loadAgentConfig(tmpDir, "dev");
    expect(config.scale).toBe(3);
  });

  it("updates an existing scale field", () => {
    writeSkillMd(tmpDir, "dev", { models: ["sonnet"], credentials: [], schedule: "*/5 * * * *", scale: 1 });

    updateAgentRuntimeField(tmpDir, "dev", "scale", 5);

    const config = loadAgentConfig(tmpDir, "dev");
    expect(config.scale).toBe(5);
  });

  it("preserves other fields when updating", () => {
    writeSkillMd(tmpDir, "dev", { models: ["sonnet"], credentials: [], schedule: "*/5 * * * *", scale: 2, timeout: 120 });

    updateAgentRuntimeField(tmpDir, "dev", "scale", 4);

    const config = loadAgentConfig(tmpDir, "dev");
    expect(config.scale).toBe(4);
    expect(config.timeout).toBe(120);
  });
});
