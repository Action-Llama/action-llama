import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { stringify as stringifyYAML } from "yaml";
import { stringify as stringifyTOML, parse as parseTOML } from "smol-toml";
import { parseFrontmatter } from "../../../src/shared/frontmatter.js";

// Mock inquirer prompts
const mockSelect = vi.fn();
const mockInput = vi.fn();
const mockCheckbox = vi.fn();
const mockConfirm = vi.fn();

vi.mock("@inquirer/prompts", () => ({
  select: (...args: any[]) => mockSelect(...args),
  input: (...args: any[]) => mockInput(...args),
  checkbox: (...args: any[]) => mockCheckbox(...args),
  confirm: (...args: any[]) => mockConfirm(...args),
  search: vi.fn(),
}));

// Mock resolvePackageRoot to point to a temp dir with example templates
let mockPackageRoot: string;
vi.mock("../../../src/setup/scaffold.js", async (importOriginal) => {
  const orig = await importOriginal() as any;
  const { existsSync: exists, readFileSync: readFile, writeFileSync: writeFile, mkdirSync: mkdir } = await import("fs");
  const { resolve: resolvePath } = await import("path");
  const { stringify: toTOML } = await import("smol-toml");
  return {
    ...orig,
    resolvePackageRoot: () => mockPackageRoot,
    // Wrap scaffoldAgent to ensure per-agent config.toml has models reference
    // (scaffoldAgent writes config.toml from agent.config runtime fields,
    // but loadAgentConfig requires models; in production `al new` writes them separately).
    scaffoldAgent: (projectPath: string, agent: any) => {
      orig.scaffoldAgent(projectPath, agent);
      const agentDir = resolvePath(projectPath, "agents", agent.name);
      const configPath = resolvePath(agentDir, "config.toml");
      if (exists(configPath)) {
        const content = readFile(configPath, "utf-8");
        if (!content.includes("models")) {
          writeFile(configPath, content + '\nmodels = ["sonnet"]\n');
        }
      } else {
        mkdir(agentDir, { recursive: true });
        writeFile(configPath, toTOML({ models: ["sonnet"] }) + "\n");
      }
    },
  };
});

// Mock doctor to avoid real execution
const mockDoctorExecute = vi.fn().mockResolvedValue(undefined);
vi.mock("../../../src/cli/commands/doctor.js", () => ({
  execute: (...args: any[]) => mockDoctorExecute(...args),
}));

// Mock credential registry
const credDefs: Record<string, any> = {
  github_token: { id: "github_token", label: "GitHub Token", description: "PAT", fields: [{ name: "token", label: "Token", description: "PAT", secret: true }] },
  anthropic_key: { id: "anthropic_key", label: "Anthropic Key", description: "API key", fields: [{ name: "token", label: "Key", description: "Key", secret: true }] },
  git_ssh: { id: "git_ssh", label: "Git SSH", description: "SSH key", fields: [{ name: "id_rsa", label: "Key", description: "Key", secret: true }] },
  github_webhook_secret: { id: "github_webhook_secret", label: "GitHub Webhook Secret", description: "HMAC secret", fields: [{ name: "secret", label: "Webhook Secret", secret: true }] },
};
vi.mock("../../../src/credentials/registry.js", () => ({
  listBuiltinCredentialIds: () => ["github_token", "anthropic_key", "git_ssh"],
  getBuiltinCredential: (id: string) => credDefs[id],
  resolveCredential: (id: string) => {
    if (credDefs[id]) return credDefs[id];
    throw new Error(`Unknown credential "${id}".`);
  },
}));

// Mock credentials module (for listCredentialInstances, writeCredentialFields)
vi.mock("../../../src/shared/credentials.js", () => ({
  listCredentialInstances: vi.fn().mockResolvedValue([]),
  writeCredentialFields: vi.fn().mockResolvedValue(undefined),
}));

// Mock credential prompter
vi.mock("../../../src/credentials/prompter.js", () => ({
  promptCredential: vi.fn().mockResolvedValue(undefined),
}));

import { newAgent, configAgent } from "../../../src/cli/commands/agent.js";
import { listCredentialInstances, writeCredentialFields } from "../../../src/shared/credentials.js";
import { promptCredential } from "../../../src/credentials/prompter.js";

