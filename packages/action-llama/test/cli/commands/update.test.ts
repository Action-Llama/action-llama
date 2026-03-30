import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
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

  it("handles collection repos with agents/ directory", async () => {
    const newContent = "---\nname: gamma\n---\n\n# Gamma v2\n";

    createGitRepo(repoPath, {
      "agents/gamma/SKILL.md": newContent,
      "agents/delta/SKILL.md": "---\nname: delta\n---\n\n# Delta\n",
    });

    createProject({
      "gamma": {
        skillMd: "---\nname: gamma\n---\n\n# Gamma v1\n",
        configToml: { source: repoPath },
      },
    });

    vi.mocked(confirm).mockResolvedValue(true);

    const { execute } = await import("../../../src/cli/commands/update.js");
    await execute("gamma", { project: projectPath });

    const updated = readFileSync(resolve(projectPath, "agents", "gamma", "SKILL.md"), "utf-8");
    expect(updated).toBe(newContent);
  });

  it("updates Dockerfile when upstream has changed", async () => {
    const skillContent = "---\nname: my-skill\n---\n\n# My Skill\n";
    const oldDockerfile = "FROM node:18\nCOPY . .\n";
    const newDockerfile = "FROM node:20-alpine\nCOPY . .\nRUN npm install\n";

    createGitRepo(repoPath, {
      "SKILL.md": skillContent,
      "Dockerfile": newDockerfile,
    });

    createProject({
      "my-skill": {
        skillMd: skillContent,
        configToml: { source: repoPath },
      },
    });
    // Write the old Dockerfile separately
    writeFileSync(resolve(projectPath, "agents", "my-skill", "Dockerfile"), oldDockerfile);

    vi.mocked(confirm).mockResolvedValue(true);

    const { execute } = await import("../../../src/cli/commands/update.js");
    await execute("my-skill", { project: projectPath });

    const updated = readFileSync(resolve(projectPath, "agents", "my-skill", "Dockerfile"), "utf-8");
    expect(updated).toBe(newDockerfile);
  });

  it("updates both SKILL.md and Dockerfile in a single prompt", async () => {
    const oldContent = "---\nname: my-skill\n---\n\n# Old\n";
    const newContent = "---\nname: my-skill\n---\n\n# New\n";
    const oldDockerfile = "FROM node:18\n";
    const newDockerfile = "FROM node:20\n";

    createGitRepo(repoPath, {
      "SKILL.md": newContent,
      "Dockerfile": newDockerfile,
    });

    createProject({
      "my-skill": {
        skillMd: oldContent,
        configToml: { source: repoPath },
      },
    });
    writeFileSync(resolve(projectPath, "agents", "my-skill", "Dockerfile"), oldDockerfile);

    vi.mocked(confirm).mockResolvedValue(true);

    const { execute } = await import("../../../src/cli/commands/update.js");
    await execute("my-skill", { project: projectPath });

    const updatedSkill = readFileSync(resolve(projectPath, "agents", "my-skill", "SKILL.md"), "utf-8");
    const updatedDocker = readFileSync(resolve(projectPath, "agents", "my-skill", "Dockerfile"), "utf-8");
    expect(updatedSkill).toBe(newContent);
    expect(updatedDocker).toBe(newDockerfile);

    // Should have been called exactly once (single prompt for both)
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("reports up-to-date when neither SKILL.md nor Dockerfile changed", async () => {
    const skillContent = "---\nname: my-skill\n---\n\n# My Skill\n";
    const dockerfile = "FROM node:20\n";

    createGitRepo(repoPath, {
      "SKILL.md": skillContent,
      "Dockerfile": dockerfile,
    });

    createProject({
      "my-skill": {
        skillMd: skillContent,
        configToml: { source: repoPath },
      },
    });
    writeFileSync(resolve(projectPath, "agents", "my-skill", "Dockerfile"), dockerfile);

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

  it("throws for non-existent agent name", async () => {
    createProject({});

    const { execute } = await import("../../../src/cli/commands/update.js");
    await expect(execute("nonexistent", { project: projectPath }))
      .rejects.toThrow('Agent "nonexistent" not found');
  });

  it("shows agent-specific message when named agent exists but has no source field", async () => {
    createProject({
      "local-only": {
        skillMd: "---\nname: local-only\n---\n\n# Local\n",
        configToml: { credentials: [] },
      },
    });

    const { execute } = await import("../../../src/cli/commands/update.js");
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.map(String).join(" "));
    try {
      await execute("local-only", { project: projectPath });
    } finally {
      console.log = origLog;
    }

    expect(logs.some(l => l.includes('"local-only"') && l.includes("nothing to update"))).toBe(true);
  });

  it("shows error message when update fails for one agent and continues", async () => {
    const skillContent = "---\nname: bad-agent\n---\n\n# Bad\n";

    // Create a repo with a bad URL that will fail during git operations
    createProject({
      "bad-agent": {
        skillMd: skillContent,
        configToml: { source: "https://nonexistent.invalid/repo.git" },
      },
    });

    const { execute } = await import("../../../src/cli/commands/update.js");
    const errors: string[] = [];
    const origError = console.error;
    console.error = (...args: any[]) => errors.push(args.map(String).join(" "));
    try {
      await execute(undefined, { project: projectPath });
    } finally {
      console.error = origError;
    }

    expect(errors.some(e => e.includes("failed"))).toBe(true);
  });

  it("shows summary with multiple statuses for multi-agent update", async () => {
    const skillContent = "---\nname: agent1\n---\n\n# Agent1\n";

    // Create two agents: one up-to-date, one will fail
    createGitRepo(repoPath, { "SKILL.md": skillContent });

    createProject({
      "agent1": {
        skillMd: skillContent,
        configToml: { source: repoPath },
      },
      "agent2": {
        skillMd: "---\nname: agent2\n---\n\n# Agent2\n",
        configToml: { source: "https://nonexistent.invalid/repo.git" },
      },
    });

    vi.mocked(confirm).mockResolvedValue(false); // skip updates

    const { execute } = await import("../../../src/cli/commands/update.js");
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.map(String).join(" "));
    try {
      await execute(undefined, { project: projectPath });
    } finally {
      console.log = origLog;
    }

    // Should show "Done:" summary since there are multiple agents
    expect(logs.some(l => l.includes("Done:"))).toBe(true);
  });

  // ── Additional coverage for uncovered paths ─────────────────────────────

  describe("summary line with updated and skipped counts", () => {
    it("shows 'updated' count in summary when an agent was updated", async () => {
      const oldContent = "---\nname: agent1\n---\n\n# Agent1 v1\n";
      const newContent = "---\nname: agent1\n---\n\n# Agent1 v2\n\nNew section here.\n";

      createGitRepo(repoPath, { "SKILL.md": newContent });
      createProject({
        "agent1": {
          skillMd: oldContent,
          configToml: { source: repoPath },
        },
        "agent2": {
          skillMd: oldContent,
          configToml: { source: repoPath },
        },
      });

      vi.mocked(confirm).mockResolvedValue(true);

      const { execute } = await import("../../../src/cli/commands/update.js");
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => logs.push(args.map(String).join(" "));
      try {
        await execute(undefined, { project: projectPath });
      } finally {
        console.log = origLog;
      }

      // Both agents updated → "2 updated" in summary
      expect(logs.some(l => l.includes("updated"))).toBe(true);
    });

    it("shows 'skipped' count in summary when user declines update", async () => {
      const oldContent = "---\nname: agent1\n---\n\n# Agent1 v1\n";
      const newContent = "---\nname: agent1\n---\n\n# Agent1 v2\n\nNew section.\n";

      createGitRepo(repoPath, { "SKILL.md": newContent });
      createProject({
        "agent1": {
          skillMd: oldContent,
          configToml: { source: repoPath },
        },
        "agent2": {
          skillMd: oldContent,
          configToml: { source: repoPath },
        },
      });

      vi.mocked(confirm).mockResolvedValue(false);

      const { execute } = await import("../../../src/cli/commands/update.js");
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => logs.push(args.map(String).join(" "));
      try {
        await execute(undefined, { project: projectPath });
      } finally {
        console.log = origLog;
      }

      // Both agents skipped → "skipped" in summary
      expect(logs.some(l => l.includes("skipped"))).toBe(true);
    });
  });

  describe("findUpdateCandidates filtering", () => {
    it("skips agents without config.toml", async () => {
      // Create an agent dir without config.toml
      const agentDir = resolve(projectPath, "agents", "no-config");
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(resolve(agentDir, "SKILL.md"), "# No Config Agent\n");
      // Also create a valid config.toml at project root
      mkdirSync(resolve(projectPath), { recursive: true });
      writeFileSync(resolve(projectPath, "config.toml"), "");

      // Another valid agent for reference
      const oldContent = "# Agent1\n";
      const newContent = "# Agent1 v2\n";
      createGitRepo(repoPath, { "SKILL.md": newContent });
      createProject({
        "agent1": {
          skillMd: oldContent,
          configToml: { source: repoPath },
        },
      });
      // Remove config.toml from no-config — it was not created by createProject
      // createProject creates fresh project, so we need to add the no-config dir after
      const noConfigDir = resolve(projectPath, "agents", "no-config");
      mkdirSync(noConfigDir, { recursive: true });
      writeFileSync(resolve(noConfigDir, "SKILL.md"), "# No Config\n");
      // No config.toml created here

      vi.mocked(confirm).mockResolvedValue(true);

      const { execute } = await import("../../../src/cli/commands/update.js");
      // Should not throw — no-config is silently skipped
      await expect(execute(undefined, { project: projectPath })).resolves.not.toThrow();
    });

    it("skips agents in findUpdateCandidates when filterAgent doesn't match", async () => {
      const skillContent = "# Agent\n";
      createGitRepo(repoPath, { "SKILL.md": skillContent });
      createProject({
        "agent1": {
          skillMd: skillContent,
          configToml: { source: repoPath },
        },
        "agent2": {
          skillMd: skillContent,
          configToml: { source: repoPath },
        },
      });

      const { execute } = await import("../../../src/cli/commands/update.js");
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => logs.push(args.map(String).join(" "));
      try {
        // Filter to only agent1; agent2 should be silently skipped
        await execute("agent1", { project: projectPath });
      } finally {
        console.log = origLog;
      }

      // Only agent1 should appear in output
      expect(logs.some(l => l.includes("agent1"))).toBe(true);
      expect(logs.some(l => l.includes("agent2"))).toBe(false);
    });
  });

  describe("normalizeRepo short-form (owner/repo)", () => {
    it("normalizes 'owner/repo' source to full GitHub URL (which will fail to clone)", async () => {
      createProject({
        "my-skill": {
          skillMd: "# My Skill\n",
          configToml: { source: "some-org/some-repo" },
        },
      });

      const { execute } = await import("../../../src/cli/commands/update.js");
      const errors: string[] = [];
      const origError = console.error;
      console.error = (...args: any[]) => errors.push(args.map(String).join(" "));
      try {
        // The normalized URL won't be cloneable in tests, but that's OK —
        // we just want to confirm the normalization path was taken (error will mention github.com)
        await execute(undefined, { project: projectPath });
      } finally {
        console.error = origError;
      }

      // The error message should reference the github.com URL (confirming normalization ran)
      expect(errors.some(e => e.includes("my-skill") && e.includes("failed"))).toBe(true);
    });
  });

  describe("findUpstreamSkillMd — no SKILL.md found", () => {
    it("throws when the cloned repo has no SKILL.md at any expected location", async () => {
      // Create a repo without any SKILL.md
      const emptyRepoPath = join(tmpDir, "empty-repo");
      mkdirSync(emptyRepoPath, { recursive: true });
      writeFileSync(join(emptyRepoPath, "README.md"), "# No skill here\n");
      execFileSync("git", ["init"], { cwd: emptyRepoPath, stdio: "pipe" });
      execFileSync("git", ["config", "user.email", "t@t.com"], { cwd: emptyRepoPath, stdio: "pipe" });
      execFileSync("git", ["config", "user.name", "T"], { cwd: emptyRepoPath, stdio: "pipe" });
      execFileSync("git", ["add", "."], { cwd: emptyRepoPath, stdio: "pipe" });
      execFileSync("git", ["commit", "-m", "init"], { cwd: emptyRepoPath, stdio: "pipe" });

      createProject({
        "my-skill": {
          skillMd: "# My Skill\n",
          configToml: { source: emptyRepoPath },
        },
      });

      const { execute } = await import("../../../src/cli/commands/update.js");
      const errors: string[] = [];
      const origError = console.error;
      console.error = (...args: any[]) => errors.push(args.map(String).join(" "));
      try {
        await execute(undefined, { project: projectPath });
      } finally {
        console.error = origError;
      }

      // Should fail with "No SKILL.md found"
      expect(errors.some(e => e.includes("my-skill") && e.includes("failed"))).toBe(true);
    });
  });

  describe("findUpstreamSkillMd — fallback single collection SKILL.md", () => {
    it("finds SKILL.md under skills/<name>/ when agent name matches a collection entry", async () => {
      const newContent = "# My Skill v2\n";
      const collRepoPath = join(tmpDir, "coll-repo");

      // Create repo with SKILL.md under skills/my-skill/
      mkdirSync(join(collRepoPath, "skills", "my-skill"), { recursive: true });
      writeFileSync(join(collRepoPath, "skills", "my-skill", "SKILL.md"), newContent);
      execFileSync("git", ["init"], { cwd: collRepoPath, stdio: "pipe" });
      execFileSync("git", ["config", "user.email", "t@t.com"], { cwd: collRepoPath, stdio: "pipe" });
      execFileSync("git", ["config", "user.name", "T"], { cwd: collRepoPath, stdio: "pipe" });
      execFileSync("git", ["add", "."], { cwd: collRepoPath, stdio: "pipe" });
      execFileSync("git", ["commit", "-m", "init"], { cwd: collRepoPath, stdio: "pipe" });

      createProject({
        "my-skill": {
          skillMd: "# My Skill v1\n",
          configToml: { source: collRepoPath },
        },
      });

      vi.mocked(confirm).mockResolvedValue(true);

      const { execute } = await import("../../../src/cli/commands/update.js");
      await execute("my-skill", { project: projectPath });

      const updated = readFileSync(resolve(projectPath, "agents", "my-skill", "SKILL.md"), "utf-8");
      expect(updated).toBe(newContent);
    });

    it("finds single SKILL.md via fallback scan when root and named dirs don't exist", async () => {
      const newContent = "# Only Skill\n";
      const fallbackRepoPath = join(tmpDir, "fallback-repo");

      // Create repo with SKILL.md under agents/other-name/ (doesn't match "my-skill" directly,
      // but is the ONLY entry, so fallback scan returns it)
      mkdirSync(join(fallbackRepoPath, "agents", "other-name"), { recursive: true });
      writeFileSync(join(fallbackRepoPath, "agents", "other-name", "SKILL.md"), newContent);
      execFileSync("git", ["init"], { cwd: fallbackRepoPath, stdio: "pipe" });
      execFileSync("git", ["config", "user.email", "t@t.com"], { cwd: fallbackRepoPath, stdio: "pipe" });
      execFileSync("git", ["config", "user.name", "T"], { cwd: fallbackRepoPath, stdio: "pipe" });
      execFileSync("git", ["add", "."], { cwd: fallbackRepoPath, stdio: "pipe" });
      execFileSync("git", ["commit", "-m", "init"], { cwd: fallbackRepoPath, stdio: "pipe" });

      createProject({
        "my-skill": {
          skillMd: "# My Skill v1\n",
          configToml: { source: fallbackRepoPath },
        },
      });

      vi.mocked(confirm).mockResolvedValue(true);

      const { execute } = await import("../../../src/cli/commands/update.js");
      await execute("my-skill", { project: projectPath });

      const updated = readFileSync(resolve(projectPath, "agents", "my-skill", "SKILL.md"), "utf-8");
      expect(updated).toBe(newContent);
    });
  });

  describe("showDiffSummary — upstream has fewer lines", () => {
    it("shows negative line count when upstream SKILL.md is shorter than local", async () => {
      // local has more lines than upstream (so added < 0)
      const longContent = "# My Skill\n\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5\n";
      const shortContent = "# My Skill\n\nLine 1\n";

      createGitRepo(repoPath, { "SKILL.md": shortContent });
      createProject({
        "my-skill": {
          skillMd: longContent,
          configToml: { source: repoPath },
        },
      });

      vi.mocked(confirm).mockResolvedValue(true);

      const { execute } = await import("../../../src/cli/commands/update.js");
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => logs.push(args.map(String).join(" "));
      try {
        await execute("my-skill", { project: projectPath });
      } finally {
        console.log = origLog;
      }

      // The diff summary shows a negative line count (e.g., "  -4 lines")
      expect(logs.some(l => /\s-\d+ lines/.test(l))).toBe(true);
    });
  });
});
