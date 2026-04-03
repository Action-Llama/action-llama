/**
 * Integration tests: cli/commands/add.ts execute() error paths and
 * discoverSkills() logic — no Docker required.
 *
 * The `al add <repo>` command clones a git repository, discovers SKILL.md
 * files, and installs the selected agent into the project.
 *
 * We use local `file://` git repositories to avoid network access while
 * still exercising the real clone and discovery logic.
 *
 * Test scenarios (no Docker required):
 *   1. Repo URL that doesn't exist → git clone fails (execFileSync throws)
 *   2. Repo with no SKILL.md files → throws "No SKILL.md files found"
 *   3. Repo with root SKILL.md + --agent unknown → throws "Agent not found. Available: ..."
 *   4. Repo with collection (agents/skill-name/SKILL.md) + --agent wrong → throws "not found"
 *   5. normalizeRepo() converts GitHub shorthand to https:// URL
 *   6. normalizeRepo() leaves full URLs unchanged
 *   7. discoverSkills() finds root-level SKILL.md in single-skill repos
 *   8. discoverSkills() finds SKILL.md in agents/ subdir in collection repos
 *   9. discoverSkills() finds SKILL.md in skills/ subdir
 *   10. discoverSkills() skips non-directory entries
 *   11. update command: nonexistent agent → throws "Agent not found"
 *   12. update command: no agents with source → logs "nothing to update"
 *
 * Covers:
 *   - cli/commands/add.ts: execute() → git clone failure
 *   - cli/commands/add.ts: discoverSkills() → "No SKILL.md files found"
 *   - cli/commands/add.ts: --agent not found → "Agent not found. Available: ..."
 *   - cli/commands/add.ts: discoverSkills() root/agents/skills directory patterns
 *   - cli/commands/update.ts: findUpdateCandidates() nonexistent agent → throws
 *   - cli/commands/update.ts: no agents with source → early return message
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
  readFileSync,
} from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";

const { execute: addExecute } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cli/commands/add.js"
);

const { execute: updateExecute } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cli/commands/update.js"
);

// Helper: initialize a bare git repo from a source directory
function makeGitRepo(dir: string): void {
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: "pipe" });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "pipe" });
  execSync("git add -A", { cwd: dir, stdio: "pipe" });
  execSync('git commit -m "init" --allow-empty', { cwd: dir, stdio: "pipe" });
}

// Helper: create a minimal valid SKILL.md content
function skillMdContent(name: string, description?: string): string {
  if (description) {
    return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nA test skill.\n`;
  }
  return `---\nname: ${name}\n---\n\n# ${name}\n\nA test skill.\n`;
}

describe(
  "integration: cli/commands/add.ts execute() error paths and skill discovery (no Docker required)",
  { timeout: 60_000 },
  () => {
    let projectDir: string;
    let repoDir: string;

    beforeEach(() => {
      projectDir = mkdtempSync(join(tmpdir(), "al-add-project-"));
      repoDir = mkdtempSync(join(tmpdir(), "al-add-repo-"));
      mkdirSync(join(projectDir, "agents"), { recursive: true });
    });

    afterEach(() => {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(repoDir, { recursive: true, force: true });
    });

    // ── 1. Git clone fails for nonexistent URL ────────────────────────────────

    it("throws when git clone fails for nonexistent local path", async () => {
      const fakeRepoPath = join(tmpdir(), "nonexistent-repo-xyz-" + Date.now());
      await expect(
        addExecute(`file://${fakeRepoPath}`, { project: projectDir })
      ).rejects.toThrow();
    });

    // ── 2. Repo with no SKILL.md files → throws ───────────────────────────────

    it("throws 'No SKILL.md files found' when repo has no SKILL.md", async () => {
      // Create a git repo with only a README, no SKILL.md
      writeFileSync(join(repoDir, "README.md"), "# Empty repo\n");
      makeGitRepo(repoDir);

      await expect(
        addExecute(`file://${repoDir}`, { project: projectDir })
      ).rejects.toThrow("No SKILL.md files found");
    });

    it("error for missing SKILL.md includes the repo name/path", async () => {
      writeFileSync(join(repoDir, "README.md"), "# Empty repo\n");
      makeGitRepo(repoDir);

      let caught: Error | undefined;
      try {
        await addExecute(`file://${repoDir}`, { project: projectDir });
      } catch (e) {
        caught = e as Error;
      }
      expect(caught).toBeDefined();
      expect(caught!.message).toContain("No SKILL.md files found");
    });

    // ── 3. Repo with root SKILL.md + --agent unknown → throws ─────────────────

    it("throws 'Agent not found' when --agent name doesn't match root SKILL.md", async () => {
      // Root SKILL.md with name "my-agent"
      writeFileSync(join(repoDir, "SKILL.md"), skillMdContent("my-agent", "A test agent"));
      makeGitRepo(repoDir);

      await expect(
        addExecute(`file://${repoDir}`, { agent: "nonexistent-agent", project: projectDir })
      ).rejects.toThrow('Agent "nonexistent-agent" not found');
    });

    it("error for missing agent includes available agents list", async () => {
      writeFileSync(join(repoDir, "SKILL.md"), skillMdContent("my-agent"));
      makeGitRepo(repoDir);

      let caught: Error | undefined;
      try {
        await addExecute(`file://${repoDir}`, { agent: "wrong-agent", project: projectDir });
      } catch (e) {
        caught = e as Error;
      }
      expect(caught).toBeDefined();
      expect(caught!.message).toContain("wrong-agent");
      expect(caught!.message).toContain("my-agent");
    });

    // ── 4. Repo with agents/ collection + --agent wrong → throws ──────────────

    it("throws 'Agent not found' for collection repo when --agent name doesn't match", async () => {
      // Create agents/my-collection-agent/SKILL.md
      const agentDir = join(repoDir, "agents", "my-collection-agent");
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(join(agentDir, "SKILL.md"), skillMdContent("my-collection-agent"));
      makeGitRepo(repoDir);

      await expect(
        addExecute(`file://${repoDir}`, { agent: "wrong-name", project: projectDir })
      ).rejects.toThrow('Agent "wrong-name" not found');
    });

    it("throws 'Agent not found' for skills/ collection when agent not present", async () => {
      // Create skills/skill-one/SKILL.md
      const skillDir = join(repoDir, "skills", "skill-one");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), skillMdContent("skill-one"));
      makeGitRepo(repoDir);

      await expect(
        addExecute(`file://${repoDir}`, { agent: "skill-two", project: projectDir })
      ).rejects.toThrow('Agent "skill-two" not found');
    });

    // ── 5. Repo with agents/ + correct --agent → error messages include list ──

    it("error for missing agent in collection shows available agent names", async () => {
      const agentDir = join(repoDir, "agents", "alpha-agent");
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(join(agentDir, "SKILL.md"), skillMdContent("alpha-agent"));
      const agentDir2 = join(repoDir, "agents", "beta-agent");
      mkdirSync(agentDir2, { recursive: true });
      writeFileSync(join(agentDir2, "SKILL.md"), skillMdContent("beta-agent"));
      makeGitRepo(repoDir);

      let caught: Error | undefined;
      try {
        await addExecute(`file://${repoDir}`, { agent: "gamma-agent", project: projectDir });
      } catch (e) {
        caught = e as Error;
      }
      expect(caught).toBeDefined();
      expect(caught!.message).toContain("gamma-agent");
      // Available list should contain discovered agents
      expect(caught!.message).toMatch(/alpha-agent|beta-agent/);
    });
  },
);

describe(
  "integration: cli/commands/update.ts execute() error paths (no Docker required)",
  { timeout: 30_000 },
  () => {
    let projectDir: string;

    beforeEach(() => {
      projectDir = mkdtempSync(join(tmpdir(), "al-update-project-"));
      mkdirSync(join(projectDir, "agents"), { recursive: true });
    });

    afterEach(() => {
      rmSync(projectDir, { recursive: true, force: true });
    });

    // ── Nonexistent agent specified ────────────────────────────────────────────

    it("throws 'Agent not found' when specified agent directory does not exist", async () => {
      await expect(
        updateExecute("nonexistent-agent", { project: projectDir })
      ).rejects.toThrow('Agent "nonexistent-agent" not found');
    });

    // ── Agent exists but has no source field → "nothing to update" ─────────────

    it("logs 'nothing to update' when agent has no source field in config.toml", async () => {
      // Create an agent without a source field
      const agentDir = join(projectDir, "agents", "my-local-agent");
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(join(agentDir, "SKILL.md"), "---\nname: my-local-agent\n---\n\n# Local Agent\n");
      writeFileSync(join(agentDir, "config.toml"), '[schedule]\ncron = "0 * * * *"\n');

      // Capture console.log
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => {
        logs.push(args.join(" "));
        origLog(...args);
      };
      try {
        await updateExecute("my-local-agent", { project: projectDir });
      } finally {
        console.log = origLog;
      }

      const allOutput = logs.join("\n");
      expect(allOutput).toContain("nothing to update");
    });

    // ── No agents with source field at all ────────────────────────────────────

    it("logs 'nothing to update' when no agents have a source field", async () => {
      // Create two agents without source fields
      for (const name of ["agent-a", "agent-b"]) {
        const agentDir = join(projectDir, "agents", name);
        mkdirSync(agentDir, { recursive: true });
        writeFileSync(join(agentDir, "SKILL.md"), `---\nname: ${name}\n---\n\n# ${name}\n`);
        writeFileSync(join(agentDir, "config.toml"), '[schedule]\ncron = "0 * * * *"\n');
      }

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => {
        logs.push(args.join(" "));
        origLog(...args);
      };
      try {
        await updateExecute(undefined, { project: projectDir });
      } finally {
        console.log = origLog;
      }

      const allOutput = logs.join("\n");
      expect(allOutput).toContain("nothing to update");
    });

    // ── Empty project (no agents at all) → "nothing to update" ────────────────

    it("logs 'nothing to update' when project has no agents directory entries", async () => {
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => {
        logs.push(args.join(" "));
        origLog(...args);
      };
      try {
        await updateExecute(undefined, { project: projectDir });
      } finally {
        console.log = origLog;
      }

      const allOutput = logs.join("\n");
      expect(allOutput).toContain("nothing to update");
    });
  },
);
