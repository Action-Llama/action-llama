import type { SshOptions } from "./ssh.js";
import { sshExec } from "./ssh.js";

export interface BootstrapResult {
  /** Absolute path to the `node` binary on the remote server. */
  nodePath: string;
}

/**
 * Check server prerequisites (Node >= 20, Docker, nginx).
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

  // Set up nginx as a reverse proxy to the gateway
  await ensureNginx(ssh, gatewayPort);

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
 * Ensure nginx is installed and configured as a reverse proxy to the gateway.
 * Installs nginx if missing, writes an action-llama site config, and reloads.
 */
async function ensureNginx(ssh: SshOptions, gatewayPort: number): Promise<void> {
  // Check if nginx is installed
  try {
    await sshExec(ssh, "which nginx");
    console.log("  nginx installed");
  } catch {
    console.log("  Installing nginx...");
    await sshExec(ssh, "sudo apt-get update -qq && sudo apt-get install -y -qq nginx");
    console.log("  nginx installed");
  }

  const nginxConf = `server {
    listen 80;
    listen [::]:80;

    location / {
        proxy_pass http://127.0.0.1:${gatewayPort};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
`;

  const escaped = nginxConf.replace(/'/g, "'\\''");
  await sshExec(ssh, `sudo tee /etc/nginx/sites-available/action-llama > /dev/null << 'NGINXEOF'\n${escaped}\nNGINXEOF`);
  await sshExec(ssh, "sudo ln -sfn /etc/nginx/sites-available/action-llama /etc/nginx/sites-enabled/action-llama");
  await sshExec(ssh, "sudo rm -f /etc/nginx/sites-enabled/default");
  await sshExec(ssh, "sudo nginx -t && sudo systemctl reload nginx");
  console.log(`  nginx configured → 127.0.0.1:${gatewayPort}`);

  // Ensure ufw allows HTTP/HTTPS for nginx (if ufw is active)
  try {
    const status = (await sshExec(ssh, "sudo ufw status")).trim();
    if (status.startsWith("Status: active")) {
      await sshExec(ssh, "sudo ufw allow 'Nginx Full'");
      console.log("  Firewall: HTTP/HTTPS allowed");
    }
  } catch {
    // ufw not installed — nothing to do
  }
}
