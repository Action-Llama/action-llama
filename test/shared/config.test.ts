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

  it("loads valid config.toml with [local]", () => {
    const config = { local: { enabled: false } };
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML(config));
    const loaded = loadGlobalConfig(tmpDir);
    expect(loaded.local?.enabled).toBe(false);
  });

  it("loads valid config.toml with [cloud]", () => {
    const config = { cloud: {
      provider: "cloud-run",
      gcpProject: "my-proj",
      region: "us-central1",
      artifactRegistry: "us-central1-docker.pkg.dev/my-proj/al-images",
      serviceAccount: "al-runner@my-proj.iam.gserviceaccount.com",
    } };
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML(config as any));
    const loaded = loadGlobalConfig(tmpDir);
    expect(loaded.cloud?.provider).toBe("cloud-run");
    if (loaded.cloud?.provider === "cloud-run") {
      expect(loaded.cloud.gcpProject).toBe("my-proj");
    }
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

  it("loads agent-config.toml and injects name from directory", () => {
    const agentDir = resolve(tmpDir, "dev");
    mkdirSync(agentDir, { recursive: true });
    const agentOnDisk = {
      credentials: ["github_token:default"],
      model: { provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium", authType: "api_key" },
      schedule: "*/5 * * * *",
      params: { repos: ["acme/app"], triggerLabel: "agent", assignee: "bot" },
    };
    writeFileSync(resolve(agentDir, "agent-config.toml"), stringifyTOML(agentOnDisk as Record<string, unknown>));
    const loaded = loadAgentConfig(tmpDir, "dev");
    expect(loaded.name).toBe("dev");
    expect((loaded.params as any).repos).toEqual(["acme/app"]);
    expect(loaded.model.model).toBe("claude-sonnet-4-20250514");
  });

  it("parses [[preflight]] array-of-tables with nested params", () => {
    const agentDir = resolve(tmpDir, "with-preflight");
    mkdirSync(agentDir, { recursive: true });
    const toml = `
credentials = ["github_token:default"]
schedule = "0 * * * *"

[model]
provider = "anthropic"
model = "claude-sonnet-4-20250514"
thinkingLevel = "medium"
authType = "api_key"

[[preflight]]
provider = "git-clone"
required = true
[preflight.params]
repo = "acme/app"
dest = "/tmp/repo"
depth = 1

[[preflight]]
provider = "http"
required = false
[preflight.params]
url = "https://api.test/flags"
output = "/tmp/flags.json"
headers = { Authorization = "Bearer \${TOKEN}" }

[[preflight]]
provider = "shell"
[preflight.params]
command = "echo hello"
output = "/tmp/hello.txt"
`;
    writeFileSync(resolve(agentDir, "agent-config.toml"), toml);
    const loaded = loadAgentConfig(tmpDir, "with-preflight");

    expect(loaded.preflight).toHaveLength(3);
    expect(loaded.preflight![0].provider).toBe("git-clone");
    expect(loaded.preflight![0].required).toBe(true);
    expect(loaded.preflight![0].params.repo).toBe("acme/app");
    expect(loaded.preflight![0].params.depth).toBe(1);

    expect(loaded.preflight![1].provider).toBe("http");
    expect(loaded.preflight![1].required).toBe(false);
    expect((loaded.preflight![1].params.headers as any).Authorization).toBe("Bearer ${TOKEN}");

    expect(loaded.preflight![2].provider).toBe("shell");
    expect(loaded.preflight![2].required).toBeUndefined(); // omitted → runner treats as true
    expect(loaded.preflight![2].params.command).toBe("echo hello");
  });

  it("loads agent config without preflight", () => {
    const agentDir = resolve(tmpDir, "no-preflight");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(resolve(agentDir, "agent-config.toml"), stringifyTOML({
      credentials: ["github_token:default"],
      model: { provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium", authType: "api_key" },
      schedule: "*/5 * * * *",
    } as Record<string, unknown>));
    const loaded = loadAgentConfig(tmpDir, "no-preflight");
    expect(loaded.preflight).toBeUndefined();
  });

  it("throws when agent config is missing", () => {
    expect(() => loadAgentConfig(tmpDir, "nonexistent")).toThrow("Agent config not found");
  });

  it("falls back to global [model] when agent has no [model]", () => {
    // Write global config with [model]
    const globalModel = { provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "high", authType: "api_key" };
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({ model: globalModel } as Record<string, unknown>));

    // Write agent config without [model]
    const agentDir = resolve(tmpDir, "dev");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(resolve(agentDir, "agent-config.toml"), stringifyTOML({
      credentials: ["github_token:default"],
      schedule: "*/5 * * * *",
    }));

    const loaded = loadAgentConfig(tmpDir, "dev");
    expect(loaded.model).toEqual(globalModel);
  });

  it("agent [model] takes precedence over global [model]", () => {
    // Write global config with [model]
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({
      model: { provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "high", authType: "api_key" },
    } as Record<string, unknown>));

    // Write agent config with its own [model]
    const agentDir = resolve(tmpDir, "dev");
    mkdirSync(agentDir, { recursive: true });
    const agentModel = { provider: "openai", model: "gpt-4o", thinkingLevel: "off", authType: "api_key" };
    writeFileSync(resolve(agentDir, "agent-config.toml"), stringifyTOML({
      credentials: ["github_token:default"],
      model: agentModel,
      schedule: "*/5 * * * *",
    } as Record<string, unknown>));

    const loaded = loadAgentConfig(tmpDir, "dev");
    expect(loaded.model.provider).toBe("openai");
    expect(loaded.model.model).toBe("gpt-4o");
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
