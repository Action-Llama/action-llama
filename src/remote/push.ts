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
  expose?: boolean,
): string {
  // al is installed as a project dependency — use the local binary
  const alExec = `${basePath}/project/node_modules/.bin/al`;
  // Ensure node is on PATH so the al binary can find it
  const extraDirs = new Set<string>();
  if (binPaths?.nodePath) extraDirs.add(dirname(binPaths.nodePath));
  const pathEnv = extraDirs.size > 0
    ? `\nEnvironment=PATH=${[...extraDirs].join(":")}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`
    : "";
  // Default to true for backward compatibility — existing server deployments expect public exposure
  const exposeFlag = expose === false ? "" : " -e";

  return `[Unit]
Description=Action Llama scheduler (${projectName})
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
WorkingDirectory=${basePath}/project
ExecStart=${alExec} start --headless -w${exposeFlag}${gatewayPort ? ` --port ${gatewayPort}` : ""}
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
  console.log("\nChecking server...");
  let binPaths: BootstrapResult | undefined;
  if (dryRun) {
    console.log("  (dry-run) Skipped.");
  } else {
    binPaths = await bootstrapServer(ssh);
    console.log(`  Node.js ${binPaths.nodeVersion}`);
    console.log(`  Docker ${binPaths.dockerVersion}`);
  }

  // Step 2: Ensure remote directories exist
  if (!dryRun) {
    await sshExec(ssh, `mkdir -p ${basePath}/project ${basePath}/credentials`);
  }

  // Phase A: Rsync files and credentials in parallel
  const syncItems: string[] = [];
  if (!noFiles) syncItems.push("files");
  if (!noCreds) syncItems.push("credentials");

  if (syncItems.length > 0) {
    console.log(`\nSyncing ${syncItems.join(" and ")}...`);
    const rsyncFlags = dryRun ? ["--dry-run", "-v"] : [];
    const phaseA: Promise<void>[] = [];
    if (!noFiles) {
      const excludes = ["node_modules", ".al", ".git", ".env.toml"];
      phaseA.push(rsyncTo(ssh, projectPath, `${basePath}/project`, excludes, rsyncFlags));
    }
    if (!noCreds) {
      phaseA.push(rsyncTo(ssh, CREDENTIALS_DIR, `${basePath}/credentials`, undefined, rsyncFlags));
    }
    await Promise.all(phaseA);
    console.log(dryRun ? "  (dry-run) No changes made." : "  Done.");
  }

  if (dryRun) {
    console.log("\nDry run complete — no changes were made.");
    return;
  }

  // Phase B: Configure server (parallel, results collected for deterministic output)
  console.log("\nConfiguring server...");
  const phaseB: Promise<string>[] = [];

  // SSH hardening (idempotent — safe to run on every push)
  phaseB.push(hardenSsh(ssh));

  if (!noFiles) {
    phaseB.push(conditionalNpmInstall(ssh, projectPath, basePath, forceInstall));
  }
  if (!noCreds && serverConfig.cloudflareHostname) {
    phaseB.push(setupNginx(ssh, basePath, serverConfig.cloudflareHostname, gatewayPort));
  }
  phaseB.push(writeEnvAndSymlink(ssh, basePath, gatewayPort, globalConfig));
  const unitContent = buildSystemdUnit(projectName, basePath, binPaths, gatewayPort, serverConfig.expose);
  phaseB.push(installSystemdUnit(ssh, unitContent));

  const results = await Promise.all(phaseB);
  for (const msg of results) {
    console.log(`  ${msg}`);
  }

  // Phase C: Restart + health check
  console.log("\nRestarting service...");
  await sshExec(ssh, "sudo systemctl restart action-llama");

  await healthCheck(ssh, gatewayPort);

  console.log(`\nDeployed to ${serverConfig.host}:`);
  console.log(`  Gateway: http://${serverConfig.host}:${gatewayPort}`);
  console.log(`  Project: ${basePath}/project`);
  console.log(`  Service: systemctl status action-llama`);
  console.log(`  Logs:    journalctl -u action-llama -f`);
}

/**
 * Harden SSH on the remote server. Idempotent — safe to run on every push.
 * Disables password authentication, restricts root login to key-only,
 * and installs fail2ban for brute-force protection.
 */
async function hardenSsh(ssh: SshOptions): Promise<string> {
  await sshExec(ssh, [
    // Disable password auth and restrict root to key-only
    "sed -i 's/^#\\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config",
    "sed -i 's/^#\\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config",
    "systemctl restart sshd",
    // Install fail2ban if not already present
    "dpkg -s fail2ban >/dev/null 2>&1 || (apt-get update -qq && apt-get install -y -qq fail2ban && systemctl enable fail2ban && systemctl start fail2ban)",
  ].join(" && "));
  return "SSH hardened (password auth disabled, fail2ban active).";
}

