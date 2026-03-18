import { resolve, basename, dirname } from "path";
import { createHash } from "crypto";
import { readFileSync, unlinkSync } from "fs";
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
  forceInstall?: boolean;
}

/**
 * Compute a SHA-256 hash of package.json + package-lock.json contents.
 * Used to skip `npm install` when dependencies haven't changed.
 */
export function computePkgHash(projectPath: string): string {
  const hash = createHash("sha256");
  for (const file of ["package.json", "package-lock.json"]) {
    try {
      hash.update(readFileSync(resolve(projectPath, file)));
    } catch {
      // File missing — hash will differ from remote, triggering install
      hash.update(`missing:${file}`);
    }
  }
  return hash.digest("hex");
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
ExecStart=${alExec} start --headless -w${gatewayPort ? ` --port ${gatewayPort}` : ""}
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
  const { projectPath, serverConfig, globalConfig, dryRun, noCreds, noFiles, forceInstall } = opts;
  const ssh = sshOptionsFromConfig(serverConfig);
  const basePath = serverConfig.basePath ?? "/opt/action-llama";
  const gatewayPort = VPS_CONSTANTS.DEFAULT_GATEWAY_PORT;
  const projectName = basename(resolve(projectPath));

  // Set up SSH ControlMaster for connection multiplexing
  const hostHash = createHash("sha256").update(ssh.host).digest("hex").slice(0, 8);
  const controlPath = `/tmp/al-ssh-${hostHash}-${process.pid}`;
  ssh.controlPath = controlPath;

  try {
    await pushToServerInner(ssh, {
      projectPath, serverConfig, globalConfig, dryRun, noCreds, noFiles, forceInstall,
      basePath, gatewayPort, projectName,
    });
  } finally {
    try { unlinkSync(controlPath); } catch {}
  }
}

interface InnerOpts {
  projectPath: string;
  serverConfig: ServerConfig;
  globalConfig: GlobalConfig;
  dryRun?: boolean;
  noCreds?: boolean;
  noFiles?: boolean;
  forceInstall?: boolean;
  basePath: string;
  gatewayPort: number;
  projectName: string;
}

async function pushToServerInner(ssh: SshOptions, opts: InnerOpts): Promise<void> {
  const { projectPath, serverConfig, globalConfig, dryRun, noCreds, noFiles, forceInstall,
    basePath, gatewayPort, projectName } = opts;

  // Step 1: Bootstrap server
  console.log("\n=== Checking server prerequisites ===\n");
  let binPaths: BootstrapResult | undefined;
  if (dryRun) {
    console.log("(dry-run) Would check server prerequisites");
  } else {
    binPaths = await bootstrapServer(ssh);
  }

  // Step 2: Ensure remote directories exist
  if (!dryRun) {
    await sshExec(ssh, `mkdir -p ${basePath}/project ${basePath}/credentials`);
  }

  const rsyncFlags = dryRun ? ["--dry-run", "-v"] : [];

  // Phase A: Rsync project files and credentials in parallel
  const phaseA: Promise<void>[] = [];

  if (!noFiles) {
    console.log("\n=== Syncing project files ===\n");
    const excludes = [
      "node_modules",
      ".al",
      ".git",
      ".env.toml",
    ];
    phaseA.push(
      rsyncTo(ssh, projectPath, `${basePath}/project`, excludes, rsyncFlags)
        .then(() => { console.log(dryRun ? "(dry-run) Would sync project files" : "Project files synced."); }),
    );
  }

  if (!noCreds) {
    console.log("\n=== Syncing credentials ===\n");
    phaseA.push(
      rsyncTo(ssh, CREDENTIALS_DIR, `${basePath}/credentials`, undefined, rsyncFlags)
        .then(() => { console.log(dryRun ? "(dry-run) Would sync credentials" : "Credentials synced."); }),
    );
  }

  await Promise.all(phaseA);

  if (dryRun) {
    console.log("\n=== Dry run complete ===\n");
    console.log("No changes were made to the server.");
    return;
  }

  // Phase B: Parallel setup — npm install (if needed), nginx, env.toml, systemd
  const phaseB: Promise<void>[] = [];

  // npm install (conditional on package hash)
  if (!noFiles) {
    phaseB.push(conditionalNpmInstall(ssh, projectPath, basePath, forceInstall));
  }

  // nginx setup (batched into one SSH call)
  if (!noCreds && serverConfig.cloudflareHostname) {
    phaseB.push(setupNginx(ssh, basePath, serverConfig.cloudflareHostname, gatewayPort));
  }

  // .env.toml + credentials symlink (batched into one SSH call)
  phaseB.push(writeEnvAndSymlink(ssh, basePath, gatewayPort, globalConfig));

  // systemd unit install (batched into one SSH call)
  const unitContent = buildSystemdUnit(projectName, basePath, binPaths, gatewayPort);
  phaseB.push(installSystemdUnit(ssh, unitContent));

  await Promise.all(phaseB);

  // Phase C: Restart + health check (sequential)
  console.log("\n=== Restarting service ===\n");
  await sshExec(ssh, "sudo systemctl restart action-llama");
  console.log("Service restarted.");

  console.log("\n=== Health check ===\n");
  await healthCheck(ssh, gatewayPort);

  // Print status
  console.log(`\nDeployed to ${serverConfig.host}:`);
  console.log(`  Gateway: http://${serverConfig.host}:${gatewayPort}`);
  console.log(`  Project: ${basePath}/project`);
  console.log(`  Service: systemctl status action-llama`);
  console.log(`  Logs:    journalctl -u action-llama -f`);
}

