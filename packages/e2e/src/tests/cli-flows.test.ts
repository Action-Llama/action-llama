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

    // Check scheduler status — al stat prints a table with agents and their trigger type.
    // The agent is Idle (no active run) but the scheduler itself is running; we verify
    // that the agent appears in the status output and has a cron trigger registered.
    const statusOutput = await context.executeInContainer(container, [
      "bash", "-c", "cd /home/testuser/test-project && al stat"
    ]);
    expect(statusOutput).toContain("lifecycle-agent");
    // The STATUS column shows "Idle" when no agent instance is actively running
    // (agents are waiting for their next cron trigger). Check for "cron" in the
    // TRIGGER column instead — it always appears for agents with a cron schedule.
    expect(statusOutput).toContain("cron");

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

  it("exits gracefully with CredentialError when a required credential is missing", async () => {
    const context = getTestContext();
    const container = await setupLocalActionLlama(context);

    // Create an agent that references a credential that does NOT exist
    const agentDir = "/home/testuser/test-project/agents/missing-cred-agent";
    await context.executeInContainer(container, [
      "bash", "-c", `mkdir -p ${agentDir}`,
    ]);

    await context.executeInContainer(container, [
      "bash", "-c", `cat > ${agentDir}/SKILL.md << 'EOF'
---
description: "Agent that references a missing credential"
---

# Missing Credential Agent

This agent references a credential that does not exist on this host.
EOF`,
    ]);

    // Reference a credential ("nonexistent_secret") that was never written to disk
    await context.executeInContainer(container, [
      "bash", "-c", `cat > ${agentDir}/config.toml << 'EOF'
models = ["sonnet"]
credentials = ["nonexistent_secret"]
schedule = "0 */6 * * *"
EOF`,
    ]);

    await context.executeInContainer(container, [
      "bash", "-c", `chown -R testuser:testuser ${agentDir}`,
    ]);

    // Start the scheduler — it should detect the missing credential during
    // validateAndDiscover() and exit promptly with a non-zero status code.
    await context.executeInContainer(container, [
      "bash", "-c",
      "cd /home/testuser/test-project && al start --headless > /tmp/scheduler.log 2>&1; echo \"exit:$?\" >> /tmp/scheduler.log",
    ]);

    // Give the process a moment to write its final log lines
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const logs = await getSchedulerLogs(context, container);

    // The scheduler must have exited (the exit code line was appended above)
    expect(logs).toMatch(/exit:[1-9]/);

    // The log output must mention the missing credential so the user knows
    // what went wrong — matches the CredentialError message from credentials.ts
    expect(logs).toMatch(/nonexistent_secret/);
    expect(logs).toMatch(/not found|Credential/i);
  });

  it("exits gracefully with AgentError when Docker daemon is unavailable", async () => {
    const context = getTestContext();
    const container = await setupLocalActionLlama(context);

    // Create a minimal agent so the scheduler doesn't fail on "no agents found"
    const agentDir = "/home/testuser/test-project/agents/docker-test-agent";
    await context.executeInContainer(container, [
      "bash", "-c", `mkdir -p ${agentDir}`,
    ]);
    await context.executeInContainer(container, [
      "bash", "-c", `cat > ${agentDir}/SKILL.md << 'EOF'
---
description: "Agent used to test Docker unavailability"
---

# Docker Test Agent

This agent is used to verify the scheduler exits gracefully when Docker is unavailable.
EOF`,
    ]);
    await context.executeInContainer(container, [
      "bash", "-c", `cat > ${agentDir}/config.toml << 'EOF'
models = ["sonnet"]
credentials = ["github_token", "anthropic_key"]
schedule = "0 */6 * * *"
EOF`,
    ]);
    await context.executeInContainer(container, [
      "bash", "-c", `chown -R testuser:testuser ${agentDir}`,
    ]);

    // Shadow the `docker` binary with a wrapper that always fails.
    // The scheduler calls `docker info` via execFileSync to verify Docker is running.
    // By replacing docker with a failing stub we simulate Docker being unavailable.
    await context.executeInContainer(container, [
      "bash", "-c",
      "mkdir -p /tmp/fake-bin && printf '#!/bin/sh\\necho \"Cannot connect to the Docker daemon\" >&2\\nexit 1\\n' > /tmp/fake-bin/docker && chmod +x /tmp/fake-bin/docker",
    ]);

    // Run the scheduler with the fake docker first in PATH so it picks up the stub.
    // The scheduler should detect the failure in createContainerRuntime() and exit.
    await context.executeInContainer(container, [
      "bash", "-c",
      "cd /home/testuser/test-project && PATH=/tmp/fake-bin:$PATH al start --headless > /tmp/scheduler.log 2>&1; echo \"exit:$?\" >> /tmp/scheduler.log",
    ]);

    // Give the process a brief moment to flush its final log lines
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const logs = await getSchedulerLogs(context, container);

    // The process must have exited with a non-zero code
    expect(logs).toMatch(/exit:[1-9]/);

    // The error message from createContainerRuntime must appear in the logs
    expect(logs).toMatch(/Docker is not running|Docker/i);
  });

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

  it("schedules multiple agents independently with different cron expressions", async () => {
    const context = getTestContext();
    const container = await setupLocalActionLlama(context);

    // Create three agents:
    //   alpha-agent  — fires every second ("* * * * * *") — should fire quickly
    //   beta-agent   — fires every second ("* * * * * *") — should fire independently
    //   gamma-agent  — fires only on Jan 1 2099 — should never fire during the test

    for (const { name, schedule } of [
      { name: "alpha-agent", schedule: "* * * * * *" },
      { name: "beta-agent", schedule: "* * * * * *" },
      { name: "gamma-agent", schedule: "0 0 1 1 *" },
    ]) {
      const agentDir = `/home/testuser/test-project/agents/${name}`;
      await context.executeInContainer(container, [
        "bash", "-c", `mkdir -p ${agentDir}`,
      ]);
      await context.executeInContainer(container, [
        "bash", "-c", `cat > ${agentDir}/SKILL.md << 'EOF'
---
description: "Multi-agent scheduling test agent"
---

# ${name}

You are ${name}, a test agent for multi-agent scheduling verification.
EOF`,
      ]);
      await context.executeInContainer(container, [
        "bash", "-c", `cat > ${agentDir}/config.toml << 'EOF'
models = ["sonnet"]
credentials = ["github_token", "anthropic_key"]
schedule = "${schedule}"
EOF`,
      ]);
      await context.executeInContainer(container, [
        "bash", "-c", `chown -R testuser:testuser ${agentDir}`,
      ]);
    }

    // Start the scheduler with coverage instrumentation
    await startActionLlamaScheduler(context, container, { coverage: true });

    // Verify all three agents appear in "al stat" output — each with a cron trigger
    const statOutput = await context.executeInContainer(container, [
      "bash", "-c", "cd /home/testuser/test-project && al stat",
    ]);
    expect(statOutput).toContain("alpha-agent");
    expect(statOutput).toContain("beta-agent");
    expect(statOutput).toContain("gamma-agent");
    // All schedule-driven agents should show a "cron" trigger type
    expect(statOutput).toMatch(/cron/);

    // Wait up to 60 seconds for both fast-schedule agents to fire independently.
    // Each successful cron dispatch is logged as "<name>: running (schedule)".
    let alphaFired = false;
    let betaFired = false;
    for (let i = 0; i < 60; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const logs = await getSchedulerLogs(context, container);
      if (logs.includes("alpha-agent: running")) alphaFired = true;
      if (logs.includes("beta-agent: running")) betaFired = true;
      if (alphaFired && betaFired) break;
    }

    // Both every-second agents must have fired during the observation window
    expect(alphaFired).toBe(true);
    expect(betaFired).toBe(true);

    // The future-scheduled agent must NOT have fired
    const finalLogs = await getSchedulerLogs(context, container);
    expect(finalLogs).not.toContain("gamma-agent: running");

    await stopActionLlamaScheduler(context, container);
  });

  it("kills agent container after timeout expires", async () => {
    const context = getTestContext();
    const container = await setupLocalActionLlama(context);

    // Create an agent whose pre-hook sleeps for 60 seconds but whose timeout
    // is set to just 5 seconds. The host-side waitForExit timer should kill
    // the container before the sleep completes, and the scheduler logs should
    // record a timeout/error state for the agent.
    const agentDir = "/home/testuser/test-project/agents/timeout-agent";
    await context.executeInContainer(container, [
      "bash", "-c", `mkdir -p ${agentDir}`,
    ]);

    await context.executeInContainer(container, [
      "bash", "-c", `cat > ${agentDir}/SKILL.md << 'EOF'
---
description: "Timeout enforcement test agent"
---

# Timeout Agent

You are a test agent for timeout enforcement. This agent's pre-hook sleeps longer than the configured timeout.
EOF`,
    ]);

    // timeout = 5 seconds; pre-hook sleeps 60 seconds; schedule fires every second.
    // The Docker container will be killed by the host after 5 seconds.
    await context.executeInContainer(container, [
      "bash", "-c", `cat > ${agentDir}/config.toml << 'EOF'
models = ["sonnet"]
credentials = ["github_token", "anthropic_key"]
schedule = "* * * * * *"
timeout = 5

[hooks]
pre = ["sleep 60"]
EOF`,
    ]);

    await context.executeInContainer(container, [
      "bash", "-c", `chown -R testuser:testuser ${agentDir}`,
    ]);

    // Start the scheduler with coverage instrumentation.
    await startActionLlamaScheduler(context, container, { coverage: true });

    // Wait up to 90 seconds for:
    //   1. The cron to fire timeout-agent ("running")
    //   2. The pre-hook sleep to be interrupted by the timeout after 5 seconds
    //   3. The scheduler to log the resulting error state
    let agentStarted = false;
    let agentTimedOut = false;

    for (let i = 0; i < 90; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const logs = await getSchedulerLogs(context, container);

      if (!agentStarted && logs.includes("timeout-agent: running")) {
        agentStarted = true;
      }

      // After a timeout, the plain logger emits "timeout-agent: error: <message>"
      // where the message includes "timed out" from the Docker waitForExit rejection.
      if (agentStarted && (logs.includes("timeout-agent: error") || logs.match(/timeout-agent.*timed out/i))) {
        agentTimedOut = true;
        break;
      }
    }

    // The agent must have started (cron fired)
    expect(agentStarted).toBe(true);
    // The agent must have been killed (timeout enforced)
    expect(agentTimedOut).toBe(true);

    // Confirm the final log shows the error state, not a clean completion.
    const finalLogs = await getSchedulerLogs(context, container);
    // The scheduler should NOT log "timeout-agent: completed" — only an error.
    expect(finalLogs).not.toMatch(/timeout-agent: completed/);

    await stopActionLlamaScheduler(context, container);
  });

  it("loads built-in extensions on scheduler startup", async () => {
    const context = getTestContext();
    const container = await setupLocalActionLlama(context);

    // Create a minimal agent so the scheduler has something to manage
    await createTestAgent(context, container, "ext-test-agent", `
# Extension Loading Test Agent

You are a test agent for verifying extension loading.
`);

    // Start the scheduler with coverage enabled
    await startActionLlamaScheduler(context, container, { coverage: true });

    // After startActionLlamaScheduler returns, the scheduler is running.
    // The plain-logger writes a "scheduler started" line to stdout once the
    // scheduler is fully initialised (extensions loaded, cron jobs registered).
    // Verify that stdout contains this startup confirmation.
    const stdoutLogs = await getSchedulerLogs(context, container);

    // "scheduler started" only appears after extension loading and cron setup
    expect(stdoutLogs).toMatch(/scheduler started/);

    // Additionally verify the pino log file was created under .al/logs/
    const today = new Date().toISOString().slice(0, 10);
    const logFile = `/home/testuser/test-project/.al/logs/scheduler-${today}.log`;
    const logFileExists = await context.executeInContainer(container, [
      "bash",
      "-c",
      `test -f ${logFile} && echo "exists" || echo "missing"`,
    ]);
    expect(logFileExists.trim()).toBe("exists");

    await stopActionLlamaScheduler(context, container);
  });

  it("al mcp init creates .mcp.json with action-llama server entry", async () => {
    const context = getTestContext();
    const container = await setupLocalActionLlama(context);

    // Run al mcp init in the test project directory
    const initOutput = await context.executeInContainer(container, [
      "bash",
      "-c",
      "cd /home/testuser/test-project && al mcp init",
    ]);

    // Verify the command reported success
    expect(initOutput).toContain(".mcp.json");

    // Verify the .mcp.json file was created
    const mcpJsonExists = await context.executeInContainer(container, [
      "bash",
      "-c",
      "test -f /home/testuser/test-project/.mcp.json && echo 'exists' || echo 'missing'",
    ]);
    expect(mcpJsonExists.trim()).toBe("exists");

    // Parse and verify the content of .mcp.json
    const mcpJsonContent = await context.executeInContainer(container, [
      "cat",
      "/home/testuser/test-project/.mcp.json",
    ]);
    const mcpJson = JSON.parse(mcpJsonContent);

    // Must have mcpServers key with action-llama entry
    expect(mcpJson).toHaveProperty("mcpServers");
    expect(mcpJson.mcpServers).toHaveProperty("action-llama");

    const entry = mcpJson.mcpServers["action-llama"];
    expect(entry.command).toBe("al");
    expect(Array.isArray(entry.args)).toBe(true);
    expect(entry.args).toContain("mcp");
    expect(entry.args).toContain("serve");
  });

  it("al mcp init is idempotent — running it twice overwrites existing entry", async () => {
    const context = getTestContext();
    const container = await setupLocalActionLlama(context);

    // Run al mcp init twice
    await context.executeInContainer(container, [
      "bash",
      "-c",
      "cd /home/testuser/test-project && al mcp init",
    ]);
    const secondOutput = await context.executeInContainer(container, [
      "bash",
      "-c",
      "cd /home/testuser/test-project && al mcp init",
    ]);

    // Second run should note it is overwriting
    expect(secondOutput).toMatch(/already has|Overwrit/i);

    // File must still be valid JSON with the action-llama entry
    const mcpJsonContent = await context.executeInContainer(container, [
      "cat",
      "/home/testuser/test-project/.mcp.json",
    ]);
    const mcpJson = JSON.parse(mcpJsonContent);
    expect(mcpJson.mcpServers["action-llama"]).toBeDefined();
    expect(mcpJson.mcpServers["action-llama"].command).toBe("al");
  });

  it("al mcp serve responds to MCP initialize request with expected tools", async () => {
    const context = getTestContext();
    const container = await setupLocalActionLlama(context);

    // Send the MCP initialize request to al mcp serve over stdin/stdout.
    // The MCP protocol uses newline-delimited JSON-RPC 2.0 messages.
    // We pipe a single initialize message and read the response.
    const initRequest = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "e2e-test", version: "1.0" },
      },
    });

    // Run al mcp serve, send the initialize message, then close stdin and read stdout.
    // We use a 10-second timeout to avoid hanging.
    const output = await context.executeInContainer(container, [
      "bash",
      "-c",
      `cd /home/testuser/test-project && echo '${initRequest}' | timeout 10 al mcp serve 2>/dev/null || true`,
    ]);

    // The response must be valid JSON-RPC with a result
    // al mcp serve writes newline-delimited JSON to stdout
    const lines = output
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("{"));

    expect(lines.length).toBeGreaterThan(0);

    const response = JSON.parse(lines[0]);
    expect(response.jsonrpc).toBe("2.0");
    expect(response.id).toBe(1);
    expect(response).toHaveProperty("result");
    expect(response.result).toHaveProperty("capabilities");
    expect(response.result).toHaveProperty("serverInfo");
    expect(response.result.serverInfo.name).toBe("action-llama");
  });

  it("al mcp serve lists expected tools via tools/list request", async () => {
    const context = getTestContext();
    const container = await setupLocalActionLlama(context);

    // Send initialize followed by tools/list — both newline-delimited
    const initRequest = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "e2e-test", version: "1.0" },
      },
    });
    const toolsListRequest = JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });

    const messages = `${initRequest}\n${toolsListRequest}`;

    const output = await context.executeInContainer(container, [
      "bash",
      "-c",
      `cd /home/testuser/test-project && printf '%s\\n' '${initRequest}' '${toolsListRequest}' | timeout 10 al mcp serve 2>/dev/null || true`,
    ]);

    // Parse all JSON lines from the output
    const lines = output
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("{"));

    expect(lines.length).toBeGreaterThanOrEqual(2);

    // Find the tools/list response (id: 2)
    const toolsResponse = lines
      .map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      })
      .filter((r) => r !== null && r.id === 2)[0];

    expect(toolsResponse).toBeDefined();
    expect(toolsResponse.result).toHaveProperty("tools");
    expect(Array.isArray(toolsResponse.result.tools)).toBe(true);

    // Verify core action-llama tools are registered
    const toolNames = toolsResponse.result.tools.map(
      (t: { name: string }) => t.name,
    );
    expect(toolNames).toContain("al_start");
    expect(toolNames).toContain("al_stop");
    expect(toolNames).toContain("al_status");
    expect(toolNames).toContain("al_agents");
    expect(toolNames).toContain("al_run");
    expect(toolNames).toContain("al_logs");
  });
});
