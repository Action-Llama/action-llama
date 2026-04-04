import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { parse as parseTOML } from "smol-toml";
import { parseFrontmatter } from "../../src/shared/frontmatter.js";
import { scaffoldProject, resolvePackageRoot } from "../../src/setup/scaffold.js";
import type { ScaffoldAgent } from "../../src/setup/scaffold.js";
import type { GlobalConfig } from "../../src/shared/config.js";
import { VERSION } from "../../src/shared/constants.js";

describe("scaffoldProject", () => {
  let tmpDir: string;

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const defaultModel = {
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    thinkingLevel: "medium" as const,
    authType: "api_key" as const,
  };

  function makeGlobalConfig(): GlobalConfig {
    return {};
  }

  function makeAgents(): ScaffoldAgent[] {
    return [
      {
        name: "dev",
        config: {
          name: "dev",
          credentials: ["github_token"],
          models: [defaultModel],
          schedule: "*/5 * * * *",
          params: { repos: ["acme/app"], triggerLabel: "agent", assignee: "bot" },
        },
      },
      {
        name: "reviewer",
        config: {
          name: "reviewer",
          credentials: ["github_token"],
          models: [defaultModel],
          schedule: "*/5 * * * *",
          params: { repos: ["acme/app"] },
        },
      },
      {
        name: "devops",
        config: {
          name: "devops",
          credentials: ["github_token"],
          models: [defaultModel],
          schedule: "*/15 * * * *",
          params: { repos: ["acme/app"] },
        },
      },
    ];
  }

  it("skips global config.toml when empty", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-scaffold-"));
    const projDir = resolve(tmpDir, "my-project");
    scaffoldProject(projDir, makeGlobalConfig(), makeAgents());

    expect(existsSync(resolve(projDir, "config.toml"))).toBe(false);
    expect(existsSync(resolve(projDir, "config.json"))).toBe(false);
  });

  it("creates global config.toml when non-empty", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-scaffold-"));
    const projDir = resolve(tmpDir, "my-project");
    scaffoldProject(projDir, { docker: { enabled: true } }, makeAgents());

    const configPath = resolve(projDir, "config.toml");
    expect(existsSync(configPath)).toBe(true);
    const config = parseTOML(readFileSync(configPath, "utf-8"));
    expect((config.docker as any).enabled).toBe(true);
  });

  it("creates per-agent SKILL.md with portable frontmatter only (no runtime metadata)", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-scaffold-"));
    const projDir = resolve(tmpDir, "my-project");
    scaffoldProject(projDir, makeGlobalConfig(), makeAgents());

    for (const name of ["dev", "reviewer", "devops"]) {
      const skillPath = resolve(projDir, "agents", name, "SKILL.md");
      expect(existsSync(skillPath)).toBe(true);
      const content = readFileSync(skillPath, "utf-8");
      const { data } = parseFrontmatter(content);
      expect(data.name).toBe(name);
      expect(data.metadata).toBeUndefined();
      expect((data as any).credentials).toBeUndefined();
      expect((data as any).models).toBeUndefined();
      expect((data as any).schedule).toBeUndefined();
      expect((data as any).params).toBeUndefined();
      expect(content.length).toBeGreaterThan(0);
    }
  });

  it("creates per-agent config.toml with runtime fields", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-scaffold-"));
    const projDir = resolve(tmpDir, "my-project");
    scaffoldProject(projDir, makeGlobalConfig(), makeAgents());

    for (const name of ["dev", "reviewer", "devops"]) {
      const configPath = resolve(projDir, "agents", name, "config.toml");
      expect(existsSync(configPath)).toBe(true);
      const content = readFileSync(configPath, "utf-8");
      const config = parseTOML(content);
      expect(config.credentials).toBeDefined();
      expect(config.schedule).toBeDefined();
    }
  });

  it("creates agent directories", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-scaffold-"));
    const projDir = resolve(tmpDir, "my-project");
    scaffoldProject(projDir, makeGlobalConfig(), makeAgents());

    for (const agent of ["dev", "reviewer", "devops"]) {
      expect(existsSync(resolve(projDir, "agents", agent))).toBe(true);
    }
  });

  it("creates package.json with correct version and structure", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-scaffold-"));
    const projDir = resolve(tmpDir, "my-project");
    scaffoldProject(projDir, makeGlobalConfig(), makeAgents(), "my-project");

    const pkgPath = resolve(projDir, "package.json");
    expect(existsSync(pkgPath)).toBe(true);
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    expect(pkg.name).toBe("my-project");
    expect(pkg.private).toBe(true);
    expect(pkg.type).toBe("module");
    expect(pkg.version).toBeDefined();
    expect(pkg.dependencies["@action-llama/action-llama"]).toBe(VERSION);
  });

  it("does not include @action-llama/skill as a dependency", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-scaffold-"));
    const projDir = resolve(tmpDir, "my-project");
    scaffoldProject(projDir, makeGlobalConfig(), makeAgents());

    const pkg = JSON.parse(readFileSync(resolve(projDir, "package.json"), "utf-8"));
    expect(pkg.dependencies["@action-llama/skill"]).toBeUndefined();
  });

  it("does not use latest as dependency version", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-scaffold-"));
    const projDir = resolve(tmpDir, "my-project");
    scaffoldProject(projDir, makeGlobalConfig(), makeAgents());

    const pkg = JSON.parse(readFileSync(resolve(projDir, "package.json"), "utf-8"));
    expect(pkg.dependencies["@action-llama/action-llama"]).not.toBe("latest");
  });

  it("does not create skills/ directory in project", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-scaffold-"));
    const projDir = resolve(tmpDir, "my-project");
    scaffoldProject(projDir, makeGlobalConfig(), makeAgents());

    expect(existsSync(resolve(projDir, "skills"))).toBe(false);
  });

  it("creates .env.toml with projectName when projectName is provided", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-scaffold-"));
    const projDir = resolve(tmpDir, "my-project");
    scaffoldProject(projDir, makeGlobalConfig(), makeAgents(), "my-project");

    const envTomlPath = resolve(projDir, ".env.toml");
    expect(existsSync(envTomlPath)).toBe(true);
    const content = readFileSync(envTomlPath, "utf-8");
    const parsed = parseTOML(content);
    expect(parsed.projectName).toBe("my-project");
  });

  it("does not create .env.toml when projectName is not provided", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-scaffold-"));
    const projDir = resolve(tmpDir, "my-project");
    scaffoldProject(projDir, makeGlobalConfig(), makeAgents());

    expect(existsSync(resolve(projDir, ".env.toml"))).toBe(false);
  });

  it("creates .workspace directory and .gitignore", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-scaffold-"));
    const projDir = resolve(tmpDir, "my-project");
    scaffoldProject(projDir, makeGlobalConfig(), makeAgents());

    expect(existsSync(resolve(projDir, ".workspace"))).toBe(true);
    expect(existsSync(resolve(projDir, ".gitignore"))).toBe(true);
    const gitignore = readFileSync(resolve(projDir, ".gitignore"), "utf-8");
    expect(gitignore).toContain(".workspace/");
  });

  it("does not create a project Dockerfile", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-scaffold-"));
    const projDir = resolve(tmpDir, "my-project");
    scaffoldProject(projDir, makeGlobalConfig(), makeAgents());

    expect(existsSync(resolve(projDir, "Dockerfile"))).toBe(false);
  });

  it("does not create AGENTS.md, CLAUDE.md, .mcp.json, or .claude/commands", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-scaffold-"));
    const projDir = resolve(tmpDir, "my-project");
    scaffoldProject(projDir, makeGlobalConfig(), makeAgents());

    expect(existsSync(resolve(projDir, "AGENTS.md"))).toBe(false);
    expect(existsSync(resolve(projDir, "CLAUDE.md"))).toBe(false);
    expect(existsSync(resolve(projDir, ".mcp.json"))).toBe(false);
    expect(existsSync(resolve(projDir, ".claude", "commands"))).toBe(false);
  });

  it("includes description, license, and compatibility in SKILL.md frontmatter when set", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-scaffold-"));
    const projDir = resolve(tmpDir, "my-project");

    const defaultModel = { provider: "anthropic" as const, model: "claude-sonnet-4-20250514", authType: "api_key" as const };
    const agentsWithMeta: ScaffoldAgent[] = [
      {
        name: "my-agent",
        config: {
          name: "my-agent",
          credentials: [],
          models: [defaultModel],
          description: "My custom agent description",
          license: "MIT",
          compatibility: "claude-3",
        } as any,
      },
    ];

    scaffoldProject(projDir, makeGlobalConfig(), agentsWithMeta);

    const skillPath = resolve(projDir, "agents", "my-agent", "SKILL.md");
    expect(existsSync(skillPath)).toBe(true);

    const content = readFileSync(skillPath, "utf-8");
    expect(content).toContain("description: My custom agent description");
    expect(content).toContain("license: MIT");
    expect(content).toContain("compatibility: claude-3");
  });

  it("does not overwrite existing SKILL.md when scaffoldAgent is called again", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-scaffold-"));
    const projDir = resolve(tmpDir, "my-project");
    mkdirSync(resolve(projDir, "agents", "dev"), { recursive: true });
    const skillPath = resolve(projDir, "agents", "dev", "SKILL.md");
    const originalContent = "# Original SKILL.md Content\n";
    writeFileSync(skillPath, originalContent);

    scaffoldProject(projDir, makeGlobalConfig(), makeAgents());

    const content = readFileSync(skillPath, "utf-8");
    expect(content).toBe(originalContent);
  });

  it("does not overwrite existing config.toml when scaffoldAgent is called again", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-scaffold-"));
    const projDir = resolve(tmpDir, "my-project");
    mkdirSync(resolve(projDir, "agents", "dev"), { recursive: true });
    const configPath = resolve(projDir, "agents", "dev", "config.toml");
    const originalContent = "schedule = \"*/30 * * * *\"\n";
    writeFileSync(configPath, originalContent);

    scaffoldProject(projDir, makeGlobalConfig(), makeAgents());

    const content = readFileSync(configPath, "utf-8");
    expect(content).toBe(originalContent);
  });

  it("does not overwrite existing package.json when scaffoldProject is called again", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-scaffold-"));
    const projDir = resolve(tmpDir, "my-project");
    mkdirSync(projDir, { recursive: true });
    const pkgPath = resolve(projDir, "package.json");
    const originalPkg = { name: "existing-project", version: "2.0.0", private: true };
    writeFileSync(pkgPath, JSON.stringify(originalPkg, null, 2) + "\n");

    scaffoldProject(projDir, makeGlobalConfig(), []);

    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    expect(pkg.name).toBe("existing-project");
    expect(pkg.version).toBe("2.0.0");
  });

  it("does not overwrite existing .gitignore when scaffoldProject is called again", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-scaffold-"));
    const projDir = resolve(tmpDir, "my-project");
    scaffoldProject(projDir, makeGlobalConfig(), [], "first-project");

    const gitignorePath = resolve(projDir, ".gitignore");
    const customContent = "# my custom gitignore\ndist/\n";
    writeFileSync(gitignorePath, customContent);

    scaffoldProject(projDir, makeGlobalConfig(), []);

    const content = readFileSync(gitignorePath, "utf-8");
    expect(content).toBe(customContent);
  });

  it("does not overwrite existing .env.toml when scaffoldProject is called again with projectName", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-scaffold-"));
    const projDir = resolve(tmpDir, "my-project");
    mkdirSync(projDir, { recursive: true });
    const envTomlPath = resolve(projDir, ".env.toml");
    const originalContent = `projectName = "original-name"\n`;
    writeFileSync(envTomlPath, originalContent);

    scaffoldProject(projDir, makeGlobalConfig(), [], "new-name");

    const content = readFileSync(envTomlPath, "utf-8");
    expect(content).toBe(originalContent);
  });

  it("creates agent config.toml with empty content when no runtime fields are set", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-scaffold-"));
    const projDir = resolve(tmpDir, "my-project");
    // Use an agent config that has no runtime fields beyond the stripped ones (name, models, description, license, compatibility)
    // credentials is a runtime field so we still get a line; we just verify no crash occurs
    // and the file contains only the expected runtime values
    const agentWithUndefinedOptionals: ScaffoldAgent[] = [
      {
        name: "minimal",
        config: {
          name: "minimal",
          credentials: [],
          models: [],
          // schedule, webhooks, hooks, params, scale, timeout all omitted (undefined)
        },
      },
    ];
    scaffoldProject(projDir, makeGlobalConfig(), agentWithUndefinedOptionals);

    const configPath = resolve(projDir, "agents", "minimal", "config.toml");
    expect(existsSync(configPath)).toBe(true);
    const content = readFileSync(configPath, "utf-8");
    // Only credentials (empty array) should appear — no schedule, params, etc.
    expect(content).not.toContain("schedule");
    expect(content).not.toContain("params");
    expect(content).not.toContain("scale");
  });
});

describe("resolvePackageRoot", () => {
  it("returns a non-empty string path", () => {
    const root = resolvePackageRoot();
    expect(typeof root).toBe("string");
    expect(root.length).toBeGreaterThan(0);
  });

  it("returns the packages/action-llama root directory (contains package.json)", () => {
    const root = resolvePackageRoot();
    // The resolved path should be the package root where package.json lives
    expect(existsSync(resolve(root, "package.json"))).toBe(true);
  });
});
