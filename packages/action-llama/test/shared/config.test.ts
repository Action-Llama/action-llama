import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";
import { stringify as stringifyTOML } from "smol-toml";
import { loadGlobalConfig, loadProjectConfig, loadAgentConfig, loadAgentBody, discoverAgents, validateAgentName } from "../../src/shared/config.js";
import type { GlobalConfig } from "../../src/shared/config.js";
import { ENVIRONMENTS_DIR } from "../../src/shared/paths.js";

/** Helper to write a config.toml with named models. */
function writeModelsConfig(dir: string, models: Record<string, unknown>, extra?: Record<string, unknown>) {
  writeFileSync(resolve(dir, "config.toml"), stringifyTOML({ models, ...extra }));
}

/** Helper to write a SKILL.md referencing named models. */
function writeSkillMd(dir: string, agentName: string, opts: { models: string[]; credentials?: string[]; schedule?: string; hooks?: unknown; description?: string; params?: unknown }) {
  const agentDir = resolve(dir, "agents", agentName);
  mkdirSync(agentDir, { recursive: true });
  const lines = ["---"];
  if (opts.description) lines.push(`description: ${opts.description}`);
  lines.push(`metadata:`);
  lines.push(`  credentials:`);
  for (const c of opts.credentials ?? []) lines.push(`    - ${c}`);
  lines.push(`  models:`);
  for (const m of opts.models) lines.push(`    - ${m}`);
  if (opts.schedule) lines.push(`  schedule: "${opts.schedule}"`);
  if (opts.hooks) {
    lines.push(`  hooks:`);
    const h = opts.hooks as any;
    if (h.pre) {
      lines.push(`    pre:`);
      for (const cmd of h.pre) lines.push(`      - "${cmd}"`);
    }
    if (h.post) {
      lines.push(`    post:`);
      for (const cmd of h.post) lines.push(`      - "${cmd}"`);
    }
  }
  if (opts.params) {
    lines.push(`  params:`);
    for (const [k, v] of Object.entries(opts.params as Record<string, unknown>)) {
      if (Array.isArray(v)) {
        lines.push(`    ${k}:`);
        for (const item of v) lines.push(`      - ${item}`);
      } else {
        lines.push(`    ${k}: ${v}`);
      }
    }
  }
  lines.push("---", "", `# ${agentName} Agent`, "", "Custom agent.", "");
  writeFileSync(resolve(agentDir, "SKILL.md"), lines.join("\n"));
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
metadata:
  credentials:
    - github_token
  schedule: "*/5 * * * *"
---

# Dev
`);
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
metadata:
  models: [
    - broken
---

# Bad
`);
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
metadata:
  credentials: []
---

# Dev Agent

Do the work.
`);

    const body = loadAgentBody(tmpDir, "dev");
    expect(body).toContain("# Dev Agent");
    expect(body).toContain("Do the work.");
    expect(body).not.toContain("credentials");
  });

  it("returns empty string for missing SKILL.md", () => {
    const body = loadAgentBody(tmpDir, "nonexistent");
    expect(body).toBe("");
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
