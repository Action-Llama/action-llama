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
  const backend = new FilesystemBackend();

  // 1. Stop and remove all action-llama containers
  try {
    const listResult = await sshExec(sshConfig, "docker ps -aq --filter 'name=al-'", 15_000);
    if (listResult.exitCode === 0 && listResult.stdout.trim()) {
      console.log("Stopping Action Llama containers on VPS...");
      await sshExec(
        sshConfig,
        "docker ps -aq --filter 'name=al-' | xargs -r docker rm -f",
        30_000,
      );
      console.log("Containers removed.");
    }
  } catch (err: any) {
    console.log(`Container cleanup failed (server may be unreachable): ${err.message}`);
  }

  // 2. Clean up remote credentials
  try {
    const checkResult = await sshExec(sshConfig, `test -d ${VPS_CONSTANTS.REMOTE_CREDENTIALS_DIR} && echo exists`);
    if (checkResult.stdout.includes("exists")) {
      await sshExec(sshConfig, `rm -rf ${VPS_CONSTANTS.REMOTE_CREDENTIALS_DIR}`);
      console.log("Remote credentials cleaned up.");
    }
  } catch {
    // Best effort — server may be unreachable
  }

  // 3. Clean up Cloudflare DNS record
  if (config.cloudflareZoneId && config.cloudflareDnsRecordId) {
    try {
      const cfToken = await backend.read("cloudflare_api_token", "default", "api_token");
      if (cfToken) {
        const { deleteDnsRecord } = await import("./cloudflare-api.js");
        await deleteDnsRecord(cfToken, config.cloudflareZoneId, config.cloudflareDnsRecordId);
        console.log(`Cloudflare DNS record deleted${config.cloudflareHostname ? ` (${config.cloudflareHostname})` : ""}.`);
      } else {
        console.log("Cloudflare API token not found — delete the DNS record manually in the Cloudflare dashboard.");
      }
    } catch (err: any) {
      console.log(`Cloudflare DNS cleanup failed: ${err.message}`);
      console.log("Delete the DNS record manually in the Cloudflare dashboard.");
    }
  }

  // 4. If this is a Vultr-provisioned instance, offer to delete it
  if (config.vultrInstanceId) {
    const deleteVps = await confirm({
      message: `Delete Vultr instance ${config.vultrInstanceId} (${config.host})?`,
      default: false,
    });

    if (deleteVps) {
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
