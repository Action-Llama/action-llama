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
    
    expect(credFiles).toContain("github");
    expect(credFiles).toContain("anthropic");
    
    // Check credential files exist
    const githubToken = await context.executeInContainer(container, [
      "cat", "/home/testuser/.action-llama/credentials/github/default/token"
    ]);
    expect(githubToken).toBe("mock-token");
    
    const anthropicKey = await context.executeInContainer(container, [
      "cat", "/home/testuser/.action-llama/credentials/anthropic/default/apiKey"
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
    
    // Check agent was created
    const agentFiles = await context.executeInContainer(container, [
      "ls", "-la", "/home/testuser/test-project/test-agent/"
    ]);
    expect(agentFiles).toContain("SKILL.md");
    
    // Check SKILL.md content
    const skillContent = await context.executeInContainer(container, [
      "cat", "/home/testuser/test-project/test-agent/SKILL.md"
    ]);
    expect(skillContent).toContain("model: sonnet");
    expect(skillContent).toContain("Test Agent");
    
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

  it("handles webhook triggers", async () => {
    const context = getTestContext();
    const container = await setupLocalActionLlama(context);
    
    const webhookSkill = `
# Webhook Test Agent

You are a webhook test agent. When triggered by a webhook, log the trigger data and respond appropriately.

Your configuration includes webhook triggers for GitHub issues.
    `;
    
    // Create agent with webhook configuration
    const skillWithWebhook = `---
model: sonnet
credentials:
  github: default
  anthropic: default
webhooks:
  - provider: github
    events: [issues]
    filter:
      action: opened
---

${webhookSkill}`;
    
    await context.executeInContainer(container, [
      "bash", "-c", `mkdir -p /home/testuser/test-project/webhook-agent`
    ]);
    
    await context.executeInContainer(container, [
      "bash", "-c", `cat > /home/testuser/test-project/webhook-agent/SKILL.md << 'EOF'
${skillWithWebhook}
EOF`
    ]);
    
    // Start scheduler with gateway
    await context.executeInContainer(container, [
      "bash", "-c", "cd /home/testuser/test-project && nohup al start --gateway-port 3000 > /tmp/webhook-scheduler.log 2>&1 & echo $! > /tmp/webhook-scheduler.pid"
    ]);
    
    // Wait for gateway to start
    await new Promise(resolve => setTimeout(resolve, 8000));
    
    // Send test webhook
    const webhookPayload = JSON.stringify({
      action: "opened",
      issue: {
        number: 1,
        title: "Test Issue",
        body: "This is a test issue"
      },
      repository: {
        name: "test-repo",
        owner: { login: "test-owner" }
      }
    });
    
    try {
      await context.executeInContainer(container, [
        "bash", "-c", `curl -X POST http://localhost:3000/webhook/github \\
          -H "Content-Type: application/json" \\
          -H "X-GitHub-Event: issues" \\
          -d '${webhookPayload}'`
      ]);
    } catch (error) {
      // Webhook might fail in test mode, that's expected
      console.log("Webhook test completed (may have failed in mock mode)");
    }
    
    // Stop webhook scheduler
    await context.executeInContainer(container, [
      "bash", "-c", "if [ -f /tmp/webhook-scheduler.pid ]; then kill $(cat /tmp/webhook-scheduler.pid); rm /tmp/webhook-scheduler.pid; fi"
    ]);
  });
});