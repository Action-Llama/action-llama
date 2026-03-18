import type { SshOptions } from "./ssh.js";
import { sshExec } from "./ssh.js";

export interface BootstrapResult {
  /** Absolute path to the `al` binary on the remote server. */
  alPath: string;
  /** Absolute path to the `node` binary on the remote server. */
  nodePath: string;
}

/**
 * Check server prerequisites and install al if missing.
 * Throws if a hard requirement (Node >= 20, Docker) is not met.
 * Returns resolved binary paths for use in the systemd unit.
 */
export async function bootstrapServer(ssh: SshOptions): Promise<BootstrapResult> {
  // Run all three checks in parallel
  const [nodeResult, dockerResult, alResult] = await Promise.allSettled([
    checkNode(ssh),
    checkDocker(ssh),
    checkAl(ssh),
  ]);

  // Report results and collect errors
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

  // al might need install — handle separately
  let alPath: string;
  if (alResult.status === "fulfilled") {
    console.log(`  al ${alResult.value.version}`);
    alPath = alResult.value.path;
  } else {
    // Try installing al (requires node to be present)
    if (nodeResult.status !== "fulfilled") {
      errors.push("Cannot install al CLI — Node.js is not available");
    } else {
      try {
        console.log("  al not found, installing...");
        await sshExec(ssh, "npm install -g @action-llama/action-llama@next");
        const alVersion = (await sshExec(ssh, "al --version")).trim();
        alPath = (await sshExec(ssh, "which al")).trim();
        console.log(`  al ${alVersion} installed`);
      } catch {
        errors.push("Failed to install al CLI on the server");
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(
      "Server prerequisites not met:\n" +
      errors.map(e => `  - ${e}`).join("\n")
    );
  }

  return {
    alPath: alPath!,
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

async function checkAl(ssh: SshOptions): Promise<{ version: string; path: string }> {
  const alVersion = (await sshExec(ssh, "al --version")).trim();
  const alPath = (await sshExec(ssh, "which al")).trim();
  return { version: alVersion, path: alPath };
}
