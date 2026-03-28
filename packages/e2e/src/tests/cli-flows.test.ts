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

  it("triggers agent on cron schedule", async () => {
    const context = getTestContext();
    const container = await setupLocalActionLlama(context);

    // Create an agent with a 6-field cron schedule (seconds precision via croner).
    // "* * * * * *" fires every second — ideal for verifying cron dispatch in e2e tests.
    const agentDir = "/home/testuser/test-project/agents/cron-agent";
    await context.executeInContainer(container, [
      "bash", "-c", `mkdir -p ${agentDir}`,
    ]);

    await context.executeInContainer(container, [
      "bash", "-c", `cat > ${agentDir}/SKILL.md << 'EOF'
---
description: "Cron scheduling test agent"
---

# Cron Test Agent

You are a test agent that verifies cron scheduling fires correctly.
EOF`,
    ]);

    // Schedule fires every second so the test completes quickly.
    await context.executeInContainer(container, [
      "bash", "-c", `cat > ${agentDir}/config.toml << 'EOF'
models = ["sonnet"]
credentials = ["github_token", "anthropic_key"]
schedule = "* * * * * *"
EOF`,
    ]);

    await context.executeInContainer(container, [
      "bash", "-c", `chown -R testuser:testuser ${agentDir}`,
    ]);

    // Start the scheduler with coverage instrumentation.
    await startActionLlamaScheduler(context, container, { coverage: true });

    // Wait up to 60 seconds for the plain-logger to emit "cron-agent: running (schedule)".
    // In headless mode the scheduler writes status-change lines to stdout via attachPlainLogger.
    // The format is: "[<iso-ts>] cron-agent: running (schedule)".
    // The scheduler first builds the agent Docker image (using the Docker layer cache this
    // typically takes only a few seconds), then registers the cron job. Once registered
    // the every-second schedule fires at the next second boundary.
    let cronFired = false;
    for (let i = 0; i < 60; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const logs = await getSchedulerLogs(context, container);
      if (logs.includes("cron-agent: running (schedule)") || logs.includes("cron-agent: running")) {
        cronFired = true;
        break;
      }
    }

    expect(cronFired).toBe(true);

    // Verify the scheduler is still running (cron dispatch did not crash it).
    const statusOutput = await context.executeInContainer(container, [
      "bash", "-c", "cd /home/testuser/test-project && al stat",
    ]);
    expect(statusOutput).toContain("Running");

    await stopActionLlamaScheduler(context, container);
  });

  it("does not trigger agent before its scheduled time", async () => {
    const context = getTestContext();
    const container = await setupLocalActionLlama(context);

    // Create an agent whose cron expression only fires in the distant future
    // (January 1st at midnight, year 2099). Croner won't fire it during the test.
    const agentDir = "/home/testuser/test-project/agents/future-agent";
    await context.executeInContainer(container, [
      "bash", "-c", `mkdir -p ${agentDir}`,
    ]);

    await context.executeInContainer(container, [
      "bash", "-c", `cat > ${agentDir}/SKILL.md << 'EOF'
---
description: "Future-scheduled test agent"
---

# Future Agent

You are a test agent that should never fire during the test run.
EOF`,
    ]);

    // "0 0 1 1 *" = midnight on January 1st (next occurrence is ~Jan 1 2027 at earliest)
    await context.executeInContainer(container, [
      "bash", "-c", `cat > ${agentDir}/config.toml << 'EOF'
models = ["sonnet"]
credentials = ["github_token", "anthropic_key"]
schedule = "0 0 1 1 *"
EOF`,
    ]);

    await context.executeInContainer(container, [
      "bash", "-c", `chown -R testuser:testuser ${agentDir}`,
    ]);

    await startActionLlamaScheduler(context, container, { coverage: true });

    // Wait 5 seconds — the future agent should NOT have been triggered.
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const logs = await getSchedulerLogs(context, container);

    // The scheduler should report that the cron job is registered by logging
    // "cron_jobs=1" in the "scheduler started" line emitted by attachPlainLogger.
    expect(logs).toMatch(/cron_jobs=[1-9]/);

    // The future agent must NOT have fired a run yet.
    // In headless mode, a run start is logged as "future-agent: running (schedule)".
    expect(logs).not.toContain("future-agent: running");

    // Verify via "al stat" that the agent is registered with a cron trigger.
    // The status output shows trigger type "cron" for schedule-driven agents.
    const statOutput = await context.executeInContainer(container, [
      "bash", "-c", "cd /home/testuser/test-project && al stat",
    ]);
    expect(statOutput).toContain("future-agent");
    // "al stat" prints "cron" in the TRIGGER column for schedule-driven agents
    expect(statOutput).toContain("cron");

    await stopActionLlamaScheduler(context, container);
  });
});
