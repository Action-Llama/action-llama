/**
 * Group 5 — VPS deployment e2e tests.
 *
 * Tests `al push` to a Docker container acting as a VPS.
 * Uses the existing Docker-based VPS infrastructure from containers/vps.ts.
 * Agent uses host-user runtime (docker-in-docker doesn't work).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, writeFileSync, readFileSync } from "fs";
import { resolve } from "path";
import { MockLLMServer } from "../helpers/mock-llm-server.js";
import { createTestProject, type TestProject } from "../helpers/project-factory.js";
import { alExec } from "../helpers/process.js";
import { getTestContext } from "../setup.js";
import { setupVPS } from "../containers/vps.js";
import type { E2ETestContext, ContainerInfo } from "../harness.js";

describe("VPS deployment", { timeout: 600_000 }, () => {
  let mockServer: MockLLMServer;
  let project: TestProject;
  let context: E2ETestContext;
  let vps: ContainerInfo;

  beforeAll(async () => {
    // Start mock LLM — bind to 0.0.0.0 so VPS container can reach it
    mockServer = new MockLLMServer();
    await mockServer.start();

    // Create local project
    project = createTestProject("vps-deploy", mockServer);
    project.addAgent("deploy-agent", {
      skill: "You are a deployment test agent.",
      models: ["mock"],
      schedule: "0 0 1 1 *", // Never triggers
      runtime: { type: "host-user", run_as: "al-agent" },
      timeout: 60,
    });

    // Set up VPS container
    context = getTestContext();
    vps = await setupVPS(context);

    // Create environment config pointing at the VPS
    const envDir = resolve(project.dir, ".al-environments");
    const { mkdirSync } = await import("fs");
    mkdirSync(envDir, { recursive: true });

    // Write environment file
    // The VPS container's SSH is accessible at vps.sshHost:vps.sshPort
    const envConfig = [
      "[server]",
      `host = "${vps.sshHost}"`,
      `sshUser = "root"`,
      `sshPort = ${vps.sshPort}`,
      `sshKeyPath = "${resolve(context.tempDir, "id_rsa")}"`,
      `basePath = "/opt/action-llama"`,
    ].join("\n");

    writeFileSync(resolve(envDir, "test-vps.toml"), envConfig);
  }, 300_000);

  afterAll(async () => {
    project?.cleanup();
    await mockServer?.stop();
    // VPS container cleanup is handled by the test context
  });

  it("al push deploys project to VPS", async () => {
    const result = await alExec(
      ["push", "--env", "test-vps", "--headless", "--skip-creds"],
      project,
      {
        timeout: 120_000,
        env: {
          AL_ENVIRONMENTS_DIR: resolve(project.dir, ".al-environments"),
        },
      },
    );

    expect(result.exitCode).toBe(0);

    // Verify files exist on VPS
    const checkAgents = await context.executeSSHCommand(vps, "ls /opt/action-llama/agents/");
    expect(checkAgents).toContain("deploy-agent");

    const checkConfig = await context.executeSSHCommand(vps, "cat /opt/action-llama/config.toml");
    expect(checkConfig).toContain("mock");
  });

  it("al push updates agent changes", async () => {
    // Modify the agent skill locally
    const skillPath = resolve(project.dir, "agents", "deploy-agent", "SKILL.md");
    const currentSkill = readFileSync(skillPath, "utf-8");
    writeFileSync(skillPath, currentSkill + "\n\nUpdated for deployment test.\n");

    const result = await alExec(
      ["push", "--env", "test-vps", "--headless", "--skip-creds"],
      project,
      {
        timeout: 120_000,
        env: {
          AL_ENVIRONMENTS_DIR: resolve(project.dir, ".al-environments"),
        },
      },
    );

    expect(result.exitCode).toBe(0);

    // Verify updated content on VPS
    const skillOnVps = await context.executeSSHCommand(
      vps,
      "cat /opt/action-llama/agents/deploy-agent/SKILL.md",
    );
    expect(skillOnVps).toContain("Updated for deployment test");
  });
});
