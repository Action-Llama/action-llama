import { E2ETestContext, ContainerInfo } from "../harness.js";

export async function setupVPS(context: E2ETestContext): Promise<ContainerInfo> {
  const containerInfo = await context.createVPSContainer();
  
  // Install Action Llama on the VPS
  await context.executeSSHCommand(containerInfo, "curl -fsSL https://get.docker.com -o get-docker.sh && sh get-docker.sh");
  await context.executeSSHCommand(containerInfo, "dockerd &");
  
  // Wait for Docker daemon to start
  await new Promise(resolve => setTimeout(resolve, 10000));
  
  // Install Node.js
  await context.executeSSHCommand(containerInfo, "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -");
  await context.executeSSHCommand(containerInfo, "apt-get install -y nodejs");
  
  // Install Action Llama
  await context.executeSSHCommand(containerInfo, "npm install -g @action-llama/action-llama@next");
  
  return containerInfo;
}

export async function deployToVPS(
  context: E2ETestContext,
  localContainer: ContainerInfo,
  vpsContainer: ContainerInfo,
  envName: string
): Promise<void> {
  if (!vpsContainer.ipAddress) {
    throw new Error("VPS container IP not available");
  }
  
  // Create environment config in local container
  const envConfig = `[${envName}]
type = "vps"
host = "${vpsContainer.ipAddress}"
user = "root"
keyPath = "${context.getPrivateKeyPath()}"`;
  
  await context.executeInContainer(localContainer, [
    "bash", "-c", `cat > /home/testuser/test-project/.env.toml << 'EOF'
${envConfig}
EOF`
  ]);
  
  // Deploy to VPS
  await context.executeInContainer(localContainer, [
    "bash", "-c", `cd /home/testuser/test-project && al push --env ${envName}`
  ]);
}

export async function checkDeploymentOnVPS(
  context: E2ETestContext,
  vpsContainer: ContainerInfo,
  expectedAgents: string[]
): Promise<boolean> {
  try {
    // Check if deployment directory exists
    const deploymentPath = await context.executeSSHCommand(
      vpsContainer,
      "ls -la /opt/action-llama/ 2>/dev/null || echo 'not found'"
    );
    
    if (deploymentPath.includes("not found")) {
      return false;
    }
    
    // Check if expected agents are deployed
    for (const agent of expectedAgents) {
      const agentPath = await context.executeSSHCommand(
        vpsContainer,
        `ls -la /opt/action-llama/agents/${agent}/ 2>/dev/null || echo 'not found'`
      );
      
      if (agentPath.includes("not found")) {
        return false;
      }
    }
    
    // Check if systemd service is running
    const serviceStatus = await context.executeSSHCommand(
      vpsContainer,
      "systemctl is-active action-llama 2>/dev/null || echo 'inactive'"
    );
    
    return serviceStatus.includes("active");
  } catch {
    return false;
  }
}

export async function getVPSLogs(
  context: E2ETestContext,
  vpsContainer: ContainerInfo
): Promise<string> {
  try {
    return await context.executeSSHCommand(
      vpsContainer,
      "journalctl -u action-llama --no-pager -n 100"
    );
  } catch {
    return "No VPS logs available";
  }
}

export async function updateDeploymentOnVPS(
  context: E2ETestContext,
  localContainer: ContainerInfo,
  vpsContainer: ContainerInfo,
  envName: string,
  agentName: string,
  newSkill: string
): Promise<void> {
  // Update agent locally
  const skillContent = `---
model: claude-3-5-sonnet-20241022
credentials:
  github: default
  anthropic: default
schedule: "0 */6 * * *"
---

${newSkill}`;
  
  await context.executeInContainer(localContainer, [
    "bash", "-c", `cat > /home/testuser/test-project/${agentName}/SKILL.md << 'EOF'
${skillContent}
EOF`
  ]);
  
  // Redeploy to VPS
  await context.executeInContainer(localContainer, [
    "bash", "-c", `cd /home/testuser/test-project && al push --env ${envName}`
  ]);
  
  // Wait for deployment to complete
  await new Promise(resolve => setTimeout(resolve, 10000));
}