describe("agent new", () => {
  let tmpDir: string;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = mkdtempSync(join(tmpdir(), "al-agent-new-"));
    mockPackageRoot = mkdtempSync(join(tmpdir(), "al-pkg-"));
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // Create agents dir
    mkdirSync(resolve(tmpDir, "agents"), { recursive: true });
    // Write config.toml with model definitions so loadAgentConfig can resolve model names
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({
      models: { sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" } },
    }));
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    rmSync(tmpDir, { recursive: true, force: true });
    rmSync(mockPackageRoot, { recursive: true, force: true });
  });

  it("creates agent from example template (dev)", async () => {
    // Set up example template with SKILL.md (portable) and config.toml (runtime)
    const exampleDir = resolve(mockPackageRoot, "docs", "examples", "dev");
    mkdirSync(exampleDir, { recursive: true });
    writeFileSync(resolve(exampleDir, "SKILL.md"), '---\n---\n\n# Dev Agent\n');
    writeFileSync(resolve(exampleDir, "config.toml"), stringifyTOML({
      credentials: ["github_token"],
      models: ["sonnet"],
    }) + "\n");

    // Mock: select type=dev, input name=my-dev, then "done" in config menu
    mockSelect
      .mockResolvedValueOnce("dev")      // agent type
      .mockResolvedValueOnce("done");    // config menu: done
    mockInput.mockResolvedValueOnce("my-dev"); // agent name

    await newAgent({ project: tmpDir });

    const agentDir = resolve(tmpDir, "agents", "my-dev");
    expect(existsSync(resolve(agentDir, "SKILL.md"))).toBe(true);
    expect(readFileSync(resolve(agentDir, "SKILL.md"), "utf-8")).toContain("# Dev Agent");
    // Runtime config (credentials, models) lives in config.toml now
    expect(existsSync(resolve(agentDir, "config.toml"))).toBe(true);
    const agentToml = parseTOML(readFileSync(resolve(agentDir, "config.toml"), "utf-8")) as any;
    expect(agentToml.credentials).toContain("github_token");
  });

  it("creates custom agent with scaffoldAgent", async () => {
    mockSelect
      .mockResolvedValueOnce("custom")   // agent type
      .mockResolvedValueOnce("done");    // config menu: done
    mockInput.mockResolvedValueOnce("my-custom"); // agent name

    await newAgent({ project: tmpDir });

    const agentDir = resolve(tmpDir, "agents", "my-custom");
    expect(existsSync(resolve(agentDir, "SKILL.md"))).toBe(true);
  });

  it("throws when example template is missing SKILL.md", async () => {
    // Create example dir WITHOUT SKILL.md
    const exampleDir = resolve(mockPackageRoot, "docs", "examples", "reviewer");
    mkdirSync(exampleDir, { recursive: true });
    // No SKILL.md in the directory

    mockSelect
      .mockResolvedValueOnce("reviewer")   // agent type
      .mockResolvedValueOnce("done");      // (won't be reached)
    mockInput.mockResolvedValueOnce("my-reviewer");

    await expect(newAgent({ project: tmpDir })).rejects.toThrow(
      'Example template "reviewer" is missing SKILL.md'
    );
  });

  it("creates agent from example template without config.toml (no copy)", async () => {
    // Template has SKILL.md but no config.toml
    const exampleDir = resolve(mockPackageRoot, "docs", "examples", "devops");
    mkdirSync(exampleDir, { recursive: true });
    writeFileSync(resolve(exampleDir, "SKILL.md"), "---\n---\n\n# DevOps Agent\n");
    // Deliberately NO config.toml in example dir

    mockSelect
      .mockResolvedValueOnce("devops")     // agent type
      .mockResolvedValueOnce("done");      // config menu: done
    mockInput.mockResolvedValueOnce("my-devops");

    await newAgent({ project: tmpDir });

    const agentDir = resolve(tmpDir, "agents", "my-devops");
    expect(existsSync(resolve(agentDir, "SKILL.md"))).toBe(true);
    // config.toml should still be created by configAgent (done saves it)
    // But no template config.toml was copied
    const agentToml = parseTOML(readFileSync(resolve(agentDir, "config.toml"), "utf-8")) as any;
    // models array should be empty or undefined (no template config was copied)
    expect(agentToml.models).toBeDefined();
  });

  it("rejects invalid agent names via validate callback", async () => {
    mockSelect.mockResolvedValueOnce("custom");
    // Simulate: first call invokes validate, let's test the validate function
    mockInput.mockImplementationOnce(async (opts: any) => {
      // Test validation rejects "default"
      const result = opts.validate("default");
      expect(result).toContain("reserved");
      // Test validation rejects existing
      mkdirSync(resolve(tmpDir, "agents", "existing"), { recursive: true });
      const result2 = opts.validate("existing");
      expect(result2).toContain("already exists");
      // Test validation accepts valid name
      expect(opts.validate("good-name")).toBe(true);
      return "good-name";
    });
    mockSelect.mockResolvedValueOnce("done"); // config menu

    await newAgent({ project: tmpDir });
  });
});

