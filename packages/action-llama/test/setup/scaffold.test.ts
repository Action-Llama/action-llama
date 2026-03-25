import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, lstatSync, readlinkSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { parse as parseTOML } from "smol-toml";
import { parseFrontmatter } from "../../src/shared/frontmatter.js";
import { scaffoldProject, scaffoldClaudeCommands, CLAUDE_COMMANDS } from "../../src/setup/scaffold.js";
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
      // name is included in the portable frontmatter
      expect(data.name).toBe(name);
      // Runtime fields should NOT be in SKILL.md (they live in config.toml)
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
      // Runtime fields should be in config.toml
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

  it("does not use latest as dependency version", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-scaffold-"));
    const projDir = resolve(tmpDir, "my-project");
    scaffoldProject(projDir, makeGlobalConfig(), makeAgents());

    const pkg = JSON.parse(readFileSync(resolve(projDir, "package.json"), "utf-8"));
    expect(pkg.dependencies["@action-llama/action-llama"]).not.toBe("latest");
  });

  it("creates AGENTS.md as a symlink to agent-docs/AGENTS.md", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-scaffold-"));
    const projDir = resolve(tmpDir, "my-project");
    scaffoldProject(projDir, makeGlobalConfig(), makeAgents());

    const agentsMdPath = resolve(projDir, "AGENTS.md");
    expect(existsSync(agentsMdPath)).toBe(true);
    expect(lstatSync(agentsMdPath).isSymbolicLink()).toBe(true);
    const target = readlinkSync(agentsMdPath);
    expect(target).toContain("agent-docs/AGENTS.md");
    const content = readFileSync(agentsMdPath, "utf-8");
    expect(content).toContain("Action Llama Reference");
  });

  it("creates CLAUDE.md as a symlink to agent-docs/AGENTS.md", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-scaffold-"));
    const projDir = resolve(tmpDir, "my-project");
    scaffoldProject(projDir, makeGlobalConfig(), makeAgents());

    const claudeMdPath = resolve(projDir, "CLAUDE.md");
    expect(existsSync(claudeMdPath)).toBe(true);
    expect(lstatSync(claudeMdPath).isSymbolicLink()).toBe(true);
    const target = readlinkSync(claudeMdPath);
    expect(target).toContain("agent-docs/AGENTS.md");
    const content = readFileSync(claudeMdPath, "utf-8");
    expect(content).toContain("Action Llama Reference");
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

    const envTomlPath = resolve(projDir, ".env.toml");
    expect(existsSync(envTomlPath)).toBe(false);
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

  it("creates .claude/commands/ with all 5 command files", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-scaffold-"));
    const projDir = resolve(tmpDir, "my-project");
    scaffoldProject(projDir, makeGlobalConfig(), makeAgents());

    const commandNames = ["new-agent", "run", "debug", "iterate", "status"];
    for (const name of commandNames) {
      const filePath = resolve(projDir, ".claude", "commands", `${name}.md`);
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, "utf-8");
      expect(content.length).toBeGreaterThan(0);
    }
  });

  it("new-agent.md contains $ARGUMENTS placeholder", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-scaffold-"));
    const projDir = resolve(tmpDir, "my-project");
    scaffoldProject(projDir, makeGlobalConfig(), makeAgents());

    const content = readFileSync(resolve(projDir, ".claude", "commands", "new-agent.md"), "utf-8");
    expect(content).toContain("$ARGUMENTS");
  });

  it("command files reference correct MCP tools", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-scaffold-"));
    const projDir = resolve(tmpDir, "my-project");
    scaffoldProject(projDir, makeGlobalConfig(), makeAgents());

    const runContent = readFileSync(resolve(projDir, ".claude", "commands", "run.md"), "utf-8");
    expect(runContent).toContain("al_run");
    expect(runContent).toContain("al_start");
    expect(runContent).toContain("al_logs");

    const debugContent = readFileSync(resolve(projDir, ".claude", "commands", "debug.md"), "utf-8");
    expect(debugContent).toContain("al_logs");
    expect(debugContent).toContain("al_agents");

    const statusContent = readFileSync(resolve(projDir, ".claude", "commands", "status.md"), "utf-8");
    expect(statusContent).toContain("al_status");
    expect(statusContent).toContain("al_agents");
  });

  it("does not overwrite existing command files", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-scaffold-"));
    const projDir = resolve(tmpDir, "my-project");
    const commandsDir = resolve(projDir, ".claude", "commands");
    mkdirSync(commandsDir, { recursive: true });
    writeFileSync(resolve(commandsDir, "run.md"), "# My custom run command\n");

    scaffoldProject(projDir, makeGlobalConfig(), makeAgents());

    const content = readFileSync(resolve(commandsDir, "run.md"), "utf-8");
    expect(content).toBe("# My custom run command\n");
  });

  it("scaffoldClaudeCommands works standalone", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-scaffold-"));
    scaffoldClaudeCommands(tmpDir);

    for (const name of Object.keys(CLAUDE_COMMANDS)) {
      const filePath = resolve(tmpDir, ".claude", "commands", `${name}.md`);
      expect(existsSync(filePath)).toBe(true);
      expect(readFileSync(filePath, "utf-8")).toBe(CLAUDE_COMMANDS[name]);
    }
  });

});
