/**
 * VPS provisioning wizard.
 * Supports both connecting to an existing server and provisioning a new Vultr VPS.
 */

import { select, input, confirm } from "@inquirer/prompts";
import { readFileSync } from "fs";
import { homedir } from "os";
import { resolve } from "path";
import { VPS_CONSTANTS } from "./constants.js";
import { testConnection, sshExec, type SshConfig } from "./ssh.js";
import type { VpsCloudConfig } from "../../shared/config.js";
import { FilesystemBackend } from "../../shared/filesystem-backend.js";

export async function setupVpsCloud(): Promise<Record<string, unknown> | null> {
  const mode = await select({
    message: "VPS setup mode:",
    choices: [
      { name: "Connect to an existing server (any provider)", value: "existing" as const },
      { name: "Provision a new Vultr VPS", value: "vultr" as const },
    ],
  });

  if (mode === "existing") {
    return setupExistingServer();
  }
  return provisionVultr();
}

async function setupExistingServer(): Promise<Record<string, unknown> | null> {
  const host = await input({ message: "Server IP or hostname:" });
  const sshUser = await input({ message: "SSH user:", default: VPS_CONSTANTS.DEFAULT_SSH_USER });
  const sshPort = parseInt(
    await input({ message: "SSH port:", default: String(VPS_CONSTANTS.DEFAULT_SSH_PORT) }),
    10,
  );
  const sshKeyPath = await input({ message: "SSH key path:", default: VPS_CONSTANTS.DEFAULT_SSH_KEY_PATH });

  const sshConfig: SshConfig = {
    host,
    user: sshUser,
    port: sshPort,
    keyPath: sshKeyPath,
  };

  // Validate SSH connectivity
  console.log("\nTesting SSH connection...");
  const connected = await testConnection(sshConfig);
  if (!connected) {
    console.error("Failed to connect via SSH. Check host, credentials, and firewall rules.");
    return null;
  }
  console.log("SSH connection successful.");

  // Verify Docker is available
  console.log("Checking Docker availability...");
  const dockerResult = await sshExec(sshConfig, "docker info --format '{{.ServerVersion}}'");
  if (dockerResult.exitCode !== 0) {
    console.error("Docker is not available on the remote server. Install Docker first.");
    console.error(`  ssh ${sshUser}@${host} 'curl -fsSL https://get.docker.com | sh'`);
    return null;
  }
  console.log(`Docker ${dockerResult.stdout} found.`);

  // Offer to configure firewall on existing server
  const setupFirewall = await confirm({
    message: "Configure ufw firewall (allow SSH + gateway only)?",
    default: true,
  });
  if (setupFirewall) {
    console.log("Configuring firewall...");
    await sshExec(sshConfig, `ufw allow 22/tcp && ufw allow ${VPS_CONSTANTS.DEFAULT_GATEWAY_PORT}/tcp && ufw --force enable`);
    console.log("Firewall enabled (SSH + gateway only).");
  }

  const config: Record<string, unknown> = {
    provider: "vps",
    host,
  };
  if (sshUser !== VPS_CONSTANTS.DEFAULT_SSH_USER) config.sshUser = sshUser;
  if (sshPort !== VPS_CONSTANTS.DEFAULT_SSH_PORT) config.sshPort = sshPort;
  if (sshKeyPath !== VPS_CONSTANTS.DEFAULT_SSH_KEY_PATH) config.sshKeyPath = sshKeyPath;

  return config;
}