async function conditionalNpmInstall(
  ssh: SshOptions, projectPath: string, basePath: string, forceInstall?: boolean,
): Promise<string> {
  const localHash = computePkgHash(projectPath);

  if (!forceInstall) {
    const remoteHash = (await sshExec(ssh, `cat ${basePath}/.pkg-hash 2>/dev/null || true`)).trim();
    if (remoteHash === localHash) {
      return "Dependencies unchanged, skipped npm install.";
    }
  }

  await sshExec(ssh, `cd ${basePath}/project && npm install`);
  // When pushing the source package itself (not a consumer project), npm install
  // won't create a bin symlink for the package's own "bin" entry. Ensure it exists.
  await sshExec(ssh, [
    `cd ${basePath}/project`,
    `test -x node_modules/.bin/al || (mkdir -p node_modules/.bin && ln -sf ../../dist/cli/main.js node_modules/.bin/al)`,
  ].join(" && "));
  await sshExec(ssh, `cat > ${basePath}/.pkg-hash << 'HASHEOF'\n${localHash}\nHASHEOF`);
  return "Dependencies installed.";
}

async function setupNginx(
  ssh: SshOptions, basePath: string, cfHost: string, gatewayPort: number,
): Promise<string> {
  const certSrc = `${basePath}/credentials/cloudflare_origin_cert/${cfHost}/certificate`;
  const keySrc = `${basePath}/credentials/cloudflare_origin_cert/${cfHost}/private_key`;

  const { generateNginxConfig } = await import("../cloud/vps/nginx.js");
  const nginxConf = generateNginxConfig(cfHost, gatewayPort);
  const nginxEscaped = nginxConf.replace(/'/g, "'\\''");

  // Heredoc delimiter must be on its own line — place post-heredoc commands on
  // the opening line so the closing NGINXEOF isn't polluted by " && next_cmd".
  const postNginxCmds = [
    `sudo ln -sfn ${VPS_CONSTANTS.NGINX_SITE_CONFIG} /etc/nginx/sites-enabled/action-llama`,
    "sudo rm -f /etc/nginx/sites-enabled/default",
    "sudo nginx -t && sudo systemctl reload nginx",
  ].join(" && ");
  await sshExec(ssh, [
    `sudo mkdir -p ${VPS_CONSTANTS.NGINX_CERT_DIR}`,
    `sudo cp ${certSrc} ${VPS_CONSTANTS.NGINX_CERT_PATH}`,
    `sudo cp ${keySrc} ${VPS_CONSTANTS.NGINX_KEY_PATH}`,
    `sudo tee ${VPS_CONSTANTS.NGINX_SITE_CONFIG} > /dev/null << 'NGINXEOF' && ${postNginxCmds}\n${nginxEscaped}\nNGINXEOF`,
  ].join(" && "));
  return `nginx: ${cfHost} :443 → 127.0.0.1:${gatewayPort}`;
}

async function writeEnvAndSymlink(
  ssh: SshOptions, basePath: string, gatewayPort: number, globalConfig: GlobalConfig,
): Promise<string> {
  const remoteEnv: Record<string, unknown> = {
    gateway: { ...globalConfig.gateway, port: gatewayPort },
  };
  if (globalConfig.telemetry) {
    remoteEnv.telemetry = globalConfig.telemetry;
  }
  const envToml = stringifyTOML(remoteEnv);
  const escaped = envToml.replace(/'/g, "'\\''");

  // Heredoc delimiter must be on its own line — place subsequent commands on the
  // opening line so the closing ENVEOF isn't polluted by " && next_cmd".
  const symlinkCmd = `mkdir -p ~/.action-llama && ln -sfn ${basePath}/credentials ~/.action-llama/credentials`;
  await sshExec(ssh,
    `cat > ${basePath}/project/.env.toml << 'ENVEOF' && ${symlinkCmd}\n${escaped}\nENVEOF`,
  );
  return ".env.toml written.";
}

async function installSystemdUnit(ssh: SshOptions, unitContent: string): Promise<string> {
  const unitEscaped = unitContent.replace(/'/g, "'\\''");

  // Heredoc delimiter must be on its own line — place post-heredoc commands on
  // the opening line so the closing UNITEOF isn't polluted by " && next_cmd".
  const postUnitCmds = "sudo systemctl daemon-reload && sudo systemctl enable action-llama";
  await sshExec(ssh,
    `sudo tee /etc/systemd/system/action-llama.service > /dev/null << 'UNITEOF' && ${postUnitCmds}\n${unitEscaped}\nUNITEOF`,
  );
  return "Systemd service installed.";
}

/** Ramp-up intervals: faster initial polling, then backs off. */
const HEALTH_CHECK_INTERVALS_MS = [1000, 1000, 2000, 3000, 3000];

async function healthCheck(ssh: SshOptions, port: number): Promise<void> {
  const TIMEOUT_MS = 180_000; // 3 minutes — first push builds Docker images

  console.log("  Waiting for health check...");

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
      try {
        await sshExec(ssh, `curl -sf http://localhost:${port}/health`);
        console.log("  Health check passed.");
        return;
      } catch {
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
    console.log("\n  Service failed to start.");
  } else {
    console.log(`\n  Health check timed out after ${Math.round(TIMEOUT_MS / 1000)}s.`);
  }

  console.log("\n  Service status:");
  const statusOutput = await sshExecSafe(ssh, "systemctl status action-llama --no-pager -l 2>&1; true");
  console.log(statusOutput || "  (no output)");

  console.log("\n  Recent logs:");
  const logsOutput = await sshExecSafe(ssh, "journalctl -u action-llama --no-pager -n 40 2>&1; true");
  console.log(logsOutput || "  (no log output)");
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
