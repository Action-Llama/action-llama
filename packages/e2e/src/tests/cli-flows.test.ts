import { describe, it, expect } from "vitest";
import { getTestContext } from "../setup.js";
import { setupLocalActionLlama, createTestAgent, startActionLlamaScheduler, stopActionLlamaScheduler, runSingleAgent, getSchedulerLogs } from "../containers/local.js";

describe("CLI Flows", { timeout: 300000 }, () => {
  it("creates new project", async () => {
    const context = getTestContext();
    const container = await setupLocalActionLlama(context);

    // Check that project was created
    const projectFiles = await context.executeInContainer(container, [
      "ls", "-la", "/home/testuser/test-project"
    ]);

    expect(projectFiles).toContain("config.toml");

    // Check that config file contains expected content
    const configContent = await context.executeInContainer(container, [
      "cat", "/home/testuser/test-project/config.toml"
    ]);

    expect(configContent).toContain("[models.sonnet]");
  });

  it("configures credentials", async () => {
    const context = getTestContext();
    const container = await setupLocalActionLlama(context);

    // Check that credentials directory was set up
    const credFiles = await context.executeInContainer(container, [
      "ls", "-la", "/home/testuser/.action-llama/credentials/"
    ]);

    expect(credFiles).toContain("github_token");
    expect(credFiles).toContain("anthropic_key");

    // Check credential files exist
    const githubToken = await context.executeInContainer(container, [
      "cat", "/home/testuser/.action-llama/credentials/github_token/default/token"
    ]);
    expect(githubToken).toBe("mock-token");

    const anthropicKey = await context.executeInContainer(container, [
      "cat", "/home/testuser/.action-llama/credentials/anthropic_key/default/token"
    ]);
    expect(anthropicKey).toBe("mock-key");
  });

  it("creates and runs agent", async () => {
    const context = getTestContext();
    const container = await setupLocalActionLlama(context);

    const agentSkill = `
# Test Agent

You are a test agent. When run, output "Hello from test agent!" and exit successfully.
    `;

    await createTestAgent(context, container, "test-agent", agentSkill);

    // Check agent was created under agents/ subdir
    const agentFiles = await context.executeInContainer(container, [
      "ls", "-la", "/home/testuser/test-project/agents/test-agent/"
    ]);
    expect(agentFiles).toContain("SKILL.md");

    // Check SKILL.md content
    const skillContent = await context.executeInContainer(container, [
      "cat", "/home/testuser/test-project/agents/test-agent/SKILL.md"
    ]);
    expect(skillContent).toContain("Test Agent");

    // Check per-agent config.toml exists with runtime fields
    const agentConfig = await context.executeInContainer(container, [
      "cat", "/home/testuser/test-project/agents/test-agent/config.toml"
    ]);
    expect(agentConfig).toContain('models = ["sonnet"]');

    // Run the agent manually
    const output = await runSingleAgent(context, container, "test-agent");
    expect(output).toBeDefined();
  });

  it("manages agent lifecycle", async () => {
    const context = getTestContext();
    const container = await setupLocalActionLlama(context);

    const agentSkill = `
# Lifecycle Test Agent

You are a test agent for lifecycle management. Output your status and wait.
    `;

    await createTestAgent(context, container, "lifecycle-agent", agentSkill);

    // Start scheduler
    await startActionLlamaScheduler(context, container);

    // Check scheduler status
    const statusOutput = await context.executeInContainer(container, [
      "bash", "-c", "cd /home/testuser/test-project && al stat"
    ]);
    expect(statusOutput).toContain("Running");

    // Check scheduler logs
    await new Promise(resolve => setTimeout(resolve, 2000));
    const logs = await getSchedulerLogs(context, container);
    expect(logs).toBeDefined();

    // Pause agent
    await context.executeInContainer(container, [
      "bash", "-c", "cd /home/testuser/test-project && al pause lifecycle-agent"
    ]);

    // Resume agent
    await context.executeInContainer(container, [
      "bash", "-c", "cd /home/testuser/test-project && al resume lifecycle-agent"
    ]);

    // Stop scheduler
    await stopActionLlamaScheduler(context, container);
  });

  it.todo("handles webhook triggers");
});
