import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, lstatSync, readlinkSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { parse as parseTOML } from "smol-toml";
import { parseFrontmatter } from "../../src/shared/frontmatter.js";
import { scaffoldProject, scaffoldClaudeCommands, CLAUDE_COMMANDS } from "../../src/setup/scaffold.js";
import type { ScaffoldAgent } from "../../src/setup/scaffold.js";
import type { GlobalConfig } from "../../src/shared/config.js";

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

  it("creates per-agent SKILL.md with frontmatter (no name field)", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-scaffold-"));
    const projDir = resolve(tmpDir, "my-project");
    scaffoldProject(projDir, makeGlobalConfig(), makeAgents());

    for (const name of ["dev", "reviewer", "devops"]) {
      const skillPath = resolve(projDir, "agents", name, "SKILL.md");
      expect(existsSync(skillPath)).toBe(true);
      const content = readFileSync(skillPath, "utf-8");
      const { data } = parseFrontmatter(content);
      // name should NOT be in the frontmatter (injected at load time from directory)
      expect(data.name).toBeUndefined();
      expect(content.length).toBeGreaterThan(0);
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

  it("creates project Dockerfile at project root", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-scaffold-"));
    const projDir = resolve(tmpDir, "my-project");
    scaffoldProject(projDir, makeGlobalConfig(), makeAgents());

    const dockerfilePath = resolve(projDir, "Dockerfile");
    expect(existsSync(dockerfilePath)).toBe(true);
    const content = readFileSync(dockerfilePath, "utf-8");
    expect(content).toMatch(/FROM al-agent:\S+/);
    expect(content).toContain("Project base image");
  });

  it("does not overwrite existing project Dockerfile", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-scaffold-"));
    const projDir = resolve(tmpDir, "my-project");
    mkdirSync(projDir, { recursive: true });
    writeFileSync(resolve(projDir, "Dockerfile"), "FROM custom:image\nRUN echo hi\n");

    scaffoldProject(projDir, makeGlobalConfig(), makeAgents());

    const content = readFileSync(resolve(projDir, "Dockerfile"), "utf-8");
    expect(content).toContain("FROM custom:image");
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
