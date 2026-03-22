import { E2ETestContext, ContainerInfo } from "../harness.js";
import path from "path";

export async function setupLocalActionLlama(context: E2ETestContext): Promise<ContainerInfo> {
  const containerInfo = await context.createLocalActionLlamaContainer();
  
  // Initialize a test project inside the container
  await context.executeInContainer(containerInfo, [
    "al", "new", "test-project", "--no-interactive"
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
    "bash", "-c", `mkdir -p /app/test-project/${agentName}`
  ]);
  
  // Write SKILL.md
  const skillContent = `---
model: claude-3-5-sonnet-20241022
credentials:
  github: default
  anthropic: default
schedule: "0 */6 * * *"
---

${skill}`;
  
  await context.executeInContainer(containerInfo, [
    "bash", "-c", `cat > /app/test-project/${agentName}/SKILL.md << 'EOF'
${skillContent}
EOF`
  ]);
}

export async function startActionLlamaScheduler(
  context: E2ETestContext,
  containerInfo: ContainerInfo
): Promise<void> {
  // Start the scheduler in the background
  await context.executeInContainer(containerInfo, [
    "bash", "-c", "cd /app/test-project && nohup al start > /tmp/scheduler.log 2>&1 & echo $! > /tmp/scheduler.pid"
  ]);
  
  // Wait a bit for scheduler to start
  await new Promise(resolve => setTimeout(resolve, 5000));
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
  return await context.executeInContainer(containerInfo, [
    "bash", "-c", `cd /app/test-project && al run ${agentName}`
  ]);
}