import { E2ETestContext, ContainerInfo } from "../harness.js";
import path from "path";

export async function setupLocalActionLlama(context: E2ETestContext): Promise<ContainerInfo> {
  const containerInfo = await context.createLocalActionLlamaContainer();
  
  // Initialize a test project inside the container
  // Note: Since al new is interactive, we need to create the project structure manually for e2e tests
  await context.executeInContainer(containerInfo, [
    "mkdir", "-p", "/home/testuser/test-project"
  ]);
  
  // Create a minimal project configuration
  await context.executeInContainer(containerInfo, [
    "bash", "-c", `cat > /home/testuser/test-project/config.toml << 'EOF'
[models.sonnet]
provider = "anthropic"
model = "claude-3-5-sonnet-20241022"
authType = "api_key"
EOF`
  ]);

  // Create package.json (required by al push for npm install on VPS)
  // Use "next" dist-tag so the VPS installs the same version we're testing
  await context.executeInContainer(containerInfo, [
    "bash", "-c", `cat > /home/testuser/test-project/package.json << 'EOF'
{
  "name": "test-project",
  "private": true,
  "type": "module",
  "dependencies": {
    "@action-llama/action-llama": "next"
  }
}
EOF`
  ]);
  
  // Set up mock credentials for testing
  await context.executeInContainer(containerInfo, [
    "bash", "-c", "mkdir -p ~/.action-llama/credentials/github_token/default"
  ]);

  await context.executeInContainer(containerInfo, [
    "bash", "-c", "echo 'mock-token' > ~/.action-llama/credentials/github_token/default/token"
  ]);

  await context.executeInContainer(containerInfo, [
    "bash", "-c", "mkdir -p ~/.action-llama/credentials/anthropic_key/default"
  ]);

  await context.executeInContainer(containerInfo, [
    "bash", "-c", "echo 'mock-key' > ~/.action-llama/credentials/anthropic_key/default/token"
  ]);
  
  return containerInfo;
}

export async function createTestAgent(
  context: E2ETestContext,
  containerInfo: ContainerInfo,
  agentName: string,
  skill: string
): Promise<void> {
  // Agents live under <project>/agents/<name>/
  const agentDir = `/home/testuser/test-project/agents/${agentName}`;

  await context.executeInContainer(containerInfo, [
    "bash", "-c", `mkdir -p ${agentDir}`
  ]);

  // Write SKILL.md with portable fields only (runtime fields are in config.toml)
  const skillContent = `---
description: "E2E test agent"
---

${skill}`;

  await context.executeInContainer(containerInfo, [
    "bash", "-c", `cat > ${agentDir}/SKILL.md << 'EOF'
${skillContent}
EOF`
  ]);

  // Write per-agent config.toml with runtime fields (models, credentials, schedule)
  await context.executeInContainer(containerInfo, [
    "bash", "-c", `cat > ${agentDir}/config.toml << 'EOF'
models = ["sonnet"]
credentials = ["github_token", "anthropic_key"]
schedule = "0 */6 * * *"
EOF`
  ]);

  // Verify the agent was created properly
  const agentFiles = await context.executeInContainer(containerInfo, [
    "ls", "-la", agentDir
  ]);

  if (!agentFiles.includes("SKILL.md")) {
    throw new Error(`Failed to create agent ${agentName}: SKILL.md not found`);
  }

  // Ensure correct ownership and permissions
  await context.executeInContainer(containerInfo, [
    "bash", "-c", `chown -R testuser:testuser ${agentDir}`
  ]);
}

export async function startActionLlamaScheduler(
  context: E2ETestContext,
  containerInfo: ContainerInfo,
  opts?: { coverage?: boolean }
): Promise<void> {
  // Ensure we're in the correct directory and verify project structure
  const projectCheck = await context.executeInContainer(containerInfo, [
    "bash", "-c", "cd /home/testuser/test-project && ls -la"
  ]);
  
  if (!projectCheck.includes("config.toml")) {
    throw new Error("Project configuration not found before starting scheduler");
  }

  // Create default test agent if none exist (agents live under agents/ subdir)
  const projectPath = "/home/testuser/test-project";
  const agentExists = await context.executeInContainer(containerInfo, [
    "bash", "-c", `test -d ${projectPath}/agents && ls ${projectPath}/agents/ 2>/dev/null | head -1 | grep -q . && echo "exists" || echo "missing"`
  ]);

  if (agentExists.includes("missing")) {
    await context.executeInContainer(containerInfo, [
      "bash", "-c", `mkdir -p ${projectPath}/agents/test-agent`
    ]);

    const defaultSkill = `---
description: "Default test agent for E2E testing"
---

# Default Test Agent

You are a default test agent created for E2E testing. You help verify that the Action Llama scheduler can find and manage agents properly.`;

    await context.executeInContainer(containerInfo, [
      "bash", "-c", `cat > ${projectPath}/agents/test-agent/SKILL.md << 'EOF'
${defaultSkill}
EOF`
    ]);

    // Write per-agent config.toml with runtime fields
    await context.executeInContainer(containerInfo, [
      "bash", "-c", `cat > ${projectPath}/agents/test-agent/config.toml << 'EOF'
models = ["sonnet"]
credentials = ["github_token", "anthropic_key"]
schedule = "0 */6 * * *"
EOF`
    ]);

    await context.executeInContainer(containerInfo, [
      "bash", "-c", `chown -R testuser:testuser ${projectPath}/agents`
    ]);
  }

  // Start the scheduler in the background with --headless to avoid TUI/raw mode
  // When coverage is enabled (AL_COVERAGE=1 or opts.coverage), wrap with c8
  const enableCoverage = opts?.coverage || process.env.AL_COVERAGE === "1";
  const alCmd = enableCoverage
    ? "c8 --reporter=json --reporter=text --report-dir=/tmp/coverage al start --headless"
    : "al start --headless";

  await context.executeInContainer(containerInfo, [
    "bash", "-c", `cd /home/testuser/test-project && nohup ${alCmd} > /tmp/scheduler.log 2>&1 & echo $! > /tmp/scheduler.pid`
  ]);
  
  // Wait for scheduler to start and verify it's running
  let attempts = 0;
  const maxAttempts = 10;
  
  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    try {
      // Check if the scheduler process is still running
      const pidCheck = await context.executeInContainer(containerInfo, [
        "bash", "-c", "if [ -f /tmp/scheduler.pid ]; then ps -p $(cat /tmp/scheduler.pid) > /dev/null 2>&1 && echo 'running' || echo 'not running'; else echo 'no pid file'; fi"
      ]);

      if (pidCheck.includes("running")) {
        // Additional verification that scheduler is responding
        const statusCheck = await context.executeInContainer(containerInfo, [
          "bash", "-c", "cd /home/testuser/test-project && al stat 2>&1 || echo 'stat failed'"
        ]);

        if (!statusCheck.includes("stat failed")) {
          return; // Scheduler is running properly
        }
      }
    } catch {
      // Continue trying
    }
    
    attempts++;
  }
  
  // If we get here, the scheduler didn't start properly
  const logs = await getSchedulerLogs(context, containerInfo);
  throw new Error(`Scheduler failed to start properly after ${maxAttempts} attempts. Logs: ${logs}`);
}

