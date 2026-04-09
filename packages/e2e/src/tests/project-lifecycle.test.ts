/**
 * Group 1 — Project lifecycle tests.
 *
 * Tests that don't need a running scheduler:
 * - al new (project creation)
 * - Agent file creation
 * - al doctor
 * - al creds
 * - al env
 * - al add (local directory)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";
import { MockLLMServer } from "../helpers/mock-llm-server.js";
import { createTestProject, type TestProject } from "../helpers/project-factory.js";
import { alExec } from "../helpers/process.js";

describe("project lifecycle", { timeout: 120_000 }, () => {
  let mockServer: MockLLMServer;

  beforeAll(async () => {
    mockServer = new MockLLMServer();
    await mockServer.start();
  });

  afterAll(async () => {
    await mockServer.stop();
  });

  describe("al new", () => {
    let projectDir: string;

    afterAll(() => {
      if (projectDir && existsSync(projectDir)) {
        rmSync(projectDir, { recursive: true, force: true });
      }
    });

    it("creates valid project structure with --no-interactive", async () => {
      const parentDir = mkdtempSync(resolve(tmpdir(), "al-e2e-new-"));
      projectDir = resolve(parentDir, "test-project");

      const result = await alExec(
        ["new", "test-project", "--no-interactive", "--provider", "openai", "--model", "gpt-4o"],
        { dir: parentDir, configPath: "", envTomlPath: "", mockPort: 0, addAgent: () => {}, writeCredential: () => {}, cleanup: () => {} },
        { timeout: 60_000, skipProjectArg: true },
      );

      // al new may warn about credentials but should not fail
      expect(existsSync(projectDir)).toBe(true);
      expect(existsSync(resolve(projectDir, "config.toml"))).toBe(true);
      expect(existsSync(resolve(projectDir, ".env.toml"))).toBe(true);
      expect(existsSync(resolve(projectDir, ".gitignore"))).toBe(true);
      expect(existsSync(resolve(projectDir, "package.json"))).toBe(true);
      expect(existsSync(resolve(projectDir, "agents"))).toBe(true);

      // Verify config.toml has model config
      const configContent = readFileSync(resolve(projectDir, "config.toml"), "utf-8");
      expect(configContent).toContain("openai");
      expect(configContent).toContain("gpt-4o");

      // Verify .env.toml has project name
      const envContent = readFileSync(resolve(projectDir, ".env.toml"), "utf-8");
      expect(envContent).toContain("test-project");
    });
  });

  describe("al doctor", () => {
    let project: TestProject;

    afterAll(() => project?.cleanup());

    it("passes on a valid project with agent", async () => {
      project = createTestProject("doctor-pass", mockServer);
      project.addAgent("test-agent", {
        skill: "You are a test agent.",
        models: ["mock"],
        schedule: "0 * * * *",
      });

      const result = await alExec(["doctor"], project);
      // Doctor should not exit with fatal error
      if (result.exitCode !== 0) {
        console.error("doctor stdout:", result.stdout);
        console.error("doctor stderr:", result.stderr);
      }
      expect(result.exitCode).toBe(0);
    });

    it("reports issues on project with missing credentials", async () => {
      project = createTestProject("doctor-creds", mockServer);
      project.addAgent("cred-agent", {
        skill: "You need credentials.",
        models: ["mock"],
        credentials: ["github_token"],
        schedule: "0 * * * *",
      });

      const result = await alExec(["doctor"], project);
      // Should report credential issues
      const output = result.stdout + result.stderr;
      expect(output).toMatch(/github_token|credential/i);
    });
  });

  describe("al env", () => {
    let project: TestProject;

    afterAll(() => project?.cleanup());

    it("init/list/show work correctly", async () => {
      project = createTestProject("env-test", mockServer);
      const envOpts = {
        env: { AL_ENVIRONMENTS_DIR: resolve(project.dir, ".al-environments") },
        skipProjectArg: true,
      };

      // Init
      const initResult = await alExec(["env", "init", "test-env", "--type", "server"], project, envOpts);
      if (initResult.exitCode !== 0) {
        console.error("env init stdout:", initResult.stdout);
        console.error("env init stderr:", initResult.stderr);
      }
      expect(initResult.exitCode).toBe(0);

      // List
      const listResult = await alExec(["env", "list"], project, envOpts);
      expect(listResult.stdout).toContain("test-env");

      // Show
      const showResult = await alExec(["env", "show", "test-env"], project, envOpts);
      expect(showResult.exitCode).toBe(0);
    });
  });

  describe("al add", () => {
    let project: TestProject;
    let fixtureDir: string;

    beforeAll(() => {
      // Create a fixture directory with a skill
      fixtureDir = mkdtempSync(resolve(tmpdir(), "al-e2e-fixture-"));
      writeFileSync(resolve(fixtureDir, "SKILL.md"), [
        "---",
        "name: fixture-agent",
        "description: A test fixture agent",
        "---",
        "",
        "# Fixture Agent",
        "",
        "You are a fixture agent for testing.",
      ].join("\n"));

      writeFileSync(resolve(fixtureDir, "config.toml"), 'models = ["mock"]\nschedule = "0 * * * *"\n');
    });

    afterAll(() => {
      project?.cleanup();
      if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
    });

    it("installs skill from local directory with --no-config", async () => {
      project = createTestProject("add-local", mockServer);

      const result = await alExec(
        ["add", fixtureDir, "--no-config"],
        project,
        { timeout: 30_000 },
      );

      if (result.exitCode !== 0) {
        console.error("add stdout:", result.stdout);
        console.error("add stderr:", result.stderr);
      }
      expect(result.exitCode).toBe(0);

      // Verify agent files were created
      const agentDir = resolve(project.dir, "agents", "fixture-agent");
      expect(existsSync(agentDir)).toBe(true);
      expect(existsSync(resolve(agentDir, "SKILL.md"))).toBe(true);
      expect(existsSync(resolve(agentDir, "config.toml"))).toBe(true);

      // Verify SKILL.md content was copied
      const skillContent = readFileSync(resolve(agentDir, "SKILL.md"), "utf-8");
      expect(skillContent).toContain("fixture agent for testing");

      // Verify config.toml has source field pointing to the local directory
      const configContent = readFileSync(resolve(agentDir, "config.toml"), "utf-8");
      expect(configContent).toContain("source");
    });

    it("installs specific skill from collection directory", async () => {
      // Create a collection fixture with multiple skills
      const collectionDir = mkdtempSync(resolve(tmpdir(), "al-e2e-collection-"));
      mkdirSync(resolve(collectionDir, "skills", "alpha"), { recursive: true });
      mkdirSync(resolve(collectionDir, "skills", "beta"), { recursive: true });

      writeFileSync(resolve(collectionDir, "skills", "alpha", "SKILL.md"), [
        "---", "name: alpha", "---", "", "Alpha agent.",
      ].join("\n"));

      writeFileSync(resolve(collectionDir, "skills", "beta", "SKILL.md"), [
        "---", "name: beta", "---", "", "Beta agent.",
      ].join("\n"));

      const proj = createTestProject("add-collection", mockServer);

      const result = await alExec(
        ["add", collectionDir, "--agent", "alpha", "--no-config"],
        proj,
      );

      expect(result.exitCode).toBe(0);
      expect(existsSync(resolve(proj.dir, "agents", "alpha", "SKILL.md"))).toBe(true);
      expect(existsSync(resolve(proj.dir, "agents", "beta"))).toBe(false);

      proj.cleanup();
      rmSync(collectionDir, { recursive: true, force: true });
    });

    it("fails gracefully for directory with no SKILL.md", async () => {
      const emptyDir = mkdtempSync(resolve(tmpdir(), "al-e2e-empty-"));
      const proj = createTestProject("add-empty", mockServer);

      const result = await alExec(["add", emptyDir, "--no-config"], proj);

      expect(result.exitCode).not.toBe(0);
      const output = result.stdout + result.stderr;
      expect(output).toMatch(/SKILL\.md|not found/i);

      proj.cleanup();
      rmSync(emptyDir, { recursive: true, force: true });
    });
  });
});