describe("agent config", () => {
  let tmpDir: string;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = mkdtempSync(join(tmpdir(), "al-agent-cfg-"));
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    // Write config.toml with model definitions so loadAgentConfig can resolve model names
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({
      models: { sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" } },
    }));
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function createAgentConfig(name: string, config: Record<string, unknown>) {
    const agentDir = resolve(tmpDir, "agents", name);
    mkdirSync(agentDir, { recursive: true });
    // Portable fields go in SKILL.md frontmatter
    const { description, license, compatibility, ...runtimeFields } = config;
    const frontmatter: Record<string, unknown> = {};
    if (description) frontmatter.description = description;
    if (license) frontmatter.license = license;
    if (compatibility) frontmatter.compatibility = compatibility;
    const yamlStr = Object.keys(frontmatter).length > 0 ? stringifyYAML(frontmatter).trimEnd() : "";
    writeFileSync(resolve(agentDir, "SKILL.md"), `---\n${yamlStr}\n---\n\n# Test\n`);
    // Runtime fields go in per-agent config.toml
    if (Object.keys(runtimeFields).length > 0) {
      writeFileSync(resolve(agentDir, "config.toml"), stringifyTOML(runtimeFields as Record<string, any>) + "\n");
    }
  }

  it("throws when agent does not exist", async () => {
    await expect(configAgent("nonexistent", { project: tmpDir }))
      .rejects.toThrow("not found");
  });

  it("edits credentials and saves config", async () => {
    createAgentConfig("test-agent", { credentials: ["github_token"], models: ["sonnet"] });

    mockSelect
      .mockResolvedValueOnce("credentials") // menu: credentials
      .mockResolvedValueOnce("done");       // menu: done
    mockCheckbox.mockResolvedValueOnce(["github_token", "anthropic_key"]);

    await configAgent("test-agent", { project: tmpDir });

    const toml = parseTOML(readFileSync(resolve(tmpDir, "agents", "test-agent", "config.toml"), "utf-8")) as any;
    expect(toml.credentials).toEqual(["github_token", "anthropic_key"]);
    expect(mockDoctorExecute).toHaveBeenCalledWith({ project: tmpDir });
  });

  it("edits schedule", async () => {
    createAgentConfig("sched-agent", { credentials: [], models: ["sonnet"] });

    mockSelect
      .mockResolvedValueOnce("schedule")
      .mockResolvedValueOnce("done");
    mockInput.mockResolvedValueOnce("*/10 * * * *");

    await configAgent("sched-agent", { project: tmpDir });

    const toml = parseTOML(readFileSync(resolve(tmpDir, "agents", "sched-agent", "config.toml"), "utf-8")) as any;
    expect(toml.schedule).toBe("*/10 * * * *");
  });

  it("edits model to openai", async () => {
    createAgentConfig("model-agent", { credentials: [], models: ["sonnet"] });

    mockSelect
      .mockResolvedValueOnce("model")      // menu: model
      .mockResolvedValueOnce("openai")     // provider
      .mockResolvedValueOnce("gpt-4o")     // model name
      .mockResolvedValueOnce("done");      // menu: done

    await configAgent("model-agent", { project: tmpDir });

    // configAgent writes model names to per-agent config.toml (not full ModelConfig objects)
    // and adds/updates the named model in the project-level config.toml [models] section
    const toml = parseTOML(readFileSync(resolve(tmpDir, "agents", "model-agent", "config.toml"), "utf-8")) as any;
    expect(toml.models).toBeDefined();
    // The project-level config.toml should have the new model definition
    const projectToml = parseTOML(readFileSync(resolve(tmpDir, "config.toml"), "utf-8")) as any;
    expect(projectToml.models).toBeDefined();
  });

  it("edits params — add and save", async () => {
    createAgentConfig("params-agent", { credentials: [], models: ["sonnet"] });

    mockSelect
      .mockResolvedValueOnce("params")    // menu: params
      .mockResolvedValueOnce("add")       // params: + Add new param
      .mockResolvedValueOnce("back")      // params: back
      .mockResolvedValueOnce("done");     // menu: done
    mockInput
      .mockResolvedValueOnce("myKey")     // param key
      .mockResolvedValueOnce("myValue");  // param value

    await configAgent("params-agent", { project: tmpDir });

    const toml = parseTOML(readFileSync(resolve(tmpDir, "agents", "params-agent", "config.toml"), "utf-8")) as any;
    expect(toml.params.myKey).toBe("myValue");
  });

  it("edits params — shows existing params and allows editing", async () => {
    createAgentConfig("params-edit", { credentials: [], models: ["sonnet"], params: { existing: "old-value" } });

    mockSelect
      .mockResolvedValueOnce("params")         // menu: params
      .mockResolvedValueOnce("edit:existing")  // select existing param
      .mockResolvedValueOnce("edit")           // choose to edit
      .mockResolvedValueOnce("back")           // params: back
      .mockResolvedValueOnce("done");          // menu: done
    mockInput
      .mockResolvedValueOnce("new-value");     // new value

    await configAgent("params-edit", { project: tmpDir });

    const toml = parseTOML(readFileSync(resolve(tmpDir, "agents", "params-edit", "config.toml"), "utf-8")) as any;
    expect(toml.params.existing).toBe("new-value");
  });

  it("edits params — remove existing param", async () => {
    createAgentConfig("params-rm", { credentials: [], models: ["sonnet"], params: { removeme: "gone", keepme: "stay" } });

    mockSelect
      .mockResolvedValueOnce("params")          // menu: params
      .mockResolvedValueOnce("edit:removeme")   // select param
      .mockResolvedValueOnce("remove")          // choose to remove
      .mockResolvedValueOnce("back")            // params: back
      .mockResolvedValueOnce("done");           // menu: done

    await configAgent("params-rm", { project: tmpDir });

    const toml = parseTOML(readFileSync(resolve(tmpDir, "agents", "params-rm", "config.toml"), "utf-8")) as any;
    expect(toml.params?.removeme).toBeUndefined();
    expect(toml.params.keepme).toBe("stay");
  });

  it("does not throw when agent references undefined model", async () => {
    // This is the key bug fix: config.toml references "sonnet" but project only has "opus"
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({
      models: { opus: { provider: "anthropic", model: "claude-opus-4-20250514", authType: "api_key" } },
    }));
    createAgentConfig("bad-model", { credentials: [], models: ["sonnet"] });

    mockSelect.mockResolvedValueOnce("done");

    // Should NOT throw — previously this would fail with "references model which is not defined"
    await configAgent("bad-model", { project: tmpDir });

    const toml = parseTOML(readFileSync(resolve(tmpDir, "agents", "bad-model", "config.toml"), "utf-8")) as any;
    expect(toml.models).toEqual(["sonnet"]);
  });

  it("shows error indicator for undefined model in menu", async () => {
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({
      models: { opus: { provider: "anthropic", model: "claude-opus-4-20250514", authType: "api_key" } },
    }));
    createAgentConfig("bad-model2", { credentials: [], models: ["sonnet"] });

    // Capture the choices passed to select
    let menuChoices: any[] = [];
    mockSelect.mockImplementationOnce(async (opts: any) => {
      menuChoices = opts.choices;
      return "done";
    });

    await configAgent("bad-model2", { project: tmpDir });

    const modelChoice = menuChoices.find((c: any) => c.value === "model");
    expect(modelChoice.name).toContain("✗");
    expect(modelChoice.name).toContain("sonnet");
    expect(modelChoice.name).toContain("not in config.toml");
  });

  it("shows error indicator for undefined webhook source in menu", async () => {
    createAgentConfig("wh-bad", {
      credentials: [],
      models: ["sonnet"],
      webhooks: [{ source: "github", events: ["pull_request"] }],
    });

    let menuChoices: any[] = [];
    mockSelect.mockImplementationOnce(async (opts: any) => {
      menuChoices = opts.choices;
      return "done";
    });

    await configAgent("wh-bad", { project: tmpDir });

    const webhookChoice = menuChoices.find((c: any) => c.value === "webhooks");
    expect(webhookChoice.name).toContain("✗");
    expect(webhookChoice.name).toContain('"github"');
    expect(webhookChoice.name).toContain("not in config.toml");
  });

  it("shows valid indicator when webhook source exists", async () => {
    // Add a webhook source to the project config
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({
      models: { sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" } },
      webhooks: { github: { type: "github" } },
    }));
    createAgentConfig("wh-good", {
      credentials: [],
      models: ["sonnet"],
      webhooks: [{ source: "github", events: ["pull_request"] }],
    });

    let menuChoices: any[] = [];
    mockSelect.mockImplementationOnce(async (opts: any) => {
      menuChoices = opts.choices;
      return "done";
    });

    await configAgent("wh-good", { project: tmpDir });

    const webhookChoice = menuChoices.find((c: any) => c.value === "webhooks");
    expect(webhookChoice.name).toContain("✓");
    expect(webhookChoice.name).toContain("1 trigger");
  });

  it("webhooks offers to create source when none configured", async () => {
    createAgentConfig("wh-agent", { credentials: [], models: ["sonnet"] });

    mockSelect
      .mockResolvedValueOnce("webhooks")  // menu: webhooks
      .mockResolvedValueOnce("done");     // menu: done
    mockConfirm.mockResolvedValueOnce(false); // decline to add source

    await configAgent("wh-agent", { project: tmpDir });

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("No webhook sources");
  });

  it("webhooks walks through source creation when user accepts", async () => {
    createAgentConfig("wh-setup", { credentials: [], models: ["sonnet"] });

    // No webhook sources in project config.toml yet
    mockSelect
      .mockResolvedValueOnce("webhooks")    // menu: webhooks
      .mockResolvedValueOnce("github")      // provider type for new source
      .mockResolvedValueOnce("__skip__")    // skip webhook secret (accept unsigned)
      .mockResolvedValueOnce("back")        // webhooks: back (after source created)
      .mockResolvedValueOnce("done");       // menu: done
    mockConfirm.mockResolvedValueOnce(true);  // accept to add source
    mockInput
      .mockResolvedValueOnce("my-github");  // source name

    await configAgent("wh-setup", { project: tmpDir });

    // Project config.toml should have the webhook source
    const configToml = readFileSync(resolve(tmpDir, "config.toml"), "utf-8");
    expect(configToml).toContain("my-github");
    expect(configToml).toContain("github");
  });

  it("webhooks — add trigger with events, actions, repos, labels", async () => {
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({
      models: { sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" } },
      webhooks: { "my-github": { type: "github" } },
    }));
    createAgentConfig("wh-add-trig", { credentials: [], models: ["sonnet"] });

    mockSelect
      .mockResolvedValueOnce("webhooks")    // menu: webhooks
      .mockResolvedValueOnce("add")         // webhooks: add trigger
      .mockResolvedValueOnce("my-github")   // source selection
      .mockResolvedValueOnce("back")        // webhooks: back
      .mockResolvedValueOnce("done");       // menu: done
    mockInput
      .mockResolvedValueOnce("pull_request,push")  // events
      .mockResolvedValueOnce("opened,closed")      // actions
      .mockResolvedValueOnce("owner/repo")         // repos
      .mockResolvedValueOnce("bug");               // labels

    await configAgent("wh-add-trig", { project: tmpDir });

    const toml = parseTOML(readFileSync(resolve(tmpDir, "agents", "wh-add-trig", "config.toml"), "utf-8")) as any;
    expect(toml.webhooks).toHaveLength(1);
    expect(toml.webhooks[0].source).toBe("my-github");
    expect(toml.webhooks[0].events).toEqual(["pull_request", "push"]);
    expect(toml.webhooks[0].actions).toEqual(["opened", "closed"]);
    expect(toml.webhooks[0].repos).toEqual(["owner/repo"]);
    expect(toml.webhooks[0].labels).toEqual(["bug"]);
  });

  it("webhooks — add trigger with no optional fields (all empty)", async () => {
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({
      models: { sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" } },
      webhooks: { "my-sentry": { type: "sentry" } },
    }));
    createAgentConfig("wh-no-fields", { credentials: [], models: ["sonnet"] });

    mockSelect
      .mockResolvedValueOnce("webhooks")    // menu: webhooks
      .mockResolvedValueOnce("add")         // webhooks: add trigger
      .mockResolvedValueOnce("my-sentry")   // source selection
      .mockResolvedValueOnce("back")        // webhooks: back
      .mockResolvedValueOnce("done");       // menu: done
    mockInput
      .mockResolvedValueOnce("")   // events (empty = all)
      .mockResolvedValueOnce("")   // actions (empty = all)
      .mockResolvedValueOnce("")   // repos (empty = all)
      .mockResolvedValueOnce("");  // labels (empty = all)

    await configAgent("wh-no-fields", { project: tmpDir });

    const toml = parseTOML(readFileSync(resolve(tmpDir, "agents", "wh-no-fields", "config.toml"), "utf-8")) as any;
    expect(toml.webhooks).toHaveLength(1);
    expect(toml.webhooks[0].source).toBe("my-sentry");
    expect(toml.webhooks[0].events).toBeUndefined();
    expect(toml.webhooks[0].actions).toBeUndefined();
    expect(toml.webhooks[0].repos).toBeUndefined();
    expect(toml.webhooks[0].labels).toBeUndefined();
  });

  it("webhooks — remove action with no triggers shows message", async () => {
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({
      models: { sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" } },
      webhooks: { "my-github": { type: "github" } },
    }));
    createAgentConfig("wh-no-remove", { credentials: [], models: ["sonnet"] });

    mockSelect
      .mockResolvedValueOnce("webhooks")  // menu: webhooks
      .mockResolvedValueOnce("remove")    // webhooks: remove trigger (no triggers configured)
      .mockResolvedValueOnce("back")      // webhooks: back
      .mockResolvedValueOnce("done");     // menu: done

    await configAgent("wh-no-remove", { project: tmpDir });

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("No triggers to remove");
  });

  it("webhooks — remove existing trigger", async () => {
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({
      models: { sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" } },
      webhooks: { "my-github": { type: "github" } },
    }));
    createAgentConfig("wh-remove-trig", {
      credentials: [],
      models: ["sonnet"],
      webhooks: [{ source: "my-github", events: ["push"] }],
    });

    mockSelect
      .mockResolvedValueOnce("webhooks")  // menu: webhooks
      .mockResolvedValueOnce("remove")    // webhooks: remove trigger
      .mockResolvedValueOnce("back")      // webhooks: back
      .mockResolvedValueOnce("done");     // menu: done
    mockCheckbox.mockResolvedValueOnce([0]); // select index 0 to remove

    await configAgent("wh-remove-trig", { project: tmpDir });

    const toml = parseTOML(readFileSync(resolve(tmpDir, "agents", "wh-remove-trig", "config.toml"), "utf-8")) as any;
    // webhooks should be removed (empty array cleaned up → undefined)
    expect(toml.webhooks).toBeUndefined();
  });

  it("webhooks — add-source inside sub-menu", async () => {
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({
      models: { sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" } },
      webhooks: { "existing-src": { type: "github" } },
    }));
    createAgentConfig("wh-add-src", { credentials: [], models: ["sonnet"] });

    // Use "test" as provider type — it has no required credentials (WEBHOOK_SECRET_TYPES["test"] === undefined)
    mockSelect
      .mockResolvedValueOnce("webhooks")      // menu: webhooks
      .mockResolvedValueOnce("add-source")    // webhooks: add webhook source
      .mockResolvedValueOnce("test")          // provider type: test (no credential needed)
      .mockResolvedValueOnce("back")          // webhooks: back
      .mockResolvedValueOnce("done");         // menu: done
    mockInput
      .mockResolvedValueOnce("my-test-src");  // source name

    await configAgent("wh-add-src", { project: tmpDir });

    const configToml = readFileSync(resolve(tmpDir, "config.toml"), "utf-8");
    expect(configToml).toContain("my-test-src");
    expect(configToml).toContain("test");
  });

  it("webhooks — missing source, user declines to create", async () => {
    // Agent has webhook trigger referencing a non-existent source
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({
      models: { sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" } },
      webhooks: { "other-src": { type: "github" } },
    }));
    createAgentConfig("wh-missing-src", {
      credentials: [],
      models: ["sonnet"],
      webhooks: [{ source: "nonexistent-source" }],
    });

    mockSelect
      .mockResolvedValueOnce("webhooks")  // menu: webhooks
      .mockResolvedValueOnce("back")      // webhooks: back (after declining)
      .mockResolvedValueOnce("done");     // menu: done
    mockConfirm.mockResolvedValueOnce(false); // decline to create missing source

    await configAgent("wh-missing-src", { project: tmpDir });

    // Should not have added any new sources
    const configToml = parseTOML(readFileSync(resolve(tmpDir, "config.toml"), "utf-8")) as any;
    expect(configToml.webhooks["nonexistent-source"]).toBeUndefined();
  });

  it("edits model — creates new anthropic model with thinkingLevel", async () => {
    createAgentConfig("anthropic-model-agent", { credentials: [], models: ["sonnet"] });

    mockSelect
      .mockResolvedValueOnce("model")                       // menu: model
      .mockResolvedValueOnce("__create__")                  // create new model
      .mockResolvedValueOnce("anthropic")                   // provider: anthropic
      .mockResolvedValueOnce("claude-opus-4-20250514")      // model selection
      .mockResolvedValueOnce("high")                        // thinking level
      .mockResolvedValueOnce("done");                       // menu: done
    mockInput
      .mockResolvedValueOnce("opus");                       // model reference name

    await configAgent("anthropic-model-agent", { project: tmpDir });

    const agentToml = parseTOML(readFileSync(resolve(tmpDir, "agents", "anthropic-model-agent", "config.toml"), "utf-8")) as any;
    expect(agentToml.models).toEqual(["opus"]);
    const projectToml = parseTOML(readFileSync(resolve(tmpDir, "config.toml"), "utf-8")) as any;
    expect(projectToml.models.opus).toBeDefined();
    expect(projectToml.models.opus.provider).toBe("anthropic");
    expect(projectToml.models.opus.model).toBe("claude-opus-4-20250514");
    expect(projectToml.models.opus.thinkingLevel).toBe("high");
  });

  it("edits model — creates new groq model with custom model input", async () => {
    createAgentConfig("groq-model-agent", { credentials: [], models: ["sonnet"] });

    mockSelect
      .mockResolvedValueOnce("model")         // menu: model
      .mockResolvedValueOnce("__create__")    // create new model
      .mockResolvedValueOnce("groq")          // provider: groq
      .mockResolvedValueOnce("done");         // menu: done
    mockInput
      .mockResolvedValueOnce("my-groq")                     // model reference name
      .mockResolvedValueOnce("llama-3.3-70b-versatile");    // groq model input

    await configAgent("groq-model-agent", { project: tmpDir });

    const projectToml = parseTOML(readFileSync(resolve(tmpDir, "config.toml"), "utf-8")) as any;
    expect(projectToml.models["my-groq"]).toBeDefined();
    expect(projectToml.models["my-groq"].provider).toBe("groq");
    expect(projectToml.models["my-groq"].model).toBe("llama-3.3-70b-versatile");
  });

  it("edits model — selects existing model from list", async () => {
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({
      models: {
        sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" },
        gpt4: { provider: "openai", model: "gpt-4o", authType: "api_key" },
      },
    }));
    createAgentConfig("select-existing-model", { credentials: [], models: ["sonnet"] });

    mockSelect
      .mockResolvedValueOnce("model")    // menu: model
      .mockResolvedValueOnce("gpt4")     // select existing model
      .mockResolvedValueOnce("done");    // menu: done

    await configAgent("select-existing-model", { project: tmpDir });

    const agentToml = parseTOML(readFileSync(resolve(tmpDir, "agents", "select-existing-model", "config.toml"), "utf-8")) as any;
    expect(agentToml.models).toEqual(["gpt4"]);
  });

  it("clears schedule when empty input is given", async () => {
    createAgentConfig("clear-sched", {
      credentials: [],
      models: ["sonnet"],
      schedule: "*/5 * * * *",
    });

    mockSelect
      .mockResolvedValueOnce("schedule")  // menu: schedule
      .mockResolvedValueOnce("done");     // menu: done
    mockInput.mockResolvedValueOnce("");  // empty to clear schedule

    await configAgent("clear-sched", { project: tmpDir });

    const toml = parseTOML(readFileSync(resolve(tmpDir, "agents", "clear-sched", "config.toml"), "utf-8")) as any;
    expect(toml.schedule).toBeUndefined();
  });

  it("editSchedule validates cron expression fields", async () => {
    createAgentConfig("validate-sched", { credentials: [], models: ["sonnet"] });

    mockSelect
      .mockResolvedValueOnce("schedule")  // menu: schedule
      .mockResolvedValueOnce("done");     // menu: done
    mockInput.mockImplementationOnce(async (opts: any) => {
      // 4 fields — invalid
      const result4 = opts.validate("* * * *");
      expect(result4).toBe("Cron expression must have 5 space-separated fields");
      // empty — valid
      expect(opts.validate("")).toBe(true);
      // 5 fields — valid
      expect(opts.validate("0 12 * * 1")).toBe(true);
      return "0 12 * * 1";
    });

    await configAgent("validate-sched", { project: tmpDir });

    const toml = parseTOML(readFileSync(resolve(tmpDir, "agents", "validate-sched", "config.toml"), "utf-8")) as any;
    expect(toml.schedule).toBe("0 12 * * 1");
  });

  it("shows no-model indicator in menu when no models configured", async () => {
    // Directly create agent config with empty models
    const agentDir = resolve(tmpDir, "agents", "no-models-agent");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(resolve(agentDir, "SKILL.md"), "---\n---\n\n# Test\n");
    writeFileSync(resolve(agentDir, "config.toml"), stringifyTOML({ models: [] }) + "\n");

    let menuChoices: any[] = [];
    mockSelect.mockImplementationOnce(async (opts: any) => {
      menuChoices = opts.choices;
      return "done";
    });

    await configAgent("no-models-agent", { project: tmpDir });

    const modelChoice = menuChoices.find((c: any) => c.value === "model");
    expect(modelChoice.name).toContain("✗");
    expect(modelChoice.name).toContain("(none configured)");
  });

  it("shows available models in error when model is undefined but others exist", async () => {
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({
      models: {
        opus: { provider: "anthropic", model: "claude-opus-4-20250514", authType: "api_key" },
        haiku: { provider: "anthropic", model: "claude-haiku-3-5-20241022", authType: "api_key" },
      },
    }));
    createAgentConfig("available-models-check", { credentials: [], models: ["sonnet"] });

    let menuChoices: any[] = [];
    mockSelect.mockImplementationOnce(async (opts: any) => {
      menuChoices = opts.choices;
      return "done";
    });

    await configAgent("available-models-check", { project: tmpDir });

    const modelChoice = menuChoices.find((c: any) => c.value === "model");
    expect(modelChoice.name).toContain("✗");
    // Should include available models
    expect(modelChoice.name).toMatch(/opus|haiku/);
  });

  it("shows schedule-only indicator when no schedule and no webhooks", async () => {
    createAgentConfig("no-sched-wh", { credentials: [], models: ["sonnet"] });

    let menuChoices: any[] = [];
    mockSelect.mockImplementationOnce(async (opts: any) => {
      menuChoices = opts.choices;
      return "done";
    });

    await configAgent("no-sched-wh", { project: tmpDir });

    const scheduleChoice = menuChoices.find((c: any) => c.value === "schedule");
    expect(scheduleChoice.name).toContain("✗");
    expect(scheduleChoice.name).toContain("needs schedule or webhooks");
  });

  it("shows schedule 'using webhooks' indicator when agent has webhooks but no schedule", async () => {
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({
      models: { sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" } },
      webhooks: { "gh": { type: "github" } },
    }));
    createAgentConfig("webhook-only-sched", {
      credentials: [],
      models: ["sonnet"],
      webhooks: [{ source: "gh" }],
    });

    let menuChoices: any[] = [];
    mockSelect.mockImplementationOnce(async (opts: any) => {
      menuChoices = opts.choices;
      return "done";
    });

    await configAgent("webhook-only-sched", { project: tmpDir });

    const scheduleChoice = menuChoices.find((c: any) => c.value === "schedule");
    expect(scheduleChoice.name).toContain("using webhooks");
  });

  it("preserves source field when updating agent config", async () => {
    const agentDir = resolve(tmpDir, "agents", "source-agent");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(resolve(agentDir, "SKILL.md"), "---\n---\n\n# Test\n");
    writeFileSync(resolve(agentDir, "config.toml"), stringifyTOML({
      models: ["sonnet"],
      source: "https://github.com/example/agent.git",
    }) + "\n");

    mockSelect.mockResolvedValueOnce("done"); // menu: done

    await configAgent("source-agent", { project: tmpDir });

    const toml = parseTOML(readFileSync(resolve(agentDir, "config.toml"), "utf-8")) as any;
    expect(toml.source).toBe("https://github.com/example/agent.git");
  });

  it("shows invalid cron indicator when schedule has wrong field count", async () => {
    // Create agent with a 4-field cron (invalid — needs 5)
    createAgentConfig("invalid-cron-agent", {
      credentials: [],
      models: ["sonnet"],
      schedule: "* * * *",
    });

    let menuChoices: any[] = [];
    mockSelect.mockImplementationOnce(async (opts: any) => {
      menuChoices = opts.choices;
      return "done";
    });

    await configAgent("invalid-cron-agent", { project: tmpDir });

    const scheduleChoice = menuChoices.find((c: any) => c.value === "schedule");
    expect(scheduleChoice.name).toContain("✗");
    expect(scheduleChoice.name).toContain("invalid cron");
  });

  it("removes all params and cleans up empty params object", async () => {
    createAgentConfig("params-rm-all", {
      credentials: [],
      models: ["sonnet"],
      params: { only: "one" },
    });

    mockSelect
      .mockResolvedValueOnce("params")          // menu: params
      .mockResolvedValueOnce("edit:only")       // select param
      .mockResolvedValueOnce("remove")          // choose to remove
      .mockResolvedValueOnce("back")            // params: back
      .mockResolvedValueOnce("done");           // menu: done

    await configAgent("params-rm-all", { project: tmpDir });

    const toml = parseTOML(readFileSync(resolve(tmpDir, "agents", "params-rm-all", "config.toml"), "utf-8")) as any;
    // All params removed → params should be undefined
    expect(toml.params).toBeUndefined();
  });

  it("removes multiple webhook triggers in correct order (reverse index)", async () => {
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({
      models: { sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" } },
      webhooks: { "my-github": { type: "github" } },
    }));
    createAgentConfig("wh-multi-remove", {
      credentials: [],
      models: ["sonnet"],
      webhooks: [
        { source: "my-github", events: ["push"] },
        { source: "my-github", events: ["pull_request"] },
        { source: "my-github", events: ["issues"] },
      ],
    });

    mockSelect
      .mockResolvedValueOnce("webhooks")  // menu: webhooks
      .mockResolvedValueOnce("remove")    // webhooks: remove trigger
      .mockResolvedValueOnce("back")      // webhooks: back
      .mockResolvedValueOnce("done");     // menu: done
    // Remove indices 0 and 2 (first and last) — requires sort comparator to handle multiple
    mockCheckbox.mockResolvedValueOnce([0, 2]);

    await configAgent("wh-multi-remove", { project: tmpDir });

    const toml = parseTOML(readFileSync(resolve(tmpDir, "agents", "wh-multi-remove", "config.toml"), "utf-8")) as any;
    // Only the middle trigger (pull_request) should remain
    expect(toml.webhooks).toHaveLength(1);
    expect(toml.webhooks[0].events).toEqual(["pull_request"]);
  });

  it("safeLoadGlobalConfig returns empty object when global config.toml is invalid TOML", async () => {
    // Overwrite config.toml with invalid TOML to trigger safeLoadGlobalConfig catch
    writeFileSync(resolve(tmpDir, "config.toml"), "this is [not valid] = = toml\n");

    createAgentConfig("safe-cfg-agent", { credentials: [], models: ["sonnet"] });

    let menuChoices: any[] = [];
    mockSelect.mockImplementationOnce(async (opts: any) => {
      menuChoices = opts.choices;
      return "done";
    });

    // Should not throw even with invalid global config
    await configAgent("safe-cfg-agent", { project: tmpDir });

    // The model status should show as invalid since global config is empty (no models defined)
    const modelChoice = menuChoices.find((c: any) => c.value === "model");
    expect(modelChoice).toBeDefined();
  });

  // ── Additional coverage for uncovered paths ──────────────────────────────

  it("edits model — creates new openai model via __create__ path (covers openai else-if branch)", async () => {
    createAgentConfig("openai-create-agent", { credentials: [], models: ["sonnet"] });

    mockSelect
      .mockResolvedValueOnce("model")          // menu: model
      .mockResolvedValueOnce("__create__")     // Select model: create new
      .mockResolvedValueOnce("openai")         // Select LLM provider: openai
      .mockResolvedValueOnce("gpt-4o-mini")    // Select model (openai choices): gpt-4o-mini
      .mockResolvedValueOnce("done");          // menu: done
    mockInput
      .mockResolvedValueOnce("gpt4mini");      // model reference name

    await configAgent("openai-create-agent", { project: tmpDir });

    const projectToml = parseTOML(readFileSync(resolve(tmpDir, "config.toml"), "utf-8")) as any;
    expect(projectToml.models["gpt4mini"]).toBeDefined();
    expect(projectToml.models["gpt4mini"].provider).toBe("openai");
    expect(projectToml.models["gpt4mini"].model).toBe("gpt-4o-mini");
    // openai models do not get a thinkingLevel
    expect(projectToml.models["gpt4mini"].thinkingLevel).toBeUndefined();
  });

  it("editModel uses currentProvider defaultModel branch when config.models already has a provider", async () => {
    // Navigate to model section twice: first pick an existing model (sets config.models),
    // then navigate again so currentProvider is set and defaultModel = modelNames.find(...)
    createAgentConfig("two-model-nav", { credentials: [], models: ["sonnet"] });

    mockSelect
      .mockResolvedValueOnce("model")                     // menu: model (1st visit)
      .mockResolvedValueOnce("sonnet")                    // Select model: pick existing "sonnet"
      .mockResolvedValueOnce("model")                     // menu: model (2nd visit)
      .mockResolvedValueOnce("__create__")               // Select model: create new
      .mockResolvedValueOnce("anthropic")                 // Select LLM provider: anthropic
      .mockResolvedValueOnce("claude-haiku-3-5-20241022") // Select model (anthropic)
      .mockResolvedValueOnce("off")                       // Thinking level: off
      .mockResolvedValueOnce("done");                     // menu: done
    mockInput
      .mockResolvedValueOnce("haiku");                    // model reference name (2nd visit)

    await configAgent("two-model-nav", { project: tmpDir });

    const projectToml = parseTOML(readFileSync(resolve(tmpDir, "config.toml"), "utf-8")) as any;
    expect(projectToml.models["haiku"]).toBeDefined();
    expect(projectToml.models["haiku"].provider).toBe("anthropic");
    expect(projectToml.models["haiku"].model).toBe("claude-haiku-3-5-20241022");
    expect(projectToml.models["haiku"].thinkingLevel).toBe("off");
  });

  it("adds webhook source with github provider — calls pickOrAddCredentialInstance, skip credential", async () => {
    // github provider has credType → pickOrAddCredentialInstance is called
    // User skips credential → sourceConfig.credential NOT set
    createAgentConfig("github-src-skip", { credentials: [], models: ["sonnet"] });
    // config.toml has no webhooks section → "no sources" path

    mockSelect
      .mockResolvedValueOnce("webhooks")    // menu: webhooks
      .mockResolvedValueOnce("github")      // provider type in addWebhookSourceWithName
      .mockResolvedValueOnce("__skip__")    // pickOrAddCredentialInstance: skip
      .mockResolvedValueOnce("done");       // menu: done after returning from editWebhooks
    mockConfirm
      .mockResolvedValueOnce(true);         // "Would you like to add a webhook source now?"
    mockInput
      .mockResolvedValueOnce("my-github");  // source name

    await configAgent("github-src-skip", { project: tmpDir });

    const projectToml = parseTOML(readFileSync(resolve(tmpDir, "config.toml"), "utf-8")) as any;
    expect(projectToml.webhooks?.["my-github"]).toBeDefined();
    expect(projectToml.webhooks?.["my-github"].type).toBe("github");
    // Credential skipped → not stored
    expect(projectToml.webhooks?.["my-github"].credential).toBeUndefined();
  });

  it("pickOrAddCredentialInstance — selects existing instance (covers loop body and return choice)", async () => {
    // listCredentialInstances returns two instances so the for-loop runs
    vi.mocked(listCredentialInstances).mockResolvedValueOnce(["default", "my-project"]);

    createAgentConfig("pick-cred-inst", { credentials: [], models: ["sonnet"] });

    mockSelect
      .mockResolvedValueOnce("webhooks")    // menu: webhooks
      .mockResolvedValueOnce("github")      // provider type
      .mockResolvedValueOnce("my-project")  // pickOrAddCredentialInstance: pick existing "my-project"
      .mockResolvedValueOnce("done");       // menu: done
    mockConfirm
      .mockResolvedValueOnce(true);         // "Would you like to add a webhook source now?"
    mockInput
      .mockResolvedValueOnce("my-github");  // source name

    await configAgent("pick-cred-inst", { project: tmpDir });

    const projectToml = parseTOML(readFileSync(resolve(tmpDir, "config.toml"), "utf-8")) as any;
    expect(projectToml.webhooks?.["my-github"]).toBeDefined();
    // Credential set to the selected existing instance
    expect(projectToml.webhooks?.["my-github"].credential).toBe("my-project");
  });

  it("pickOrAddCredentialInstance — __add__ with existing instances prompts for new instance name", async () => {
    // instances.length > 0 → asks for new instance name via input
    vi.mocked(listCredentialInstances).mockResolvedValueOnce(["default"]);

    createAgentConfig("add-cred-inst", { credentials: [], models: ["sonnet"] });

    mockSelect
      .mockResolvedValueOnce("webhooks")    // menu: webhooks
      .mockResolvedValueOnce("github")      // provider type
      .mockResolvedValueOnce("__add__")     // pickOrAddCredentialInstance: add new
      .mockResolvedValueOnce("done");       // menu: done
    mockConfirm
      .mockResolvedValueOnce(true);         // "Would you like to add a webhook source now?"
    mockInput
      .mockResolvedValueOnce("my-github")   // source name
      .mockResolvedValueOnce("project-b");  // new credential instance name (instances.length > 0)
    // promptCredential returns undefined → no writeCredentialFields call

    await configAgent("add-cred-inst", { project: tmpDir });

    const projectToml = parseTOML(readFileSync(resolve(tmpDir, "config.toml"), "utf-8")) as any;
    expect(projectToml.webhooks?.["my-github"]).toBeDefined();
    // credential set to "project-b" (returned even when promptCredential returns undefined)
    expect(projectToml.webhooks?.["my-github"].credential).toBe("project-b");
  });

  it("pickOrAddCredentialInstance — __add__ with non-empty promptCredential result writes credential fields", async () => {
    vi.mocked(listCredentialInstances).mockResolvedValueOnce([]);
    vi.mocked(promptCredential).mockResolvedValueOnce({ values: { secret: "test-secret" }, skipped: false } as any);

    createAgentConfig("write-cred-inst", { credentials: [], models: ["sonnet"] });

    mockSelect
      .mockResolvedValueOnce("webhooks")    // menu: webhooks
      .mockResolvedValueOnce("github")      // provider type
      .mockResolvedValueOnce("__add__")     // pickOrAddCredentialInstance: add new (empty instances)
      .mockResolvedValueOnce("done");       // menu: done
    mockConfirm
      .mockResolvedValueOnce(true);         // "Would you like to add a webhook source now?"
    mockInput
      .mockResolvedValueOnce("my-github");  // source name

    await configAgent("write-cred-inst", { project: tmpDir });

    // writeCredentialFields should have been called with the credential data
    expect(vi.mocked(writeCredentialFields)).toHaveBeenCalledWith(
      "github_webhook_secret",
      "default",
      { secret: "test-secret" },
    );
  });

  it("editWebhooks — no sources but agent has triggers: rewriteTriggerSources updates trigger source", async () => {
    // Agent has a trigger referencing "old-github" — config.toml has no webhooks section
    // After adding a new source "new-github", the trigger's source gets rewritten
    createAgentConfig("rewrite-a-agent", {
      credentials: [],
      models: ["sonnet"],
      webhooks: [{ source: "old-github", events: ["push"] }],
    });

    mockSelect
      .mockResolvedValueOnce("webhooks")    // menu: webhooks
      .mockResolvedValueOnce("test")        // provider type (no credType for "test")
      .mockResolvedValueOnce("done");       // menu: done
    mockConfirm
      .mockResolvedValueOnce(true);         // "Would you like to add a webhook source now?"
    mockInput
      .mockResolvedValueOnce("new-github"); // source name in addWebhookSourceWithName

    await configAgent("rewrite-a-agent", { project: tmpDir });

    // The trigger source should be rewritten from "old-github" to "new-github"
    const agentToml = parseTOML(readFileSync(resolve(tmpDir, "agents", "rewrite-a-agent", "config.toml"), "utf-8")) as any;
    expect(agentToml.webhooks).toHaveLength(1);
    expect(agentToml.webhooks[0].source).toBe("new-github");
  });

  it("editWebhooks — missing source with existing sources, user accepts, triggers rewritten (L584-587)", async () => {
    // config.toml has a webhooks source "existing-src" but NOT "missing-src"
    // Agent trigger references "missing-src" → missingSources = ["missing-src"]
    writeFileSync(resolve(tmpDir, "config.toml"), stringifyTOML({
      models: { sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" } },
      webhooks: { "existing-src": { type: "test" } },
    }));
    createAgentConfig("rewrite-b-agent", {
      credentials: [],
      models: ["sonnet"],
      webhooks: [{ source: "missing-src", events: ["push"] }],
    });

    mockSelect
      .mockResolvedValueOnce("webhooks")    // menu: webhooks
      .mockResolvedValueOnce("test")        // provider type for new source (no credType)
      .mockResolvedValueOnce("done");       // menu: done
    mockConfirm
      .mockResolvedValueOnce(true);         // "Source 'missing-src' not found. Create a webhook source now?"
    mockInput
      .mockResolvedValueOnce("new-source"); // new source name in addWebhookSourceWithName

    await configAgent("rewrite-b-agent", { project: tmpDir });

    // The trigger source should be rewritten from "missing-src" to "new-source"
    const agentToml = parseTOML(readFileSync(resolve(tmpDir, "agents", "rewrite-b-agent", "config.toml"), "utf-8")) as any;
    expect(agentToml.webhooks).toHaveLength(1);
    expect(agentToml.webhooks[0].source).toBe("new-source");

    // The new source should exist in config.toml
    const projectToml = parseTOML(readFileSync(resolve(tmpDir, "config.toml"), "utf-8")) as any;
    expect(projectToml.webhooks?.["new-source"]).toBeDefined();
    expect(projectToml.webhooks?.["new-source"].type).toBe("test");
  });

  it("webhooks source name validate callback rejects empty and accepts non-empty names", async () => {
    createAgentConfig("wh-validate", { credentials: [], models: ["sonnet"] });

    let capturedValidate: ((v: string) => any) | undefined;
    mockInput.mockImplementationOnce((opts: any) => {
      capturedValidate = opts.validate;
      return Promise.resolve("valid-source");
    });

    mockSelect
      .mockResolvedValueOnce("webhooks")    // menu: webhooks
      .mockResolvedValueOnce("github")      // provider type
      .mockResolvedValueOnce("__skip__")    // skip webhook secret
      .mockResolvedValueOnce("back")        // back
      .mockResolvedValueOnce("done");       // done
    mockConfirm.mockResolvedValueOnce(true); // accept to add source

    await configAgent("wh-validate", { project: tmpDir });

    expect(capturedValidate).toBeTypeOf("function");
    expect(capturedValidate!("my-source")).toBe(true);
    expect(capturedValidate!("  ")).toBe("Name is required");
    expect(capturedValidate!("")).toBe("Name is required");
  });

  it("model name validate callback rejects empty and accepts non-empty names", async () => {
    createAgentConfig("model-validate-agent", { credentials: [], models: ["sonnet"] });

    let capturedModelNameValidate: ((v: string) => any) | undefined;
    mockInput.mockImplementationOnce((opts: any) => {
      capturedModelNameValidate = opts.validate;
      return Promise.resolve("opus");
    });

    mockSelect
      .mockResolvedValueOnce("model")
      .mockResolvedValueOnce("__create__")
      .mockResolvedValueOnce("anthropic")
      .mockResolvedValueOnce("claude-opus-4-20250514")
      .mockResolvedValueOnce("none")
      .mockResolvedValueOnce("done");

    await configAgent("model-validate-agent", { project: tmpDir });

    expect(capturedModelNameValidate).toBeTypeOf("function");
    expect(capturedModelNameValidate!("my-model")).toBe(true);
    expect(capturedModelNameValidate!("  ")).toBe("Name is required");
    expect(capturedModelNameValidate!("")).toBe("Name is required");
  });

  it("editWebhooks — gracefully handles invalid config.toml (catch branch: globalConfig = {})", async () => {
    // Create an agent with no webhook triggers
    createAgentConfig("invalid-cfg-agent", {
      credentials: [],
      models: ["sonnet"],
    });

    // Overwrite project config.toml with invalid TOML to make loadGlobalConfig throw
    // safeLoadGlobalConfig (used in the main while loop) catches this and returns {}
    // editWebhooks calls loadGlobalConfig directly → throws → catch → globalConfig = {}
    writeFileSync(resolve(tmpDir, "config.toml"), "this is not valid TOML {{{{");

    // The agent menu shows, we navigate to webhooks
    // Since config.toml is invalid, loadGlobalConfig throws → globalConfig = {}
    // Then sources = undefined → "No webhook sources configured" → confirm(false) → return
    mockSelect
      .mockResolvedValueOnce("webhooks")   // main menu: webhooks
      .mockResolvedValueOnce("done");      // main menu: done (after editWebhooks returns)
    mockConfirm
      .mockResolvedValueOnce(false);       // "Would you like to add a webhook source now?" → No

    await configAgent("invalid-cfg-agent", { project: tmpDir });

    // If we got here without throwing, the catch branch was successfully exercised
    expect(mockSelect).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("Configure") }));
  });
});
