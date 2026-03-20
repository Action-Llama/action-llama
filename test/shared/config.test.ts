import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";
import { stringify as stringifyTOML } from "smol-toml";
import { loadGlobalConfig, loadProjectConfig, loadAgentConfig, loadAgentBody, discoverAgents, validateAgentName } from "../../src/shared/config.js";
import type { GlobalConfig } from "../../src/shared/config.js";
import { ENVIRONMENTS_DIR } from "../../src/shared/paths.js";

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
});

describe("loadAgentConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads SKILL.md frontmatter and injects name from directory", () => {
    const agentDir = resolve(tmpDir, "agents", "dev");
    mkdirSync(agentDir, { recursive: true });
    const skillMd = `---
credentials:
  - github_token
model:
  provider: anthropic
  model: claude-sonnet-4-20250514
  thinkingLevel: medium
  authType: api_key
schedule: "*/5 * * * *"
params:
  repos:
    - acme/app
  triggerLabel: agent
  assignee: bot
---

# Dev Agent

Custom dev agent.
`;
    writeFileSync(resolve(agentDir, "SKILL.md"), skillMd);
    const loaded = loadAgentConfig(tmpDir, "dev");
    expect(loaded.name).toBe("dev");
    expect((loaded.params as any).repos).toEqual(["acme/app"]);
    expect(loaded.model.model).toBe("claude-sonnet-4-20250514");
  });

  it("loads agent config with hooks", () => {
    const agentDir = resolve(tmpDir, "agents", "with-hooks");
    mkdirSync(agentDir, { recursive: true });
    const skillMd = `---
credentials:
  - github_token
schedule: "0 * * * *"
model:
  provider: anthropic
  model: claude-sonnet-4-20250514
  thinkingLevel: medium
  authType: api_key
hooks:
  pre:
    - "gh repo clone acme/app /tmp/repo --depth 1"
    - "curl -o /tmp/flags.json https://api.test/flags"
  post:
    - "upload-artifacts.sh"
---

# With Hooks Agent
`;
    writeFileSync(resolve(agentDir, "SKILL.md"), skillMd);
    const loaded = loadAgentConfig(tmpDir, "with-hooks");

    expect(loaded.hooks?.pre).toHaveLength(2);
    expect(loaded.hooks?.pre![0]).toBe("gh repo clone acme/app /tmp/repo --depth 1");
    expect(loaded.hooks?.post).toHaveLength(1);
    expect(loaded.hooks?.post![0]).toBe("upload-artifacts.sh");
  });

  it("loads agent config without hooks", () => {
    const agentDir = resolve(tmpDir, "agents", "no-hooks");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(resolve(agentDir, "SKILL.md"), `---
credentials:
  - github_token
model:
  provider: anthropic
  model: claude-sonnet-4-20250514
  thinkingLevel: medium
  authType: api_key
schedule: "*/5 * * * *"
---

# No hooks
`);
    const loaded = loadAgentConfig(tmpDir, "no-hooks");
    expect(loaded.hooks).toBeUndefined();
  });

  it("throws when agent SKILL.md is missing", () => {
    expect(() => loadAgentConfig(tmpDir, "nonexistent")).toThrow("Agent config not found");
  });

  it("falls back to global [model] when agent has no model in frontmatter", () => {
    const globalModel = { provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "high", authType: "api_key" };
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({ model: globalModel } as Record<string, unknown>));

    const agentDir = resolve(tmpDir, "agents", "dev");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(resolve(agentDir, "SKILL.md"), `---
credentials:
  - github_token
schedule: "*/5 * * * *"
---

# Dev
`);

    const loaded = loadAgentConfig(tmpDir, "dev");
    expect(loaded.model).toEqual(globalModel);
  });

  it("agent model takes precedence over global model", () => {
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({
      model: { provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "high", authType: "api_key" },
    } as Record<string, unknown>));

    const agentDir = resolve(tmpDir, "agents", "dev");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(resolve(agentDir, "SKILL.md"), `---
credentials:
  - github_token
model:
  provider: openai
  model: gpt-4o
  thinkingLevel: "off"
  authType: api_key
schedule: "*/5 * * * *"
---

# Dev
`);

    const loaded = loadAgentConfig(tmpDir, "dev");
    expect(loaded.model.provider).toBe("openai");
    expect(loaded.model.model).toBe("gpt-4o");
  });

  it("loads description from frontmatter", () => {
    const agentDir = resolve(tmpDir, "agents", "dev");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(resolve(agentDir, "SKILL.md"), `---
description: Solves GitHub issues by writing code
credentials:
  - github_token
schedule: "*/5 * * * *"
model:
  provider: anthropic
  model: claude-sonnet-4-20250514
  authType: api_key
---

# Dev
`);

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
