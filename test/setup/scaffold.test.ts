import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { scaffoldProject } from "../../src/setup/scaffold.js";
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
        template: "dev",
        config: {
          name: "dev",
          credentials: ["github-token"],
          model: defaultModel,
          schedule: "*/5 * * * *",


          repos: ["acme/app"],
          params: { triggerLabel: "agent", assignee: "bot" },
        },
      },
      {
        name: "reviewer",
        template: "reviewer",
        config: {
          name: "reviewer",
          credentials: ["github-token"],
          model: defaultModel,
          schedule: "*/5 * * * *",


          repos: ["acme/app"],
        },
      },
      {
        name: "devops",
        template: "devops",
        config: {
          name: "devops",
          credentials: ["github-token"],
          model: defaultModel,
          schedule: "*/15 * * * *",


          repos: ["acme/app"],
        },
      },
    ];
  }

  it("skips global config.json when empty", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-scaffold-"));
    const projDir = resolve(tmpDir, "my-project");
    scaffoldProject(projDir, makeGlobalConfig(), makeAgents());

    const configPath = resolve(projDir, "config.json");
    expect(existsSync(configPath)).toBe(false);
  });

  it("creates global config.json when non-empty", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-scaffold-"));
    const projDir = resolve(tmpDir, "my-project");
    scaffoldProject(projDir, { docker: { enabled: true } }, makeAgents());

    const configPath = resolve(projDir, "config.json");
    expect(existsSync(configPath)).toBe(true);
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(config.docker.enabled).toBe(true);
  });

  it("creates per-agent config.json without name or type", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-scaffold-"));
    const projDir = resolve(tmpDir, "my-project");
    scaffoldProject(projDir, makeGlobalConfig(), makeAgents());

    for (const name of ["dev", "reviewer", "devops"]) {
      const agentConfigPath = resolve(projDir, name, "config.json");
      expect(existsSync(agentConfigPath)).toBe(true);
      const config = JSON.parse(readFileSync(agentConfigPath, "utf-8"));
      // name should NOT be in the serialized config (injected at load time)
      expect(config.name).toBeUndefined();
      // type should not exist
      expect(config.type).toBeUndefined();
    }
  });

  it("writes AGENTS.md for each agent", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-scaffold-"));
    const projDir = resolve(tmpDir, "my-project");
    scaffoldProject(projDir, makeGlobalConfig(), makeAgents());

    for (const name of ["dev", "reviewer", "devops"]) {
      const agentsMdPath = resolve(projDir, name, "AGENTS.md");
      expect(existsSync(agentsMdPath)).toBe(true);
      const content = readFileSync(agentsMdPath, "utf-8");
      expect(content.length).toBeGreaterThan(0);
    }
  });

  it("creates agent directories", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-scaffold-"));
    const projDir = resolve(tmpDir, "my-project");
    scaffoldProject(projDir, makeGlobalConfig(), makeAgents());

    for (const agent of ["dev", "reviewer", "devops"]) {
      expect(existsSync(resolve(projDir, agent))).toBe(true);
    }
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

});
