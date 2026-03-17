/**
 * VPS teardown logic.
 * Handles both removing containers and optionally deleting the Vultr instance.
 */

import { confirm } from "@inquirer/prompts";
import type { VpsCloudConfig } from "../../shared/config.js";
import { sshExec, type SshConfig } from "./ssh.js";
import { VPS_CONSTANTS } from "./constants.js";
import { FilesystemBackend } from "../../shared/filesystem-backend.js";

function sshConfigFromCloud(config: VpsCloudConfig): SshConfig {
  return {
    host: config.host,
    user: config.sshUser ?? VPS_CONSTANTS.DEFAULT_SSH_USER,
    port: config.sshPort ?? VPS_CONSTANTS.DEFAULT_SSH_PORT,
    keyPath: config.sshKeyPath ?? VPS_CONSTANTS.DEFAULT_SSH_KEY_PATH,
  };
}

export async function teardownVps(_projectPath: string, config: VpsCloudConfig): Promise<void> {
  const sshConfig = sshConfigFromCloud(config);

  // 1. Stop and remove all action-llama containers
  console.log("Stopping all Action Llama containers on VPS...");
  try {
    await sshExec(
      sshConfig,
      "docker ps -aq --filter 'name=al-' | xargs -r docker rm -f",
      30_000,
    );
    console.log("Containers removed.");
  } catch (err: any) {
    console.log(`Container cleanup failed (server may be unreachable): ${err.message}`);
  }

  // 2. Clean up remote credentials
  try {
    await sshExec(sshConfig, `rm -rf ${VPS_CONSTANTS.REMOTE_CREDENTIALS_DIR}`);
    console.log("Remote credentials cleaned up.");
  } catch {
    // Best effort
  }

  // 3. If this is a Vultr-provisioned instance, offer to delete it
  if (config.vultrInstanceId) {
    const deleteVps = await confirm({
      message: `Delete Vultr instance ${config.vultrInstanceId} (${config.host})?`,
      default: false,
    });

    if (deleteVps) {
      const backend = new FilesystemBackend();
      const apiKey = await backend.read("vultr_api_key", "default", "api_key");
      if (!apiKey) {
        console.log("Vultr API key not found — delete the instance manually at https://my.vultr.com");
        return;
      }

      const { deleteInstance } = await import("./vultr-api.js");
      await deleteInstance(apiKey, config.vultrInstanceId);
      console.log("Vultr instance deleted.");
    }
  }
}
