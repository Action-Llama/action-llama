import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import { stringify as stringifyTOML, parse as parseTOML } from "smol-toml";

// Mock interactive prompts so tests don't hang
const { mockSelect, mockInput } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockInput: vi.fn(),
}));

vi.mock("@inquirer/prompts", () => ({
  select: (...args: any[]) => mockSelect(...args),
  input: (...args: any[]) => mockInput(...args),
}));

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
    it("installs a specific agent with --agent flag", async () => {
      createGitRepo(repoPath, {
        "skills/alpha/SKILL.md": "---\nname: alpha\ndescription: Alpha skill\n---\n\n# Alpha\n",
        "skills/alpha/config.toml": stringifyTOML({ schedule: "0 0 * * *" }) + "\n",
        "skills/beta/SKILL.md": "---\nname: beta\n---\n\n# Beta\n",
      });

      const agentModule = await import("../../../src/cli/commands/agent.js");
      vi.spyOn(agentModule, "configAgent").mockResolvedValue();

      const { execute } = await import("../../../src/cli/commands/add.js");
      await execute(repoPath, { agent: "alpha", project: projectPath });

      expect(existsSync(resolve(projectPath, "agents", "alpha", "SKILL.md"))).toBe(true);
      expect(existsSync(resolve(projectPath, "agents", "beta", "SKILL.md"))).toBe(false);
    });

    it("discovers skills in agents/ directory", async () => {
      createGitRepo(repoPath, {
        "agents/gamma/SKILL.md": "---\nname: gamma\ndescription: Gamma skill\n---\n\n# Gamma\n",
        "agents/gamma/config.toml": stringifyTOML({ schedule: "0 12 * * *" }) + "\n",
        "agents/delta/SKILL.md": "---\nname: delta\n---\n\n# Delta\n",
      });

      const agentModule = await import("../../../src/cli/commands/agent.js");
      vi.spyOn(agentModule, "configAgent").mockResolvedValue();

      const { execute } = await import("../../../src/cli/commands/add.js");
      await execute(repoPath, { agent: "gamma", project: projectPath });

      expect(existsSync(resolve(projectPath, "agents", "gamma", "SKILL.md"))).toBe(true);
      expect(existsSync(resolve(projectPath, "agents", "delta", "SKILL.md"))).toBe(false);
    });

    it("throws when --agent name not found in repo", async () => {
      createGitRepo(repoPath, {
        "skills/alpha/SKILL.md": "---\nname: alpha\n---\n\n# Alpha\n",
      });

      const agentModule = await import("../../../src/cli/commands/agent.js");
      vi.spyOn(agentModule, "configAgent").mockResolvedValue();

      const { execute } = await import("../../../src/cli/commands/add.js");
      await expect(execute(repoPath, { agent: "nope", project: projectPath }))
        .rejects.toThrow('Agent "nope" not found');
    });
  });

  describe("Dockerfile", () => {
    it("copies Dockerfile when present alongside SKILL.md", async () => {
      createGitRepo(repoPath, {
        "SKILL.md": "---\nname: my-skill\n---\n\n# My Skill\n",
        "config.toml": stringifyTOML({ schedule: "0 * * * *" }) + "\n",
        "Dockerfile": "FROM node:20-alpine\nCOPY . .\n",
      });

      const agentModule = await import("../../../src/cli/commands/agent.js");
      vi.spyOn(agentModule, "configAgent").mockResolvedValue();

      const { execute } = await import("../../../src/cli/commands/add.js");
      await execute(repoPath, { project: projectPath });

      const dockerfile = readFileSync(resolve(projectPath, "agents", "my-skill", "Dockerfile"), "utf-8");
      expect(dockerfile).toBe("FROM node:20-alpine\nCOPY . .\n");
    });

    it("does not create Dockerfile when not present in source", async () => {
      createGitRepo(repoPath, {
        "SKILL.md": "---\nname: my-skill\n---\n\n# My Skill\n",
      });

      const agentModule = await import("../../../src/cli/commands/agent.js");
      vi.spyOn(agentModule, "configAgent").mockResolvedValue();

      const { execute } = await import("../../../src/cli/commands/add.js");
      await execute(repoPath, { project: projectPath });

      expect(existsSync(resolve(projectPath, "agents", "my-skill", "Dockerfile"))).toBe(false);
    });

    it("copies Dockerfile from collection repo skill directory", async () => {
      createGitRepo(repoPath, {
        "skills/alpha/SKILL.md": "---\nname: alpha\n---\n\n# Alpha\n",
        "skills/alpha/Dockerfile": "FROM python:3.12\nRUN pip install stuff\n",
        "skills/alpha/config.toml": stringifyTOML({ schedule: "0 0 * * *" }) + "\n",
      });

      const agentModule = await import("../../../src/cli/commands/agent.js");
      vi.spyOn(agentModule, "configAgent").mockResolvedValue();

      const { execute } = await import("../../../src/cli/commands/add.js");
      await execute(repoPath, { agent: "alpha", project: projectPath });

      const dockerfile = readFileSync(resolve(projectPath, "agents", "alpha", "Dockerfile"), "utf-8");
      expect(dockerfile).toBe("FROM python:3.12\nRUN pip install stuff\n");
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

  describe("discoverSkills — edge cases", () => {
    it("skips non-directory entries in skills/ subdirectory", async () => {
      createGitRepo(repoPath, {
        "skills/a-file.txt": "not a directory",
        "skills/real-skill/SKILL.md": "---\nname: real-skill\n---\n\n# Real\n",
      });

      const agentModule = await import("../../../src/cli/commands/agent.js");
      vi.spyOn(agentModule, "configAgent").mockResolvedValue();

      const { execute } = await import("../../../src/cli/commands/add.js");
      await execute(repoPath, { agent: "real-skill", project: projectPath });

      // Only the real skill directory should be installed
      expect(existsSync(resolve(projectPath, "agents", "real-skill", "SKILL.md"))).toBe(true);
    });

    it("skips directories in skills/ that have no SKILL.md", async () => {
      createGitRepo(repoPath, {
        "skills/empty-dir/README.md": "no skill here",
        "skills/has-skill/SKILL.md": "---\nname: has-skill\n---\n\n# Skill\n",
      });

      const agentModule = await import("../../../src/cli/commands/agent.js");
      vi.spyOn(agentModule, "configAgent").mockResolvedValue();

      const { execute } = await import("../../../src/cli/commands/add.js");
      await execute(repoPath, { agent: "has-skill", project: projectPath });

      expect(existsSync(resolve(projectPath, "agents", "has-skill", "SKILL.md"))).toBe(true);
    });

    it("deduplicates skills when root SKILL.md name matches a skills/ directory name", async () => {
      // Root SKILL.md is named "my-skill" and skills/my-skill/ also exists
      createGitRepo(repoPath, {
        "SKILL.md": "---\nname: my-skill\n---\n\n# Root\n",
        "skills/my-skill/SKILL.md": "---\nname: my-skill\n---\n\n# Duplicate\n",
      });

      const agentModule = await import("../../../src/cli/commands/agent.js");
      vi.spyOn(agentModule, "configAgent").mockResolvedValue();

      const { execute } = await import("../../../src/cli/commands/add.js");
      // Should install once, not throw about duplicate
      await execute(repoPath, { agent: "my-skill", project: projectPath });

      expect(existsSync(resolve(projectPath, "agents", "my-skill", "SKILL.md"))).toBe(true);
    });

    it("falls back to directory entry name when SKILL.md has no frontmatter name", async () => {
      createGitRepo(repoPath, {
        "skills/unnamed-dir/SKILL.md": "# No frontmatter here\n\nJust content.\n",
      });

      const agentModule = await import("../../../src/cli/commands/agent.js");
      vi.spyOn(agentModule, "configAgent").mockResolvedValue();

      const { execute } = await import("../../../src/cli/commands/add.js");
      // Agent name should fall back to the directory name "unnamed-dir"
      await execute(repoPath, { agent: "unnamed-dir", project: projectPath });

      expect(existsSync(resolve(projectPath, "agents", "unnamed-dir", "SKILL.md"))).toBe(true);
    });

    it("uses select prompt when multiple skills exist and no --agent flag", async () => {
      createGitRepo(repoPath, {
        "skills/alpha/SKILL.md": "---\nname: alpha\ndescription: Alpha skill\n---\n\n# Alpha\n",
        "skills/beta/SKILL.md": "---\nname: beta\ndescription: Beta skill\n---\n\n# Beta\n",
      });

      // Mock select to return the "alpha" skill
      mockSelect.mockImplementation(({ choices }: { choices: any[] }) => {
        return Promise.resolve(choices.find((c) => c.value?.name === "alpha")?.value);
      });

      const agentModule = await import("../../../src/cli/commands/agent.js");
      vi.spyOn(agentModule, "configAgent").mockResolvedValue();

      const { execute } = await import("../../../src/cli/commands/add.js");
      await execute(repoPath, { project: projectPath });

      expect(mockSelect).toHaveBeenCalledOnce();
      expect(existsSync(resolve(projectPath, "agents", "alpha", "SKILL.md"))).toBe(true);
    });
  });

  describe("agent name validation edge cases", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("prompts for a new name when skill name is not a valid agent name", async () => {
      // Create a skill with an invalid name (has spaces)
      createGitRepo(repoPath, {
        "SKILL.md": "---\nname: invalid name with spaces\n---\n\n# Bad Name\n",
      });

      // Mock input to return a valid name
      mockInput.mockResolvedValueOnce("valid-name");

      const agentModule = await import("../../../src/cli/commands/agent.js");
      vi.spyOn(agentModule, "configAgent").mockResolvedValue();

      const { execute } = await import("../../../src/cli/commands/add.js");
      await execute(repoPath, { project: projectPath });

      expect(mockInput).toHaveBeenCalledOnce();
      expect(existsSync(resolve(projectPath, "agents", "valid-name", "SKILL.md"))).toBe(true);
    });

    it("prompts for a new name when agent directory already exists", async () => {
      createGitRepo(repoPath, {
        "SKILL.md": "---\nname: existing-agent\n---\n\n# Already Installed\n",
      });

      // Pre-create the agents directory to simulate conflict
      mkdirSync(resolve(projectPath, "agents", "existing-agent"), { recursive: true });

      // Mock input to return a non-conflicting name
      mockInput.mockResolvedValueOnce("existing-agent-v2");

      const agentModule = await import("../../../src/cli/commands/agent.js");
      vi.spyOn(agentModule, "configAgent").mockResolvedValue();

      const { execute } = await import("../../../src/cli/commands/add.js");
      await execute(repoPath, { project: projectPath });

      expect(mockInput).toHaveBeenCalledOnce();
      expect(existsSync(resolve(projectPath, "agents", "existing-agent-v2", "SKILL.md"))).toBe(true);
    });
  });

  describe("config.toml handling edge cases", () => {
    it("falls back to empty object when repo config.toml contains invalid TOML", async () => {
      createGitRepo(repoPath, {
        "SKILL.md": "---\nname: my-skill\n---\n\n# My Skill\n",
        "config.toml": "this is [not valid] toml ===\n",
      });

      const agentModule = await import("../../../src/cli/commands/agent.js");
      vi.spyOn(agentModule, "configAgent").mockResolvedValue();

      const { execute } = await import("../../../src/cli/commands/add.js");
      await execute(repoPath, { project: projectPath });

      // Should still succeed, with config.toml containing only the source field
      const configToml = readFileSync(resolve(projectPath, "agents", "my-skill", "config.toml"), "utf-8");
      const config = parseTOML(configToml) as Record<string, unknown>;
      expect(config.source).toBe(repoPath);
    });
  });
});
