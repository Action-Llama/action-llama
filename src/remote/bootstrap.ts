import type { SshOptions } from "./ssh.js";
import { sshExec } from "./ssh.js";

export interface BootstrapResult {
  /** Absolute path to the `node` binary on the remote server. */
  nodePath: string;
}

/**
 * Check server prerequisites (Node >= 20, Docker, firewall).
 * Throws if a hard requirement is not met.
 * Returns resolved binary paths for use in the systemd unit.
 *
 * Note: al itself is not checked here — it is installed as a project
 * dependency via `npm install` during the push.
 */
export async function bootstrapServer(ssh: SshOptions, gatewayPort: number): Promise<BootstrapResult> {
  const [nodeResult, dockerResult] = await Promise.allSettled([
    checkNode(ssh),
    checkDocker(ssh),
  ]);

  const errors: string[] = [];

  if (nodeResult.status === "fulfilled") {
    console.log(`  Node.js ${nodeResult.value.version}`);
  } else {
    errors.push(nodeResult.reason?.message ?? "Node.js check failed");
  }

  if (dockerResult.status === "fulfilled") {
    console.log(`  Docker ${dockerResult.value}`);
  } else {
    errors.push(dockerResult.reason?.message ?? "Docker check failed");
  }

  if (errors.length > 0) {
    throw new Error(
      "Server prerequisites not met:\n" +
      errors.map(e => `  - ${e}`).join("\n")
    );
  }

  // Ensure firewall allows the gateway port (non-fatal — not all servers use ufw)
  await ensureFirewallPort(ssh, gatewayPort);

  return {
    nodePath: nodeResult.status === "fulfilled" ? nodeResult.value.path : "",
  };
}

async function checkNode(ssh: SshOptions): Promise<{ version: string; path: string }> {
  try {
    const nodeVersion = (await sshExec(ssh, "node --version")).trim();
    const major = parseInt(nodeVersion.replace(/^v/, ""), 10);
    if (major < 20) {
      throw new Error(`Node.js >= 20 required, found ${nodeVersion}`);
    }
    const nodePath = (await sshExec(ssh, "which node")).trim();
    return { version: nodeVersion, path: nodePath };
  } catch (err: any) {
    if (err.message?.includes("required")) throw err;
    throw new Error(
      "Node.js not found on the server. Install Node.js >= 20 before running al push."
    );
  }
}

async function checkDocker(ssh: SshOptions): Promise<string> {
  try {
    return (await sshExec(ssh, "docker info --format '{{.ServerVersion}}'")).trim();
  } catch {
    throw new Error(
      "Docker is not running on the server. Install and start Docker before running al push."
    );
  }
}

/**
 * If ufw is active, ensure the gateway port is allowed.
 * Silently skips if ufw is not installed or not active.
 */
async function ensureFirewallPort(ssh: SshOptions, port: number): Promise<void> {
  try {
    const status = (await sshExec(ssh, "sudo ufw status")).trim();
    if (!status.startsWith("Status: active")) return;

    // Check if the port is already allowed
    if (status.includes(`${port}/tcp`) || status.includes(`${port} `)) {
      console.log(`  Firewall: port ${port}/tcp already allowed`);
      return;
    }

    await sshExec(ssh, `sudo ufw allow ${port}/tcp`);
    console.log(`  Firewall: opened port ${port}/tcp`);
  } catch {
    // ufw not installed or not available — nothing to do
  }
}

