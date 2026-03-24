import { E2ETestContext, ContainerInfo } from "../harness.js";

export async function setupVPS(context: E2ETestContext): Promise<ContainerInfo> {
  const containerInfo = await context.createVPSContainer();

  // Docker and Node.js are already installed via the Dockerfile.
  // Install Action Llama on the VPS so it's available for deployment verification.
  await context.executeSSHCommand(containerInfo, "npm install -g @action-llama/action-llama@next || true");

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

  // Write the SSH private key into the local container so `al push` can use it
  const pubKey = context.getPublicKey();
  await context.executeInContainer(localContainer, [
    "bash", "-c", "mkdir -p /home/testuser/.ssh && chmod 700 /home/testuser/.ssh"
  ]);

  // Copy the private key into the container (we can't bind-mount mid-test)
  // The harness exposes the raw key content via getPrivateKeyPath, but that's a host path.
  // Instead, use executeInContainer to write it directly.
  await context.executeInContainer(localContainer, [
    "bash", "-c", `cat > /home/testuser/.ssh/e2e_deploy_key << 'KEYEOF'
${await context.getPrivateKeyContent()}
KEYEOF
chmod 600 /home/testuser/.ssh/e2e_deploy_key`
  ]);

  // Create the environment file at ~/.action-llama/environments/<envName>.toml
  const envConfig = `[server]
host = "${vpsContainer.ipAddress}"
user = "root"
port = 22
keyPath = "/home/testuser/.ssh/e2e_deploy_key"
basePath = "/opt/action-llama"`;

  await context.executeInContainer(localContainer, [
    "bash", "-c", `mkdir -p /home/testuser/.action-llama/environments`
  ]);

  await context.executeInContainer(localContainer, [
    "bash", "-c", `cat > /home/testuser/.action-llama/environments/${envName}.toml << 'EOF'
${envConfig}
EOF`
  ]);

  // Create .env.toml binding the project to the environment
  await context.executeInContainer(localContainer, [
    "bash", "-c", `cat > /home/testuser/test-project/.env.toml << 'EOF'
environment = "${envName}"
EOF`
  ]);

  // Deploy to VPS
  const pushOutput = await context.executeInContainer(localContainer, [
    "bash", "-c", `cd /home/testuser/test-project && al push --env ${envName} --headless --no-creds 2>&1 || echo "AL_PUSH_FAILED_EXIT_$?"`
  ]);
  console.log(`al push output: ${pushOutput}`);
  if (pushOutput.includes("AL_PUSH_FAILED_EXIT_")) {
    throw new Error(`al push failed: ${pushOutput}`);
  }
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
        `ls -la /opt/action-llama/project/agents/${agent}/ 2>/dev/null || echo 'not found'`
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

/**
 * Deploy to VPS with a Cloudflare hostname configured, which triggers nginx SPA setup.
 * Pre-creates mock TLS certificates on the VPS so `setupNginx` can copy them.
 */
export async function deployToVPSWithDashboard(
  context: E2ETestContext,
  localContainer: ContainerInfo,
  vpsContainer: ContainerInfo,
  envName: string,
  cloudflareHostname: string,
): Promise<void> {
  if (!vpsContainer.ipAddress) {
    throw new Error("VPS container IP not available");
  }

  // Write SSH key to local container
  await context.executeInContainer(localContainer, [
    "bash", "-c", "mkdir -p /home/testuser/.ssh && chmod 700 /home/testuser/.ssh"
  ]);
  await context.executeInContainer(localContainer, [
    "bash", "-c", `cat > /home/testuser/.ssh/e2e_deploy_key << 'KEYEOF'
${await context.getPrivateKeyContent()}
KEYEOF
chmod 600 /home/testuser/.ssh/e2e_deploy_key`
  ]);

  // Create environment config with cloudflareHostname
  const envConfig = `[server]
host = "${vpsContainer.ipAddress}"
user = "root"
port = 22
keyPath = "/home/testuser/.ssh/e2e_deploy_key"
basePath = "/opt/action-llama"
cloudflareHostname = "${cloudflareHostname}"`;

  await context.executeInContainer(localContainer, [
    "bash", "-c", `mkdir -p /home/testuser/.action-llama/environments`
  ]);
  await context.executeInContainer(localContainer, [
    "bash", "-c", `cat > /home/testuser/.action-llama/environments/${envName}.toml << 'EOF'
${envConfig}
EOF`
  ]);

  // Bind project to environment
  await context.executeInContainer(localContainer, [
    "bash", "-c", `cat > /home/testuser/test-project/.env.toml << 'EOF'
environment = "${envName}"
EOF`
  ]);

  // Pre-create a self-signed TLS cert on the VPS so `nginx -t` can validate the
  // full config (mock strings like "MOCK_CERT" fail PEM parsing).
  const certBasePath = `/opt/action-llama/credentials/cloudflare_origin_cert/${cloudflareHostname}`;
  const certCommands = [
    `mkdir -p ${certBasePath}`,
    `openssl req -x509 -newkey rsa:2048 -keyout ${certBasePath}/private_key -out ${certBasePath}/certificate -days 1 -nodes -subj '/CN=${cloudflareHostname}'`,
  ].join(" && ");
  await context.executeSSHCommand(vpsContainer, certCommands);

  // Deploy — use --no-creds since certs are already on the VPS
  const pushOutput = await context.executeInContainer(localContainer, [
    "bash", "-c", `cd /home/testuser/test-project && al push --env ${envName} --headless --no-creds 2>&1 || echo "AL_PUSH_FAILED_EXIT_$?"`
  ]);
  console.log(`al push (dashboard) output: ${pushOutput}`);
  if (pushOutput.includes("AL_PUSH_FAILED_EXIT_")) {
    throw new Error(`al push (dashboard) failed: ${pushOutput}`);
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
metadata:
  models: [sonnet]
  credentials: [github_token, anthropic_key]
  schedule: "0 */6 * * *"
---

${newSkill}`;

  await context.executeInContainer(localContainer, [
    "bash", "-c", `cat > /home/testuser/test-project/agents/${agentName}/SKILL.md << 'EOF'
${skillContent}
EOF`
  ]);

  // Redeploy to VPS
  const pushOutput = await context.executeInContainer(localContainer, [
    "bash", "-c", `cd /home/testuser/test-project && al push --env ${envName} --headless --no-creds 2>&1 || echo "AL_PUSH_FAILED_EXIT_$?"`
  ]);
  console.log(`al push (update) output: ${pushOutput}`);
  if (pushOutput.includes("AL_PUSH_FAILED_EXIT_")) {
    throw new Error(`al push (update) failed: ${pushOutput}`);
  }

  // Wait for deployment to complete
  await new Promise(resolve => setTimeout(resolve, 10000));
}