export async function stopActionLlamaScheduler(
  context: E2ETestContext,
  containerInfo: ContainerInfo
): Promise<void> {
  try {
    // Send SIGTERM for graceful shutdown (allows c8 to write coverage reports)
    await context.executeInContainer(containerInfo, [
      "bash", "-c", "if [ -f /tmp/scheduler.pid ]; then kill $(cat /tmp/scheduler.pid); fi"
    ]);

    // Wait for the process to exit (up to 15 seconds)
    for (let i = 0; i < 15; i++) {
      try {
        const check = await context.executeInContainer(containerInfo, [
          "bash", "-c", "if [ -f /tmp/scheduler.pid ]; then ps -p $(cat /tmp/scheduler.pid) > /dev/null 2>&1 && echo 'running' || echo 'stopped'; else echo 'stopped'; fi"
        ]);
        if (check.includes("stopped")) break;
      } catch {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Clean up pid file
    await context.executeInContainer(containerInfo, [
      "bash", "-c", "rm -f /tmp/scheduler.pid"
    ]);
  } catch {
    // Process might already be dead
  }
}

/**
 * Extract coverage data from the container to a host directory.
 * Call after stopActionLlamaScheduler when coverage is enabled.
 * Returns the path to the extracted coverage directory, or null if no coverage data.
 */
export async function extractCoverageFromContainer(
  context: E2ETestContext,
  containerInfo: ContainerInfo,
  hostDir: string
): Promise<string | null> {
  try {
    // Check if coverage data exists
    const check = await context.executeInContainer(containerInfo, [
      "bash", "-c", "test -d /tmp/coverage && ls /tmp/coverage/ | head -1 | grep -q . && echo 'exists' || echo 'missing'"
    ]);

    if (check.includes("missing")) {
      return null;
    }

    // Extract coverage via tar through the container
    await context.extractFromContainer(containerInfo, "/tmp/coverage", hostDir);
    return hostDir;
  } catch (error: any) {
    console.warn(`Failed to extract coverage from container: ${error.message}`);
    return null;
  }
}

export async function getSchedulerLogs(
  context: E2ETestContext,
  containerInfo: ContainerInfo
): Promise<string> {
  try {
    return await context.executeInContainer(containerInfo, [
      "cat", "/tmp/scheduler.log"
    ]);
  } catch {
    return "No scheduler logs available";
  }
}

export async function runSingleAgent(
  context: E2ETestContext,
  containerInfo: ContainerInfo,
  agentName: string
): Promise<string> {
  // First verify the agent exists and the project structure is correct
  try {
    const projectContents = await context.executeInContainer(containerInfo, [
      "bash", "-c", "cd /home/testuser/test-project && find . -name 'SKILL.md' -o -name 'config.toml'"
    ]);
    
    if (!projectContents.includes(`agents/${agentName}/SKILL.md`)) {
      throw new Error(`Agent ${agentName} not found in project. Found files: ${projectContents}`);
    }
    
    // Check if AL can see the agent
    const alStatus = await context.executeInContainer(containerInfo, [
      "bash", "-c", `cd /home/testuser/test-project && al stat || echo "al stat failed"`
    ]);
    
    // Run the agent with explicit error handling
    return await context.executeInContainer(containerInfo, [
      "bash", "-c", `cd /home/testuser/test-project && al run ${agentName} 2>&1`
    ]);
  } catch (error: any) {
    // Provide better error context for debugging
    let debugInfo = "";
    try {
      const workingDir = await context.executeInContainer(containerInfo, [
        "bash", "-c", "pwd && ls -la /home/testuser/test-project"
      ]);
      debugInfo += `Working directory: ${workingDir}\n`;
      
      const alVersion = await context.executeInContainer(containerInfo, [
        "bash", "-c", "al --version || echo 'al not found'"
      ]);
      debugInfo += `AL version: ${alVersion}\n`;
    } catch {
      debugInfo = "Could not gather debug info";
    }
    
    throw new Error(`Failed to run agent ${agentName}: ${error.message}\nDebug info: ${debugInfo}`);
  }
}