async function conditionalNpmInstall(
  ssh: SshOptions, projectPath: string, basePath: string, forceInstall?: boolean,
): Promise<void> {
  const localHash = computePkgHash(projectPath);

  if (!forceInstall) {
    const remoteHash = (await sshExec(ssh, `cat ${basePath}/.pkg-hash 2>/dev/null || true`)).trim();
    if (remoteHash === localHash) {
      console.log("\n=== Dependencies unchanged, skipping npm install ===\n");
      return;
    }
  }

  console.log("\n=== Installing dependencies ===\n");
  await sshExec(ssh, `cd ${basePath}/project && npm install`);
  await sshExec(ssh, `cat > ${basePath}/.pkg-hash << 'HASHEOF'\n${localHash}\nHASHEOF`);
  console.log("Dependencies installed.");
}

async function setupNginx(
  ssh: SshOptions, basePath: string, cfHost: string, gatewayPort: number,
): Promise<void> {
  console.log("\n=== Configuring nginx ===\n");
  const certSrc = `${basePath}/credentials/cloudflare_origin_cert/${cfHost}/certificate`;
  const keySrc = `${basePath}/credentials/cloudflare_origin_cert/${cfHost}/private_key`;

  const { generateNginxConfig } = await import("../cloud/vps/nginx.js");
  const nginxConf = generateNginxConfig(cfHost, gatewayPort);
  const nginxEscaped = nginxConf.replace(/'/g, "'\\''");

  // Batch all nginx setup into one SSH call
  await sshExec(ssh, [
    `sudo mkdir -p ${VPS_CONSTANTS.NGINX_CERT_DIR}`,
    `sudo cp ${certSrc} ${VPS_CONSTANTS.NGINX_CERT_PATH}`,
    `sudo cp ${keySrc} ${VPS_CONSTANTS.NGINX_KEY_PATH}`,
    `sudo tee ${VPS_CONSTANTS.NGINX_SITE_CONFIG} > /dev/null << 'NGINXEOF'\n${nginxEscaped}\nNGINXEOF`,
    `sudo ln -sfn ${VPS_CONSTANTS.NGINX_SITE_CONFIG} /etc/nginx/sites-enabled/action-llama`,
    "sudo rm -f /etc/nginx/sites-enabled/default",
    "sudo nginx -t && sudo systemctl reload nginx",
  ].join(" && "));
  console.log(`  nginx: ${cfHost} :443 → 127.0.0.1:${gatewayPort}`);
}

async function writeEnvAndSymlink(
  ssh: SshOptions, basePath: string, gatewayPort: number, globalConfig: GlobalConfig,
): Promise<void> {
  console.log("\n=== Writing server .env.toml ===\n");
  const remoteEnv: Record<string, unknown> = {
    gateway: { ...globalConfig.gateway, port: gatewayPort },
  };
  if (globalConfig.telemetry) {
    remoteEnv.telemetry = globalConfig.telemetry;
  }
  const envToml = stringifyTOML(remoteEnv);
  const escaped = envToml.replace(/'/g, "'\\''");

  // Batch .env.toml write + credentials symlink into one SSH call
  await sshExec(ssh, [
    `cat > ${basePath}/project/.env.toml << 'ENVEOF'\n${escaped}\nENVEOF`,
    `mkdir -p ~/.action-llama && ln -sfn ${basePath}/credentials ~/.action-llama/credentials`,
  ].join(" && "));
  console.log("Server .env.toml written.");
}

async function installSystemdUnit(ssh: SshOptions, unitContent: string): Promise<void> {
  console.log("\n=== Setting up systemd service ===\n");
  const unitEscaped = unitContent.replace(/'/g, "'\\''");

  // Batch tee + daemon-reload + enable into one SSH call
  await sshExec(ssh, [
    `sudo tee /etc/systemd/system/action-llama.service > /dev/null << 'UNITEOF'\n${unitEscaped}\nUNITEOF`,
    "sudo systemctl daemon-reload",
    "sudo systemctl enable action-llama",
  ].join(" && "));
  console.log("Systemd service installed.");
}

/** Ramp-up intervals: faster initial polling, then backs off. */
const HEALTH_CHECK_INTERVALS_MS = [1000, 1000, 2000, 3000, 3000];

async function healthCheck(ssh: SshOptions, port: number): Promise<void> {
  const TIMEOUT_MS = 180_000; // 3 minutes — first push builds Docker images

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
  let pollIndex = 0;

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

      const delay = HEALTH_CHECK_INTERVALS_MS[Math.min(pollIndex, HEALTH_CHECK_INTERVALS_MS.length - 1)];
      pollIndex++;
      await new Promise((r) => setTimeout(r, delay));
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
