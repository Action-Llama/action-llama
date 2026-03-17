import type { SshOptions } from "./ssh.js";
import { sshExec } from "./ssh.js";

/**
 * Check server prerequisites and install al if missing.
 * Throws if a hard requirement (Node >= 20, Docker) is not met.
 */
export async function bootstrapServer(ssh: SshOptions): Promise<void> {
  // Check Node.js >= 20
  console.log("Checking Node.js...");
  try {
    const nodeVersion = (await sshExec(ssh, "node --version")).trim();
    const major = parseInt(nodeVersion.replace(/^v/, ""), 10);
    if (major < 20) {
      throw new Error(`Node.js >= 20 required, found ${nodeVersion}`);
    }
    console.log(`  Node.js ${nodeVersion}`);
  } catch (err: any) {
    if (err.message?.includes("required")) throw err;
    throw new Error(
      "Node.js not found on the server. Install Node.js >= 20 before running al push."
    );
  }

  // Check Docker
  console.log("Checking Docker...");
  try {
    const dockerVersion = (await sshExec(ssh, "docker info --format '{{.ServerVersion}}'")).trim();
    console.log(`  Docker ${dockerVersion}`);
  } catch {
    throw new Error(
      "Docker is not running on the server. Install and start Docker before running al push."
    );
  }

  // Check if al is installed, install if missing
  console.log("Checking al CLI...");
  try {
    const alVersion = (await sshExec(ssh, "al --version")).trim();
    console.log(`  al ${alVersion}`);
  } catch {
    console.log("  al not found, installing...");
    await sshExec(ssh, "npm install -g @action-llama/action-llama@next");
    const alVersion = (await sshExec(ssh, "al --version")).trim();
    console.log(`  al ${alVersion} installed`);
  }
}
