import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import { stringify as stringifyTOML } from "smol-toml";

// Mock confirm before importing execute
vi.mock("@inquirer/prompts", () => ({
  confirm: vi.fn().mockResolvedValue(true),
  select: vi.fn(),
  input: vi.fn(),
  checkbox: vi.fn(),
}));

import { confirm } from "@inquirer/prompts";

describe("al update", () => {
  let tmpDir: string;
  let projectPath: string;
  let repoPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-update-test-"));
    projectPath = join(tmpDir, "project");
    repoPath = join(tmpDir, "repo");
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function createProject(agents: Record<string, { skillMd: string; configToml: Record<string, unknown> }>) {
    mkdirSync(resolve(projectPath, "agents"), { recursive: true });
    writeFileSync(resolve(projectPath, "config.toml"), "");

    for (const [name, agent] of Object.entries(agents)) {
      const agentDir = resolve(projectPath, "agents", name);
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(resolve(agentDir, "SKILL.md"), agent.skillMd);
      writeFileSync(resolve(agentDir, "config.toml"), stringifyTOML(agent.configToml as any) + "\n");
    }
  }

  function createGitRepo(path: string, files: Record<string, string>) {
    mkdirSync(path, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      const filePath = resolve(path, name);
      mkdirSync(resolve(filePath, ".."), { recursive: true });
      writeFileSync(filePath, content);
    }
    execFileSync("git", ["init"], { cwd: path, stdio: "pipe" });
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: path, stdio: "pipe" });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: path, stdio: "pipe" });
    execFileSync("git", ["add", "."], { cwd: path, stdio: "pipe" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: path, stdio: "pipe" });
  }

  it("reports up-to-date when SKILL.md matches upstream", async () => {
    const skillContent = "---\nname: my-skill\n---\n\n# My Skill\n";

    createGitRepo(repoPath, { "SKILL.md": skillContent });
    createProject({
      "my-skill": {
        skillMd: skillContent,
        configToml: { source: repoPath, credentials: ["github_token"] },
      },
    });

    const { execute } = await import("../../../src/cli/commands/update.js");
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.map(String).join(" "));
    try {
      await execute("my-skill", { project: projectPath });
    } finally {
      console.log = origLog;
    }

    expect(logs.some(l => l.includes("up to date"))).toBe(true);
  });

  it("updates SKILL.md when upstream has changed", async () => {
    const oldContent = "---\nname: my-skill\n---\n\n# My Skill v1\n";
    const newContent = "---\nname: my-skill\n---\n\n# My Skill v2\n\nNew section.\n";

    createGitRepo(repoPath, { "SKILL.md": newContent });
    createProject({
      "my-skill": {
        skillMd: oldContent,
        configToml: { source: repoPath },
      },
    });

    vi.mocked(confirm).mockResolvedValue(true);

    const { execute } = await import("../../../src/cli/commands/update.js");
    await execute("my-skill", { project: projectPath });

    const updated = readFileSync(resolve(projectPath, "agents", "my-skill", "SKILL.md"), "utf-8");
    expect(updated).toBe(newContent);
  });

  it("skips update when user declines", async () => {
    const oldContent = "---\nname: my-skill\n---\n\n# Old\n";
    const newContent = "---\nname: my-skill\n---\n\n# New\n";

    createGitRepo(repoPath, { "SKILL.md": newContent });
    createProject({
      "my-skill": {
        skillMd: oldContent,
        configToml: { source: repoPath },
      },
    });

    vi.mocked(confirm).mockResolvedValue(false);

    const { execute } = await import("../../../src/cli/commands/update.js");
    await execute("my-skill", { project: projectPath });

    const content = readFileSync(resolve(projectPath, "agents", "my-skill", "SKILL.md"), "utf-8");
    expect(content).toBe(oldContent);
  });

  it("does not modify config.toml during update", async () => {
    const newContent = "---\nname: my-skill\n---\n\n# Updated\n";
    const configToml = { source: repoPath, credentials: ["github_token"], schedule: "0 * * * *" };

    createGitRepo(repoPath, { "SKILL.md": newContent });
    createProject({
      "my-skill": {
        skillMd: "---\nname: my-skill\n---\n\n# Old\n",
        configToml,
      },
    });

    vi.mocked(confirm).mockResolvedValue(true);

    const configBefore = readFileSync(resolve(projectPath, "agents", "my-skill", "config.toml"), "utf-8");

    const { execute } = await import("../../../src/cli/commands/update.js");
    await execute("my-skill", { project: projectPath });

    const configAfter = readFileSync(resolve(projectPath, "agents", "my-skill", "config.toml"), "utf-8");
    expect(configAfter).toBe(configBefore);
  });

  it("skips agents without source field", async () => {
    createProject({
      "local-agent": {
        skillMd: "---\nname: local\n---\n\n# Local\n",
        configToml: { credentials: ["github_token"] },
      },
    });

    const { execute } = await import("../../../src/cli/commands/update.js");
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.map(String).join(" "));
    try {
      await execute(undefined, { project: projectPath });
    } finally {
      console.log = origLog;
    }

    expect(logs.some(l => l.includes("nothing to update"))).toBe(true);
  });

  it("handles collection repos by matching agent name to skills dir", async () => {
    const newContent = "---\nname: alpha\n---\n\n# Alpha v2\n";

    createGitRepo(repoPath, {
      "skills/alpha/SKILL.md": newContent,
      "skills/beta/SKILL.md": "---\nname: beta\n---\n\n# Beta\n",
    });

    createProject({
      "alpha": {
        skillMd: "---\nname: alpha\n---\n\n# Alpha v1\n",
        configToml: { source: repoPath },
      },
    });

    vi.mocked(confirm).mockResolvedValue(true);

    const { execute } = await import("../../../src/cli/commands/update.js");
    await execute("alpha", { project: projectPath });

    const updated = readFileSync(resolve(projectPath, "agents", "alpha", "SKILL.md"), "utf-8");
    expect(updated).toBe(newContent);
  });

  it("throws for non-existent agent name", async () => {
    createProject({});

    const { execute } = await import("../../../src/cli/commands/update.js");
    await expect(execute("nonexistent", { project: projectPath }))
      .rejects.toThrow('Agent "nonexistent" not found');
  });
});
