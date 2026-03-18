import { resolve, basename, dirname } from "path";
import { stringify as stringifyTOML } from "smol-toml";
import type { ServerConfig } from "../shared/server.js";
import type { GlobalConfig } from "../shared/config.js";
import { CREDENTIALS_DIR } from "../shared/paths.js";
import { VPS_CONSTANTS } from "../cloud/vps/constants.js";
import { sshOptionsFromConfig, sshExec, sshSpawn, rsyncTo, buildSshArgs, type SshOptions } from "./ssh.js";
import { execFile as execFileCb } from "child_process";
import { promisify } from "util";

const execFile = promisify(execFileCb);
import { bootstrapServer, type BootstrapResult } from "./bootstrap.js";

export interface PushOptions {
  projectPath: string;
  serverConfig: ServerConfig;
  globalConfig: GlobalConfig;
  dryRun?: boolean;
  noCreds?: boolean;
  noFiles?: boolean;
}

/**
 * Build a systemd unit file for the al scheduler.
 */
export function buildSystemdUnit(
  projectName: string,
  basePath: string,
  binPaths?: BootstrapResult,
  gatewayPort?: number,
): string {
  // al is installed as a project dependency — use the local binary
  const alExec = `${basePath}/project/node_modules/.bin/al`;
  // Ensure node is on PATH so the al binary can find it
  const extraDirs = new Set<string>();
  if (binPaths?.nodePath) extraDirs.add(dirname(binPaths.nodePath));
  const pathEnv = extraDirs.size > 0
    ? `\nEnvironment=PATH=${[...extraDirs].join(":")}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`
    : "";

  return `[Unit]
Description=Action Llama scheduler (${projectName})
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
WorkingDirectory=${basePath}/project
ExecStart=${alExec} start --headless --expose -w${gatewayPort ? ` --port ${gatewayPort}` : ""}
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production${pathEnv}

[Install]
WantedBy=multi-user.target
`;
}

/**
 * Push project files and credentials to a server, set up systemd, and verify.
 */
export async function pushToServer(opts: PushOptions): Promise<void> {
  const { projectPath, serverConfig, globalConfig, dryRun, noCreds, noFiles } = opts;
  const ssh = sshOptionsFromConfig(serverConfig);
  const basePath = serverConfig.basePath ?? "/opt/action-llama";
  const gatewayPort = VPS_CONSTANTS.DEFAULT_GATEWAY_PORT;
  const projectName = basename(resolve(projectPath));

  // Step 1: Bootstrap server
  console.log("\n=== Checking server prerequisites ===\n");
  let binPaths: BootstrapResult | undefined;
  if (dryRun) {
    console.log("(dry-run) Would check server prerequisites");
  } else {
    binPaths = await bootstrapServer(ssh, gatewayPort);
  }

  // Step 2: Ensure remote directories exist
  if (!dryRun) {
    await sshExec(ssh, `mkdir -p ${basePath}/project ${basePath}/credentials`);
  }

  const rsyncFlags = dryRun ? ["--dry-run", "-v"] : [];

  // Step 3: Rsync project files
  if (!noFiles) {
    console.log("\n=== Syncing project files ===\n");
    const excludes = [
      "node_modules",
      ".al",
      ".git",
      ".env.toml",
    ];
    await rsyncTo(ssh, projectPath, `${basePath}/project`, excludes, rsyncFlags);
    console.log(dryRun ? "(dry-run) Would sync project files" : "Project files synced.");

    // Install project dependencies on the remote
    if (!dryRun) {
      console.log("\n=== Installing dependencies ===\n");
      await sshExec(ssh, `cd ${basePath}/project && npm install`);
      console.log("Dependencies installed.");
    }
  }

  // Step 4: Sync credentials
  if (!noCreds) {
    console.log("\n=== Syncing credentials ===\n");
    await rsyncTo(ssh, CREDENTIALS_DIR, `${basePath}/credentials`, undefined, rsyncFlags);
    console.log(dryRun ? "(dry-run) Would sync credentials" : "Credentials synced.");
  }

  // Step 5: Write .env.toml on the server
  if (!dryRun) {
    console.log("\n=== Writing server .env.toml ===\n");
    // Build a self-contained .env.toml — no environment reference needed on the
    // remote since the server is effectively running locally.  Inline gateway and
    // telemetry config so the scheduler has everything it needs.
    const remoteEnv: Record<string, unknown> = {
      gateway: { ...globalConfig.gateway, port: gatewayPort },
    };
    if (globalConfig.telemetry) {
      remoteEnv.telemetry = globalConfig.telemetry;
    }
    const envToml = stringifyTOML(remoteEnv);
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
  const unitContent = buildSystemdUnit(projectName, basePath, binPaths, gatewayPort);
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
  const TIMEOUT_MS = 180_000; // 3 minutes — first push builds Docker images
  const POLL_MS = 3_000;

  console.log("  Waiting for service to start...\n");

  // Tail journal for live build/startup progress so the user sees what's happening
  const journal = sshSpawn(ssh, "journalctl -u action-llama -f --since 'now' -o cat 2>/dev/null");
  journal.stdout?.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) {
      const trimmed = line.trimEnd();
      if (trimmed) {
        console.log(`  ${trimmed}`);
      }
    }
  });

  const startTime = Date.now();
  let serviceFailed = false;

  try {
    while (Date.now() - startTime < TIMEOUT_MS) {
      // Try health endpoint
      try {
        await sshExec(ssh, `curl -sf http://localhost:${port}/health`);
        console.log("\n  Health check passed.");
        return;
      } catch {
        // Check if service has crashed/stopped — fail fast instead of waiting
        const active = await sshExecSafe(ssh, "systemctl is-active action-llama");
        if (active === "failed" || active === "inactive") {
          serviceFailed = true;
          break;
        }
      }

      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  } finally {
    journal.kill();
  }

  // Failure diagnostics
  if (serviceFailed) {
    console.log("\n  Service failed to start.\n");
  } else {
    console.log(`\nHealth check did not pass within ${Math.round(TIMEOUT_MS / 1000)}s.\n`);
  }

  console.log("=== Service status ===\n");
  const statusOutput = await sshExecSafe(ssh, "systemctl status action-llama --no-pager -l 2>&1; true");
  console.log(statusOutput || "  (no output)");

  console.log("\n=== Recent logs ===\n");
  const logsOutput = await sshExecSafe(ssh, "journalctl -u action-llama --no-pager -n 40 2>&1; true");
  console.log(logsOutput || "  (no log output — service may have failed to start)");

  console.log("");
}

/**
 * Run a command via SSH, returning whatever output is available even if the
 * command exits non-zero. Returns trimmed stdout+stderr combined, or the
 * error message if the SSH connection itself fails.
 */
async function sshExecSafe(opts: SshOptions, command: string): Promise<string> {
  const args = [...buildSshArgs(opts), command];
  try {
    const { stdout } = await execFile("ssh", args, { maxBuffer: 10 * 1024 * 1024 });
    return stdout.trim();
  } catch (err: any) {
    // execFile error objects include stdout/stderr even on non-zero exit
    const output = [err.stdout, err.stderr].filter(Boolean).join("\n").trim();
    return output || err.message || "(unknown error)";
  }
}
