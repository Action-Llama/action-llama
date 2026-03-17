import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { parse as parseTOML } from "smol-toml";

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
  return {
    ...orig,
    resolvePackageRoot: () => mockPackageRoot,
  };
});

// Mock doctor to avoid real execution
const mockDoctorExecute = vi.fn().mockResolvedValue(undefined);
vi.mock("../../../src/cli/commands/doctor.js", () => ({
  execute: (...args: any[]) => mockDoctorExecute(...args),
}));

// Mock credential registry
vi.mock("../../../src/credentials/registry.js", () => ({
  listBuiltinCredentialIds: () => ["github_token", "anthropic_key", "git_ssh"],
  getBuiltinCredential: (id: string) => {
    const defs: Record<string, any> = {
      github_token: { id: "github_token", label: "GitHub Token", description: "PAT", fields: [{ name: "token", label: "Token", description: "PAT", secret: true }] },
      anthropic_key: { id: "anthropic_key", label: "Anthropic Key", description: "API key", fields: [{ name: "token", label: "Key", description: "Key", secret: true }] },
      git_ssh: { id: "git_ssh", label: "Git SSH", description: "SSH key", fields: [{ name: "id_rsa", label: "Key", description: "Key", secret: true }] },
    };
    return defs[id];
  },
  resolveCredential: (id: string) => {
    if (id === "github_token" || id === "anthropic_key" || id === "git_ssh") return {};
    throw new Error(`Unknown credential "${id}".`);
  },
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
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    rmSync(tmpDir, { recursive: true, force: true });
    rmSync(mockPackageRoot, { recursive: true, force: true });
  });

  it("creates agent from example template (dev)", async () => {
    // Set up example template
    const exampleDir = resolve(mockPackageRoot, "docs", "examples", "dev");
    mkdirSync(exampleDir, { recursive: true });
    writeFileSync(resolve(exampleDir, "ACTIONS.md"), "# Dev Agent\n");
    writeFileSync(resolve(exampleDir, "agent-config.toml"), 'credentials = ["github_token"]\n');

    // Mock: select type=dev, input name=my-dev, then "done" in config menu
    mockSelect
      .mockResolvedValueOnce("dev")      // agent type
      .mockResolvedValueOnce("done");    // config menu: done
    mockInput.mockResolvedValueOnce("my-dev"); // agent name

    await newAgent({ project: tmpDir });

    const agentDir = resolve(tmpDir, "agents", "my-dev");
    expect(existsSync(resolve(agentDir, "ACTIONS.md"))).toBe(true);
    expect(readFileSync(resolve(agentDir, "ACTIONS.md"), "utf-8")).toBe("# Dev Agent\n");
    expect(existsSync(resolve(agentDir, "agent-config.toml"))).toBe(true);
    expect(readFileSync(resolve(agentDir, "agent-config.toml"), "utf-8")).toContain("github_token");
  });

  it("creates custom agent with scaffoldAgent", async () => {
    mockSelect
      .mockResolvedValueOnce("custom")   // agent type
      .mockResolvedValueOnce("done");    // config menu: done
    mockInput.mockResolvedValueOnce("my-custom"); // agent name

    await newAgent({ project: tmpDir });

    const agentDir = resolve(tmpDir, "agents", "my-custom");
    expect(existsSync(resolve(agentDir, "ACTIONS.md"))).toBe(true);
    expect(existsSync(resolve(agentDir, "agent-config.toml"))).toBe(true);
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
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function createAgentConfig(name: string, config: string) {
    const agentDir = resolve(tmpDir, "agents", name);
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(resolve(agentDir, "agent-config.toml"), config);
    writeFileSync(resolve(agentDir, "ACTIONS.md"), "# Test\n");
  }

  it("throws when agent does not exist", async () => {
    await expect(configAgent("nonexistent", { project: tmpDir }))
      .rejects.toThrow("not found");
  });

  it("edits credentials and saves config", async () => {
    createAgentConfig("test-agent", 'credentials = ["github_token"]\n\n[model]\nprovider = "anthropic"\nmodel = "claude-sonnet-4-20250514"\nauthType = "api_key"\n');

    mockSelect
      .mockResolvedValueOnce("credentials") // menu: credentials
      .mockResolvedValueOnce("done");       // menu: done
    mockCheckbox.mockResolvedValueOnce(["github_token", "anthropic_key"]);

    await configAgent("test-agent", { project: tmpDir });

    const written = readFileSync(resolve(tmpDir, "agents", "test-agent", "agent-config.toml"), "utf-8");
    const parsed = parseTOML(written) as any;
    expect(parsed.credentials).toEqual(["github_token", "anthropic_key"]);
    expect(mockDoctorExecute).toHaveBeenCalledWith({ project: tmpDir });
  });

  it("edits schedule", async () => {
    createAgentConfig("sched-agent", 'credentials = []\n\n[model]\nprovider = "anthropic"\nmodel = "claude-sonnet-4-20250514"\nauthType = "api_key"\n');

    mockSelect
      .mockResolvedValueOnce("schedule")
      .mockResolvedValueOnce("done");
    mockInput.mockResolvedValueOnce("*/10 * * * *");

    await configAgent("sched-agent", { project: tmpDir });

    const written = readFileSync(resolve(tmpDir, "agents", "sched-agent", "agent-config.toml"), "utf-8");
    const parsed = parseTOML(written) as any;
    expect(parsed.schedule).toBe("*/10 * * * *");
  });

  it("edits model to openai", async () => {
    createAgentConfig("model-agent", 'credentials = []\n\n[model]\nprovider = "anthropic"\nmodel = "claude-sonnet-4-20250514"\nauthType = "api_key"\n');

    mockSelect
      .mockResolvedValueOnce("model")      // menu: model
      .mockResolvedValueOnce("openai")     // provider
      .mockResolvedValueOnce("gpt-4o")     // model name
      .mockResolvedValueOnce("done");      // menu: done

    await configAgent("model-agent", { project: tmpDir });

    const written = readFileSync(resolve(tmpDir, "agents", "model-agent", "agent-config.toml"), "utf-8");
    const parsed = parseTOML(written) as any;
    expect(parsed.model.provider).toBe("openai");
    expect(parsed.model.model).toBe("gpt-4o");
  });

  it("edits params — add and save", async () => {
    createAgentConfig("params-agent", 'credentials = []\n\n[model]\nprovider = "anthropic"\nmodel = "claude-sonnet-4-20250514"\nauthType = "api_key"\n');

    mockSelect
      .mockResolvedValueOnce("params")    // menu: params
      .mockResolvedValueOnce("add")       // params: add
      .mockResolvedValueOnce("back")      // params: back
      .mockResolvedValueOnce("done");     // menu: done
    mockInput
      .mockResolvedValueOnce("myKey")     // param key
      .mockResolvedValueOnce("myValue");  // param value

    await configAgent("params-agent", { project: tmpDir });

    const written = readFileSync(resolve(tmpDir, "agents", "params-agent", "agent-config.toml"), "utf-8");
    const parsed = parseTOML(written) as any;
    expect(parsed.params.myKey).toBe("myValue");
  });

  it("webhooks shows message when no sources configured", async () => {
    createAgentConfig("wh-agent", 'credentials = []\n\n[model]\nprovider = "anthropic"\nmodel = "claude-sonnet-4-20250514"\nauthType = "api_key"\n');

    mockSelect
      .mockResolvedValueOnce("webhooks")  // menu: webhooks
      .mockResolvedValueOnce("done");     // menu: done

    await configAgent("wh-agent", { project: tmpDir });

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("No webhook sources");
  });
});
