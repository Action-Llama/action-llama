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
  // Create project.toml for consistency with scheduler expectations
  await context.executeInContainer(containerInfo, [
    "bash", "-c", `cat > /home/testuser/test-project/project.toml << 'EOF'
[models.sonnet]
provider = "anthropic"
model = "claude-3-5-sonnet-20241022"

[global]
# Default model configuration can be specified here if needed
EOF`
  ]);
  
  // Set up mock credentials for testing
  await context.executeInContainer(containerInfo, [
    "bash", "-c", "mkdir -p ~/.action-llama/credentials/github/default"
  ]);
  
  await context.executeInContainer(containerInfo, [
    "bash", "-c", "echo 'mock-token' > ~/.action-llama/credentials/github/default/token"
  ]);
  
  await context.executeInContainer(containerInfo, [
    "bash", "-c", "mkdir -p ~/.action-llama/credentials/anthropic/default"
  ]);
  
  await context.executeInContainer(containerInfo, [
    "bash", "-c", "echo 'mock-key' > ~/.action-llama/credentials/anthropic/default/apiKey"
  ]);
  
  return containerInfo;
}

export async function createTestAgent(
  context: E2ETestContext,
  containerInfo: ContainerInfo,
  agentName: string,
  skill: string
): Promise<void> {
  // Create agent directory
  await context.executeInContainer(containerInfo, [
    "bash", "-c", `mkdir -p /home/testuser/test-project/${agentName}`
  ]);
  
  // Write SKILL.md
  // Reference the model name defined in config.toml
  const skillContent = `---
model: sonnet
credentials:
  github: default
  anthropic: default
schedule: "0 */6 * * *"
---

${skill}`;
  
  await context.executeInContainer(containerInfo, [
    "bash", "-c", `cat > /home/testuser/test-project/${agentName}/SKILL.md << 'EOF'
${skillContent}
EOF`
  ]);
  
  // Create agent-config.json if it doesn't exist (some AL versions expect this)
  await context.executeInContainer(containerInfo, [
    "bash", "-c", `cat > /home/testuser/test-project/${agentName}/agent-config.json << 'EOF'
{
  "name": "${agentName}",
  "model": "claude-3-5-sonnet-20241022",
  "schedule": "0 */6 * * *"
}
EOF`
  ]);
  
  // Verify the agent was created properly
  const agentFiles = await context.executeInContainer(containerInfo, [
    "ls", "-la", `/home/testuser/test-project/${agentName}/`
  ]);
  
  if (!agentFiles.includes("SKILL.md")) {
    throw new Error(`Failed to create agent ${agentName}: SKILL.md not found`);
  }
  
  // Ensure correct ownership and permissions
  await context.executeInContainer(containerInfo, [
    "bash", "-c", `chown -R testuser:testuser /home/testuser/test-project/${agentName}`
  ]);
}

export async function startActionLlamaScheduler(
  context: E2ETestContext,
  containerInfo: ContainerInfo
): Promise<void> {
  // Ensure we're in the correct directory and verify project structure
  const projectCheck = await context.executeInContainer(containerInfo, [
    "bash", "-c", "cd /home/testuser/test-project && ls -la"
  ]);
  
  if (!projectCheck.includes("project.toml")) {
    throw new Error("Project configuration not found before starting scheduler");
  }
  
  // Start the scheduler in the background
  await context.executeInContainer(containerInfo, [
    "bash", "-c", "cd /home/testuser/test-project && nohup al start > /tmp/scheduler.log 2>&1 & echo $! > /tmp/scheduler.pid"
  ]);
  
  // Wait for scheduler to start and verify it's running
  let attempts = 0;
  const maxAttempts = 10;
  
  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    try {
      // Check if the scheduler process is still running
      const pidCheck = await context.executeInContainer(containerInfo, [
        "bash", "-c", "if [ -f /tmp/scheduler.pid ]; then ps -p $(cat /tmp/scheduler.pid) > /dev/null && echo 'running' || echo 'not running'; else echo 'no pid file'; fi"
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
    // Kill the scheduler process
    await context.executeInContainer(containerInfo, [
      "bash", "-c", "if [ -f /tmp/scheduler.pid ]; then kill $(cat /tmp/scheduler.pid); rm /tmp/scheduler.pid; fi"
    ]);
  } catch {
    // Process might already be dead
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
      "bash", "-c", "cd /home/testuser/test-project && find . -name 'SKILL.md' -o -name 'project.toml'"
    ]);
    
    if (!projectContents.includes(`${agentName}/SKILL.md`)) {
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