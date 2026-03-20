import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { stringify as stringifyYAML } from "yaml";
import { stringify as stringifyTOML } from "smol-toml";
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
  const { existsSync: exists, readFileSync: readFile, writeFileSync: writeFile } = await import("fs");
  const { resolve: resolvePath } = await import("path");
  return {
    ...orig,
    resolvePackageRoot: () => mockPackageRoot,
    // Wrap scaffoldAgent to inject models reference (scaffoldAgent strips models,
    // but loadAgentConfig requires them; in production `al new` writes them separately).
    scaffoldAgent: (projectPath: string, agent: any) => {
      orig.scaffoldAgent(projectPath, agent);
      const skillPath = resolvePath(projectPath, "agents", agent.name, "SKILL.md");
      if (exists(skillPath)) {
        const content = readFile(skillPath, "utf-8");
        if (!content.includes("models:")) {
          const updated = content.replace("---\n", "---\nmodels:\n  - sonnet\n");
          writeFile(skillPath, updated);
        }
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
    // Set up example template with SKILL.md
    const exampleDir = resolve(mockPackageRoot, "docs", "examples", "dev");
    mkdirSync(exampleDir, { recursive: true });
    writeFileSync(resolve(exampleDir, "SKILL.md"), '---\ncredentials:\n  - github_token\nmodels:\n  - sonnet\n---\n\n# Dev Agent\n');

    // Mock: select type=dev, input name=my-dev, then "done" in config menu
    mockSelect
      .mockResolvedValueOnce("dev")      // agent type
      .mockResolvedValueOnce("done");    // config menu: done
    mockInput.mockResolvedValueOnce("my-dev"); // agent name

    await newAgent({ project: tmpDir });

    const agentDir = resolve(tmpDir, "agents", "my-dev");
    expect(existsSync(resolve(agentDir, "SKILL.md"))).toBe(true);
    expect(readFileSync(resolve(agentDir, "SKILL.md"), "utf-8")).toContain("github_token");
    expect(readFileSync(resolve(agentDir, "SKILL.md"), "utf-8")).toContain("# Dev Agent");
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
    const yamlStr = stringifyYAML(config).trimEnd();
    writeFileSync(resolve(agentDir, "SKILL.md"), `---\n${yamlStr}\n---\n\n# Test\n`);
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

    const written = readFileSync(resolve(tmpDir, "agents", "test-agent", "SKILL.md"), "utf-8");
    const { data } = parseFrontmatter(written);
    expect(data.credentials).toEqual(["github_token", "anthropic_key"]);
    expect(mockDoctorExecute).toHaveBeenCalledWith({ project: tmpDir });
  });

  it("edits schedule", async () => {
    createAgentConfig("sched-agent", { credentials: [], models: ["sonnet"] });

    mockSelect
      .mockResolvedValueOnce("schedule")
      .mockResolvedValueOnce("done");
    mockInput.mockResolvedValueOnce("*/10 * * * *");

    await configAgent("sched-agent", { project: tmpDir });

    const written = readFileSync(resolve(tmpDir, "agents", "sched-agent", "SKILL.md"), "utf-8");
    const { data } = parseFrontmatter(written);
    expect(data.schedule).toBe("*/10 * * * *");
  });

  it("edits model to openai", async () => {
    createAgentConfig("model-agent", { credentials: [], models: ["sonnet"] });

    mockSelect
      .mockResolvedValueOnce("model")      // menu: model
      .mockResolvedValueOnce("openai")     // provider
      .mockResolvedValueOnce("gpt-4o")     // model name
      .mockResolvedValueOnce("done");      // menu: done

    await configAgent("model-agent", { project: tmpDir });

    const written = readFileSync(resolve(tmpDir, "agents", "model-agent", "SKILL.md"), "utf-8");
    const { data } = parseFrontmatter(written);
    expect((data.models as any)[0].provider).toBe("openai");
    expect((data.models as any)[0].model).toBe("gpt-4o");
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

    const written = readFileSync(resolve(tmpDir, "agents", "params-agent", "SKILL.md"), "utf-8");
    const { data } = parseFrontmatter(written);
    expect((data.params as any).myKey).toBe("myValue");
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

    const written = readFileSync(resolve(tmpDir, "agents", "params-edit", "SKILL.md"), "utf-8");
    const { data } = parseFrontmatter(written);
    expect((data.params as any).existing).toBe("new-value");
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

    const written = readFileSync(resolve(tmpDir, "agents", "params-rm", "SKILL.md"), "utf-8");
    const { data } = parseFrontmatter(written);
    expect((data.params as any).removeme).toBeUndefined();
    expect((data.params as any).keepme).toBe("stay");
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

    // No config.toml exists yet — no webhook sources
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

    // config.toml should have been created with the webhook source
    const configToml = readFileSync(resolve(tmpDir, "config.toml"), "utf-8");
    expect(configToml).toContain("my-github");
    expect(configToml).toContain("github");
  });
});