async function provisionVultr(): Promise<Record<string, unknown> | null> {
  // 1. Read Vultr API key
  const backend = new FilesystemBackend();
  const apiKeyValue = await backend.read("vultr_api_key", "default", "api_key");
  if (!apiKeyValue) {
    console.error("Vultr API key not found. Run 'al doctor' to configure vultr_api_key first.");
    return null;
  }

  const {
    listRegions,
    listPlans,
    listSshKeys,
    createSshKey,
    createInstance,
    getInstance,
  } = await import("./vultr-api.js");

  // 2. Pick region
  console.log("\nFetching Vultr regions...");
  const regions = await listRegions(apiKeyValue);
  const regionChoice = await select({
    message: "Region:",
    choices: regions
      .sort((a, b) => a.city.localeCompare(b.city))
      .map((r) => ({
        name: `${r.city}, ${r.country} (${r.id})`,
        value: r.id,
      })),
  });

  // 3. Pick plan (filter to usable specs)
  console.log("Fetching available plans...");
  const allPlans = await listPlans(apiKeyValue);
  const plans = allPlans
    .filter(
      (p) =>
        p.vcpu_count >= VPS_CONSTANTS.MIN_VCPUS &&
        p.ram >= VPS_CONSTANTS.MIN_RAM_MB &&
        p.locations.includes(regionChoice) &&
        p.type === "vc2",
    )
    .sort((a, b) => a.monthly_cost - b.monthly_cost);

  if (plans.length === 0) {
    console.error("No suitable plans found in this region. Try a different region.");
    return null;
  }

  const planChoice = await select({
    message: "Plan:",
    choices: plans.map((p) => ({
      name: `${p.vcpu_count} vCPU / ${p.ram}MB RAM / ${p.disk}GB SSD — $${p.monthly_cost}/mo (${p.id})`,
      value: p.id,
    })),
  });

  // 4. SSH key
  console.log("Fetching SSH keys...");
  const existingKeys = await listSshKeys(apiKeyValue);
  let sshKeyId: string;

  const defaultPubKeyPath = resolve(homedir(), ".ssh", "id_rsa.pub");
  let localPubKey: string | undefined;
  try {
    localPubKey = readFileSync(defaultPubKeyPath, "utf-8").trim();
  } catch {
    // No default key found
  }

  if (existingKeys.length > 0) {
    const keyChoices: Array<{ name: string; value: string }> = existingKeys.map((k) => ({
      name: `${k.name} (${k.ssh_key.slice(0, 30)}...)`,
      value: k.id,
    }));
    if (localPubKey) {
      keyChoices.push({ name: "Upload ~/.ssh/id_rsa.pub as new key", value: "__upload__" });
    }

    const keyChoice = await select({ message: "SSH key:", choices: keyChoices });
    if (keyChoice === "__upload__") {
      const uploaded = await createSshKey(apiKeyValue, "action-llama", localPubKey!);
      sshKeyId = uploaded.id;
      console.log("SSH key uploaded.");
    } else {
      sshKeyId = keyChoice;
    }
  } else if (localPubKey) {
    console.log("No SSH keys on Vultr. Uploading ~/.ssh/id_rsa.pub...");
    const uploaded = await createSshKey(apiKeyValue, "action-llama", localPubKey);
    sshKeyId = uploaded.id;
    console.log("SSH key uploaded.");
  } else {
    console.error("No SSH keys found locally or on Vultr. Generate one with: ssh-keygen -t ed25519");
    return null;
  }

  // 5. Create instance
  console.log("\nProvisioning Vultr instance...");
  const userData = Buffer.from(VPS_CONSTANTS.CLOUD_INIT_SCRIPT).toString("base64");
  const instance = await createInstance(apiKeyValue, {
    region: regionChoice,
    plan: planChoice,
    os_id: VPS_CONSTANTS.PREFERRED_OS_ID,
    sshkey_id: [sshKeyId],
    label: "action-llama",
    user_data: userData,
  });
  console.log(`Instance ${instance.id} created. Waiting for it to become active...`);

  // 6. Poll until active + SSH available + Docker installed
  const sshConfig: SshConfig = {
    host: "",
    user: VPS_CONSTANTS.DEFAULT_SSH_USER,
    port: VPS_CONSTANTS.DEFAULT_SSH_PORT,
    keyPath: VPS_CONSTANTS.DEFAULT_SSH_KEY_PATH,
  };

  const startTime = Date.now();
  const maxWaitMs = 10 * 60 * 1000; // 10 minutes

  while (Date.now() - startTime < maxWaitMs) {
    const current = await getInstance(apiKeyValue, instance.id);

    if (current.status === "active" && current.main_ip !== "0.0.0.0") {
      sshConfig.host = current.main_ip;
      console.log(`Instance active at ${current.main_ip}. Waiting for SSH...`);

      // Wait for SSH
      const sshReady = await testConnection(sshConfig);
      if (sshReady) {
        // Check if cloud-init + Docker are done
        const dockerCheck = await sshExec(sshConfig, "docker info --format '{{.ServerVersion}}'");
        if (dockerCheck.exitCode === 0) {
          console.log(`Docker ${dockerCheck.stdout} ready on VPS.`);
          break;
        }
        console.log("Waiting for Docker installation to complete...");
      }
    } else {
      process.stdout.write(".");
    }

    await new Promise((r) => setTimeout(r, 10_000));
  }

  if (!sshConfig.host || sshConfig.host === "0.0.0.0") {
    console.error("\nTimed out waiting for VPS to become ready.");
    return null;
  }

  // Final SSH check
  const ok = await testConnection(sshConfig);
  if (!ok) {
    console.error("\nVPS is active but SSH connection failed. Check firewall rules.");
    return null;
  }

  // Configure firewall
  console.log("Configuring firewall...");
  await sshExec(sshConfig, `ufw allow 22/tcp && ufw allow ${VPS_CONSTANTS.DEFAULT_GATEWAY_PORT}/tcp && ufw --force enable`);
  console.log("Firewall enabled (SSH + gateway only).");

  const shouldContinue = await confirm({
    message: `VPS ready at ${sshConfig.host}. Continue with setup?`,
    default: true,
  });
  if (!shouldContinue) return null;

  return {
    provider: "vps",
    host: sshConfig.host,
    vultrInstanceId: instance.id,
    vultrRegion: regionChoice,
  };
}
