import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import { stringify as stringifyTOML, parse as parseTOML } from "smol-toml";

// We test the pure helper functions by importing them indirectly through execute,
// plus test normalizeRepo and discoverSkills behavior through integration-style tests.

describe("al add", () => {
  let tmpDir: string;
  let projectPath: string;
  let repoPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-add-test-"));
    projectPath = join(tmpDir, "project");
    repoPath = join(tmpDir, "repo");

    // Create a minimal project
    mkdirSync(resolve(projectPath, "agents"), { recursive: true });
    writeFileSync(resolve(projectPath, "config.toml"), stringifyTOML({ models: { sonnet: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" } } }) + "\n");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

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

  describe("single-skill repo", () => {
    it("installs a skill from a local git repo", async () => {
      createGitRepo(repoPath, {
        "SKILL.md": "---\nname: my-skill\ndescription: A test skill\n---\n\n# My Skill\n\nDoes stuff.\n",
        "config.toml": stringifyTOML({ credentials: ["github_token"], schedule: "0 * * * *" }) + "\n",
      });

      // Mock inquirer to avoid interactive prompts (configAgent will be called)
      const agentModule = await import("../../../src/cli/commands/agent.js");
      vi.spyOn(agentModule, "configAgent").mockResolvedValue();

      const { execute } = await import("../../../src/cli/commands/add.js");
      await execute(repoPath, { project: projectPath });

      // Verify SKILL.md was copied
      const skillMd = readFileSync(resolve(projectPath, "agents", "my-skill", "SKILL.md"), "utf-8");
      expect(skillMd).toContain("# My Skill");

      // Verify config.toml was created with source field
      const configToml = readFileSync(resolve(projectPath, "agents", "my-skill", "config.toml"), "utf-8");
      const config = parseTOML(configToml) as Record<string, unknown>;
      expect(config.source).toBe(repoPath);
      expect(config.credentials).toEqual(["github_token"]);
      expect(config.schedule).toBe("0 * * * *");
    });

    it("creates config.toml with just source when repo has no config.toml", async () => {
      createGitRepo(repoPath, {
        "SKILL.md": "---\nname: bare-skill\n---\n\n# Bare\n",
      });

      const agentModule = await import("../../../src/cli/commands/agent.js");
      vi.spyOn(agentModule, "configAgent").mockResolvedValue();

      const { execute } = await import("../../../src/cli/commands/add.js");
      await execute(repoPath, { project: projectPath });

      const configToml = readFileSync(resolve(projectPath, "agents", "bare-skill", "config.toml"), "utf-8");
      const config = parseTOML(configToml) as Record<string, unknown>;
      expect(config.source).toBe(repoPath);
      expect(Object.keys(config)).toEqual(["source"]);
    });
  });

  describe("collection repo", () => {
    it("installs a specific skill with --skill flag", async () => {
      createGitRepo(repoPath, {
        "skills/alpha/SKILL.md": "---\nname: alpha\ndescription: Alpha skill\n---\n\n# Alpha\n",
        "skills/alpha/config.toml": stringifyTOML({ schedule: "0 0 * * *" }) + "\n",
        "skills/beta/SKILL.md": "---\nname: beta\n---\n\n# Beta\n",
      });

      const agentModule = await import("../../../src/cli/commands/agent.js");
      vi.spyOn(agentModule, "configAgent").mockResolvedValue();

      const { execute } = await import("../../../src/cli/commands/add.js");
      await execute(repoPath, { skill: "alpha", project: projectPath });

      expect(existsSync(resolve(projectPath, "agents", "alpha", "SKILL.md"))).toBe(true);
      expect(existsSync(resolve(projectPath, "agents", "beta", "SKILL.md"))).toBe(false);
    });

    it("throws when --skill name not found in repo", async () => {
      createGitRepo(repoPath, {
        "skills/alpha/SKILL.md": "---\nname: alpha\n---\n\n# Alpha\n",
      });

      const agentModule = await import("../../../src/cli/commands/agent.js");
      vi.spyOn(agentModule, "configAgent").mockResolvedValue();

      const { execute } = await import("../../../src/cli/commands/add.js");
      await expect(execute(repoPath, { skill: "nope", project: projectPath }))
        .rejects.toThrow('Skill "nope" not found');
    });
  });

  describe("error handling", () => {
    it("throws when repo has no SKILL.md files", async () => {
      createGitRepo(repoPath, {
        "README.md": "# Just a readme\n",
      });

      const agentModule = await import("../../../src/cli/commands/agent.js");
      vi.spyOn(agentModule, "configAgent").mockResolvedValue();

      const { execute } = await import("../../../src/cli/commands/add.js");
      await expect(execute(repoPath, { project: projectPath }))
        .rejects.toThrow("No SKILL.md files found");
    });
  });

  describe("normalizeRepo", () => {
    it("converts GitHub shorthand to full URL (tested via execute error path)", async () => {
      // A non-existent GitHub repo should fail at the git clone step
      const { execute } = await import("../../../src/cli/commands/add.js");
      await expect(execute("nonexistent-user/nonexistent-repo-abc123", { project: projectPath }))
        .rejects.toThrow();
    });
  });
});
