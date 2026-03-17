import { resolve, basename } from "path";
import { stringify as stringifyTOML } from "smol-toml";
import type { ServerConfig } from "../shared/server.js";
import type { GlobalConfig } from "../shared/config.js";
import { CREDENTIALS_DIR } from "../shared/paths.js";
import { sshOptionsFromConfig, sshExec, rsyncTo, type SshOptions } from "./ssh.js";
import { bootstrapServer } from "./bootstrap.js";

export interface PushOptions {
  projectPath: string;
  serverConfig: ServerConfig;
  globalConfig: GlobalConfig;
  envName: string;
  dryRun?: boolean;
  noCreds?: boolean;
}

/**
 * Build a systemd unit file for the al scheduler.
 */
export function buildSystemdUnit(projectName: string, basePath: string, gatewayPort: number): string {
  return `[Unit]
Description=Action Llama scheduler (${projectName})
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
WorkingDirectory=${basePath}/project
ExecStart=/usr/bin/env al start --headless --expose
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=AL_GATEWAY_PORT=${gatewayPort}

[Install]
WantedBy=multi-user.target
`;
}

/**
 * Push project files and credentials to a server, set up systemd, and verify.
 */
export async function pushToServer(opts: PushOptions): Promise<void> {
  const { projectPath, serverConfig, globalConfig, envName, dryRun, noCreds } = opts;
  const ssh = sshOptionsFromConfig(serverConfig);
  const basePath = serverConfig.basePath ?? "/opt/action-llama";
  const gatewayPort = serverConfig.gatewayPort ?? globalConfig.gateway?.port ?? 3000;
  const projectName = basename(resolve(projectPath));

  // Step 1: Bootstrap server
  console.log("\n=== Checking server prerequisites ===\n");
  if (dryRun) {
    console.log("(dry-run) Would check server prerequisites");
  } else {
    await bootstrapServer(ssh);
  }

  // Step 2: Ensure remote directories exist
  console.log("\n=== Syncing project files ===\n");
  if (!dryRun) {
    await sshExec(ssh, `mkdir -p ${basePath}/project ${basePath}/credentials`);
  }

  // Step 3: Rsync project files
  const excludes = [
    "node_modules",
    ".al",
    ".git",
    ".env.toml",
  ];
  const rsyncFlags = dryRun ? ["--dry-run", "-v"] : [];

  await rsyncTo(ssh, projectPath, `${basePath}/project`, excludes, rsyncFlags);
  console.log(dryRun ? "(dry-run) Would sync project files" : "Project files synced.");

  // Step 4: Sync credentials
  if (!noCreds) {
    console.log("\n=== Syncing credentials ===\n");
    await rsyncTo(ssh, CREDENTIALS_DIR, `${basePath}/credentials`, undefined, rsyncFlags);
    console.log(dryRun ? "(dry-run) Would sync credentials" : "Credentials synced.");
  } else {
    console.log("\n=== Skipping credentials (--no-creds) ===\n");
  }

  // Step 5: Write .env.toml on the server
  if (!dryRun) {
    console.log("\n=== Writing server .env.toml ===\n");
    const envToml = stringifyTOML({
      environment: envName,
      gateway: { port: gatewayPort },
    } as Record<string, unknown>);
    // Escape for shell
    const escaped = envToml.replace(/'/g, "'\\''");
    await sshExec(ssh, `cat > ${basePath}/project/.env.toml << 'ENVEOF'\n${escaped}\nENVEOF`);
    console.log("Server .env.toml written.");

    // Symlink credentials dir so al can find them
    await sshExec(ssh, `mkdir -p ~/.action-llama && ln -sfn ${basePath}/credentials ~/.action-llama/credentials`);
  }

  if (dryRun) {
    console.log("\n=== Dry run complete ===\n");
    console.log("No changes were made to the server.");
    return;
  }

  // Step 6: Install systemd unit
  console.log("\n=== Setting up systemd service ===\n");
  const unitContent = buildSystemdUnit(projectName, basePath, gatewayPort);
  const unitEscaped = unitContent.replace(/'/g, "'\\''");
  await sshExec(ssh, `sudo tee /etc/systemd/system/action-llama.service > /dev/null << 'UNITEOF'\n${unitEscaped}\nUNITEOF`);
  await sshExec(ssh, "sudo systemctl daemon-reload");
  await sshExec(ssh, "sudo systemctl enable action-llama");
  console.log("Systemd service installed.");

  // Step 7: Restart service
  console.log("\n=== Restarting service ===\n");
  await sshExec(ssh, "sudo systemctl restart action-llama");
  console.log("Service restarted.");

  // Step 8: Health check
  console.log("\n=== Health check ===\n");
  await healthCheck(ssh, gatewayPort);

  // Print status
  console.log(`\nDeployed to ${serverConfig.host}:`);
  console.log(`  Gateway: http://${serverConfig.host}:${gatewayPort}`);
  console.log(`  Project: ${basePath}/project`);
  console.log(`  Service: systemctl status action-llama`);
  console.log(`  Logs:    journalctl -u action-llama -f`);
}

async function healthCheck(ssh: SshOptions, port: number): Promise<void> {
  // Give the service a moment to start
  const maxAttempts = 6;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const resp = await sshExec(ssh, `curl -sf http://localhost:${port}/health`);
      console.log("Health check passed.");
      return;
    } catch {
      if (i < maxAttempts - 1) {
        console.log(`  Waiting for service to start... (${i + 1}/${maxAttempts})`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
  console.log("Warning: health check did not pass within 12s. Check 'journalctl -u action-llama' on the server.");
}
