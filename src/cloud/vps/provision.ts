/**
 * VPS provisioning wizard.
 * Supports both connecting to an existing server and provisioning a new Vultr VPS.
 */

import { select, input, confirm, password, search } from "@inquirer/prompts";
import { AbortPromptError } from "@inquirer/core";
import { readFileSync } from "fs";
import { resolve } from "path";
import { VPS_CONSTANTS } from "./constants.js";
import { testConnection, sshExec, type SshConfig } from "./ssh.js";
import type { VpsCloudConfig } from "../../shared/config.js";
import { FilesystemBackend } from "../../shared/filesystem-backend.js";
import { writeCredentialField, writeCredentialFields, credentialDir } from "../../shared/credentials.js";

/**
 * Run a search prompt with Esc-to-back support.
 * Listens for the Escape key on stdin and aborts the prompt via AbortController.
 * Returns null when the user presses Esc.
 */
async function searchWithEsc<T>(opts: {
  message: string;
  choices: Array<{ name: string; value: T }>;
}): Promise<T | null> {
  const ac = new AbortController();
  const onKeypress = (_ch: string, key: { name: string }) => {
    if (key?.name === "escape") ac.abort();
  };

  process.stdin.on("keypress", onKeypress);
  try {
    const allChoices = opts.choices;
    const result = await search({
      message: opts.message,
      instructions: { pager: "↑↓ navigate • ⏎ select • esc back", navigation: "↑↓ navigate • ⏎ select • esc back" },
      source: (term: string | undefined) => {
        if (!term) return allChoices;
        const lower = term.toLowerCase();
        return allChoices.filter((c) => c.name.toLowerCase().includes(lower));
      },
      signal: ac.signal,
    } as any);
    return result as T;
  } catch (err) {
    if (err instanceof AbortPromptError) return null;
    throw err;
  } finally {
    process.stdin.removeListener("keypress", onKeypress);
  }
}

export interface CloudflareConfig {
  apiToken: string;
  zoneId: string;
  zoneName: string;
  hostname: string;
}

export type OnInstanceCreated = (partial: Record<string, unknown>) => void;

export async function setupVpsCloud(onInstanceCreated?: OnInstanceCreated): Promise<Record<string, unknown> | null> {
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

  // Offer Cloudflare HTTPS before Vultr provisioning
  const cfConfig = await promptCloudflareHttps();

  return provisionVultr(onInstanceCreated, cfConfig);
}

/**
 * Prompt for optional Cloudflare HTTPS setup.
 * Returns null if declined or validation fails.
 */
async function promptCloudflareHttps(): Promise<CloudflareConfig | null> {
  const useHttps = await confirm({
    message: "Expose gateway via Cloudflare HTTPS?",
    default: true,
  });
  if (!useHttps) return null;

  const backend = new FilesystemBackend();
  let apiToken = await backend.read("cloudflare_api_token", "default", "api_token");
  if (!apiToken) {
    console.log("Cloudflare API token not found.");
    const entered = await password({
      message: "Enter your Cloudflare API token (from https://dash.cloudflare.com/profile/api-tokens):",
      mask: "*",
      validate: (v: string) => v.trim() ? true : "API token is required",
    });
    apiToken = entered.trim();

    // Verify token before saving
    const { verifyToken } = await import("./cloudflare-api.js");
    try {
      const active = await verifyToken(apiToken);
      if (!active) {
        console.error("Cloudflare API token is not active.");
        return null;
      }
    } catch (err: any) {
      console.error(`Cloudflare API token verification failed: ${err.message}`);
      return null;
    }

    await writeCredentialField("cloudflare_api_token", "default", "api_token", apiToken);
    console.log("Cloudflare API token saved.");
  }

  const { listAllZones } = await import("./cloudflare-api.js");

  // Fetch available zones
  let zones: Array<{ id: string; name: string; status: string }>;
  try {
    zones = await listAllZones(apiToken);
    if (zones.length === 0) {
      console.error("No Cloudflare zones found. Check your API token permissions.");
      return null;
    }
  } catch (err: any) {
    console.error(`Failed to list Cloudflare zones: ${err.message}`);
    return null;
  }

  // Pick a zone
  const zoneChoice = await searchWithEsc({
    message: "Select Cloudflare zone:",
    choices: zones.map((z) => ({ name: `${z.name} (${z.status})`, value: { id: z.id, name: z.name } })),
  });
  if (!zoneChoice) return null;
  const { id: zoneId, name: zoneName } = zoneChoice;
  console.log(`Zone "${zoneName}" selected (${zoneId}).`);

  // Collect subdomain
  const subdomain = await input({
    message: `Subdomain for ${zoneName} (e.g. agents):`,
    validate: (v: string) => {
      if (!v.trim()) return "Subdomain is required";
      if (v.trim().includes(" ")) return "Subdomain must not contain spaces";
      if (v.trim().endsWith(`.${zoneName}`) || v.trim() === zoneName) return "Enter only the subdomain part, not the full domain";
      return true;
    },
  });
  const hostname = `${subdomain.trim()}.${zoneName}`;

  return { apiToken, zoneId, zoneName, hostname };
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

async function provisionVultr(onInstanceCreated?: OnInstanceCreated, cfConfig?: CloudflareConfig | null): Promise<Record<string, unknown> | null> {
  // 1. Read Vultr API key — prompt inline if missing
  const backend = new FilesystemBackend();
  let apiKeyValue = await backend.read("vultr_api_key", "default", "api_key");
  if (!apiKeyValue) {
    console.log("Vultr API key not found.");
    const enteredKey = await password({
      message: "Enter your Vultr API key (from https://my.vultr.com/settings/#settingsapi):",
      mask: "*",
      validate: (v: string) => v.trim() ? true : "API key is required",
    });
    apiKeyValue = enteredKey.trim();
    await writeCredentialField("vultr_api_key", "default", "api_key", apiKeyValue);
    console.log("Vultr API key saved.");
  }

  const {
    listRegions,
    listPlans,
    listOsImages,
    listSshKeys,
    createSshKey,
    createInstance,
    getInstance,
  } = await import("./vultr-api.js");

  // Fetch plans + regions + OS images + SSH keys in parallel
  console.log("\nFetching Vultr catalog...");
  const [allPlans, regions, allOsImages, existingKeys] = await Promise.all([
    listPlans(apiKeyValue),
    listRegions(apiKeyValue),
    listOsImages(apiKeyValue),
    listSshKeys(apiKeyValue),
  ]);

  const planChoices = allPlans
    .sort((a, b) => a.monthly_cost - b.monthly_cost)
    .map((p) => ({
      name: `${p.vcpu_count} vCPU / ${p.ram}MB RAM / ${p.disk}GB SSD — $${p.monthly_cost}/mo (${p.type}: ${p.id})`,
      value: p.id,
    }));

  // Step-based wizard: Esc goes back to the previous step
  // Steps: 0=Plan, 1=Region, 2=OS, 3=SSH key
  let step = 0;
  let planChoice = "";
  let regionChoice = "";
  let osChoice: number = VPS_CONSTANTS.PREFERRED_OS_ID;
  let sshKeyId = "";
  let sshKeyPath: string = VPS_CONSTANTS.DEFAULT_SSH_KEY_PATH;

  while (step < 4) {
    if (step === 0) {
      // 2. Pick plan first (searchable, all types)
      const result = await searchWithEsc({ message: "Plan:", choices: planChoices });
      if (result === null) return null; // Esc at first step → abort
      planChoice = result;
      step++;
    } else if (step === 1) {
      // 3. Pick region (filtered to where the selected plan is available)
      const selectedPlan = allPlans.find((p) => p.id === planChoice)!;
      const availableRegionIds = new Set(selectedPlan.locations);
      const regionChoices = regions
        .filter((r) => availableRegionIds.has(r.id))
        .sort((a, b) => a.city.localeCompare(b.city))
        .map((r) => ({
          name: `${r.city}, ${r.country} (${r.id})`,
          value: r.id,
        }));

      if (regionChoices.length === 0) {
        console.error("This plan is not available in any region.");
        step--;
        continue;
      }

      const result = await searchWithEsc({ message: "Region:", choices: regionChoices });
      if (result === null) { step--; continue; }
      regionChoice = result;
      step++;
    } else if (step === 2) {
      // 4. Pick OS — filter to x64 Linux images, sorted with Ubuntu/Debian first
      const selectedPlan = allPlans.find((p) => p.id === planChoice)!;
      const osChoices = allOsImages
        .filter((o) => o.arch === "x64" && o.family !== "windows" && o.family !== "iso")
        .sort((a, b) => {
          // Prefer Ubuntu, then Debian, then alphabetical
          const rank = (o: typeof a) => o.family === "ubuntu" ? 0 : o.family === "debian" ? 1 : 2;
          return rank(a) - rank(b) || a.name.localeCompare(b.name);
        })
        .map((o) => ({ name: o.name, value: o.id }));

      if (selectedPlan.ram < 1024) {
        console.log(`Note: plan has ${selectedPlan.ram}MB RAM — some OS images (e.g. Ubuntu 24.04) require at least 1GB.`);
      }

      // Auto-select Ubuntu 24.04 if it's in the list and plan has enough RAM
      const preferredExists = osChoices.some((o) => o.value === VPS_CONSTANTS.PREFERRED_OS_ID);
      if (preferredExists && selectedPlan.ram >= 1024) {
        osChoice = VPS_CONSTANTS.PREFERRED_OS_ID;
        const osName = allOsImages.find((o) => o.id === osChoice)!.name;
        console.log(`OS: ${osName} (auto-selected)`);
      } else {
        const result = await searchWithEsc({ message: "OS image:", choices: osChoices });
        if (result === null) { step--; continue; }
        osChoice = result;
      }
      step++;
    } else if (step === 3) {
      // 5. SSH key — use vps_ssh credential, Vultr keys, or create new
      const { loadCredentialFields, credentialExists: credExists } = await import("../../shared/credentials.js");
      const { promptCredential } = await import("../../credentials/prompter.js");
      const { resolveCredential } = await import("../../credentials/registry.js");

      // Check for existing vps_ssh credential
      const hasVpsSsh = await credExists("vps_ssh", "default");
      const vpsSshFields = hasVpsSsh ? await loadCredentialFields("vps_ssh", "default") : undefined;

      // Build choices
      const keyChoices: Array<{ name: string; value: string }> = [];

      if (vpsSshFields?.public_key) {
        const preview = vpsSshFields.public_key.slice(0, 40) + "...";
        keyChoices.push({ name: `Action Llama VPS key (${preview})`, value: "__al_credential__" });
      }

      for (const k of existingKeys) {
        keyChoices.push({
          name: `Vultr: ${k.name} (${k.ssh_key.slice(0, 30)}...)`,
          value: k.id,
        });
      }

      keyChoices.push({ name: "Set up a new VPS SSH key", value: "__new__" });

      const result = await searchWithEsc({ message: "SSH key:", choices: keyChoices });
      if (result === null) { step--; continue; }

      const vpsSshKeyPath = resolve(credentialDir("vps_ssh", "default"), "private_key");

      if (result === "__new__") {
        // Run the vps_ssh credential prompt
        const def = resolveCredential("vps_ssh");
        const promptResult = await promptCredential(def, "default");
        if (!promptResult) {
          continue; // User cancelled — stay on this step
        }
        // Persist the credential before uploading to Vultr
        await writeCredentialFields("vps_ssh", "default", promptResult.values);
        sshKeyPath = vpsSshKeyPath;
        const pubKey = promptResult.values.public_key;
        // Upload to Vultr
        const uploaded = await createSshKey(apiKeyValue, "action-llama", pubKey);
        sshKeyId = uploaded.id;
        console.log("SSH key uploaded to Vultr.");
      } else if (result === "__al_credential__") {
        sshKeyPath = vpsSshKeyPath;
        // Upload the existing vps_ssh public key to Vultr if not already there
        const pubKey = vpsSshFields!.public_key;
        const alreadyOnVultr = existingKeys.find((k) => k.ssh_key.trim() === pubKey.trim());
        if (alreadyOnVultr) {
          sshKeyId = alreadyOnVultr.id;
        } else {
          const uploaded = await createSshKey(apiKeyValue, "action-llama", pubKey);
          sshKeyId = uploaded.id;
          console.log("VPS SSH key uploaded to Vultr.");
        }
      } else {
        sshKeyId = result;
      }
      step++;
    }
  }

  // 5. Set up Vultr firewall group (allow SSH + gateway inbound)
  const {
    listFirewallGroups,
    createFirewallGroup,
    createFirewallRule,
    listFirewallRules,
  } = await import("./vultr-api.js");

  const AL_FW_DESCRIPTION = "action-llama";
  let firewallGroupId: string | undefined;

  console.log("\nConfiguring Vultr firewall...");
  const fwGroups = await listFirewallGroups(apiKeyValue);
  const existing = fwGroups.find((g) => g.description === AL_FW_DESCRIPTION);

  if (existing) {
    firewallGroupId = existing.id;
  } else {
    const group = await createFirewallGroup(apiKeyValue, AL_FW_DESCRIPTION);
    firewallGroupId = group.id;

    // Allow SSH + web ports inbound from anywhere, IPv4 + IPv6
    // HTTPS path: 22, 80, 443 (no direct gateway access)
    // Non-HTTPS path: 22, 3000
    const webPorts = cfConfig
      ? [
          { port: "80", notes: "HTTP redirect" },
          { port: "443", notes: "HTTPS" },
        ]
      : [
          { port: String(VPS_CONSTANTS.DEFAULT_GATEWAY_PORT), notes: "Gateway" },
        ];

    const rules = [
      { ip_type: "v4" as const, protocol: "tcp" as const, subnet: "0.0.0.0", subnet_size: 0, port: "22", notes: "SSH" },
      { ip_type: "v6" as const, protocol: "tcp" as const, subnet: "::", subnet_size: 0, port: "22", notes: "SSH IPv6" },
      ...webPorts.flatMap((wp) => [
        { ip_type: "v4" as const, protocol: "tcp" as const, subnet: "0.0.0.0", subnet_size: 0, port: wp.port, notes: wp.notes },
        { ip_type: "v6" as const, protocol: "tcp" as const, subnet: "::", subnet_size: 0, port: wp.port, notes: `${wp.notes} IPv6` },
      ]),
    ];
    await Promise.all(rules.map((r) => createFirewallRule(apiKeyValue, firewallGroupId!, r)));
  }
  console.log("Vultr firewall group ready (SSH + gateway allowed).");

  // 6. Create instance with firewall group attached
  console.log("Provisioning Vultr instance...");
  const userData = Buffer.from(VPS_CONSTANTS.CLOUD_INIT_SCRIPT).toString("base64");
  const instance = await createInstance(apiKeyValue, {
    region: regionChoice,
    plan: planChoice,
    os_id: osChoice,
    sshkey_id: [sshKeyId],
    label: "action-llama",
    user_data: userData,
    firewall_group_id: firewallGroupId,
  });
  console.log(`Instance ${instance.id} created.`);

  // Persist immediately so the instance can be deprovisioned even if we're interrupted
  const partialResult: Record<string, unknown> = {
    provider: "vps",
    host: "PENDING",
    vultrInstanceId: instance.id,
    vultrRegion: regionChoice,
  };
  if (onInstanceCreated) onInstanceCreated(partialResult);

  // 7. Poll until active + SSH available + Docker installed
  console.log("Waiting for it to become active...");
  const sshConfig: SshConfig = {
    host: "",
    user: VPS_CONSTANTS.DEFAULT_SSH_USER,
    port: VPS_CONSTANTS.DEFAULT_SSH_PORT,
    keyPath: sshKeyPath,
  };

  const startTime = Date.now();
  const maxWaitMs = 10 * 60 * 1000; // 10 minutes

  while (Date.now() - startTime < maxWaitMs) {
    const current = await getInstance(apiKeyValue, instance.id);

    if (current.status === "active" && current.main_ip !== "0.0.0.0") {
      sshConfig.host = current.main_ip;

      // Update persisted config with real IP as soon as we know it
      if (partialResult.host === "PENDING") {
        partialResult.host = current.main_ip;
        if (onInstanceCreated) onInstanceCreated(partialResult);
        console.log(`Instance active at ${current.main_ip}. Waiting for SSH...`);
      }

      // Wait for SSH
      const sshReady = await testConnection(sshConfig);
      if (sshReady) {
        // Check if cloud-init has finished installing Node.js + Docker
        const nodeCheck = await sshExec(sshConfig, "node --version");
        const dockerCheck = await sshExec(sshConfig, "docker info --format '{{.ServerVersion}}'");
        if (nodeCheck.exitCode === 0 && dockerCheck.exitCode === 0) {
          console.log(`Node.js ${nodeCheck.stdout.trim()}, Docker ${dockerCheck.stdout.trim()} ready on VPS.`);
          break;
        }
        console.log("Waiting for cloud-init to complete (Node.js + Docker)...");
      }
    } else {
      process.stdout.write(".");
    }

    await new Promise((r) => setTimeout(r, 10_000));
  }

  if (!sshConfig.host || sshConfig.host === "0.0.0.0") {
    console.error("\nTimed out waiting for VPS to become ready.");
    console.error(`Instance ${instance.id} was created. Use 'al env deprov' to clean up.`);
    return null;
  }

  // Final SSH check
  const ok = await testConnection(sshConfig);
  if (!ok) {
    console.error("\nVPS is active but SSH connection failed.");
    console.error(`Instance ${instance.id} at ${sshConfig.host} was created. Use 'al env deprov' to clean up.`);
    return null;
  }

  const shouldContinue = await confirm({
    message: `VPS ready at ${sshConfig.host}. Continue with setup?`,
    default: true,
  });
  if (!shouldContinue) return null;

  const result: Record<string, unknown> = {
    provider: "vps",
    host: sshConfig.host,
    vultrInstanceId: instance.id,
    vultrRegion: regionChoice,
    gatewayUrl: `http://${sshConfig.host}:${VPS_CONSTANTS.DEFAULT_GATEWAY_PORT}`,
  };
  if (sshKeyPath !== VPS_CONSTANTS.DEFAULT_SSH_KEY_PATH) result.sshKeyPath = sshKeyPath;

  // Post-VPS Cloudflare HTTPS setup
  if (cfConfig) {
    try {
      result.cloudflareHostname = cfConfig.hostname;
      result.cloudflareZoneId = cfConfig.zoneId;

      const {
        upsertDnsRecord,
        createOriginCertificate,
        setSslMode,
      } = await import("./cloudflare-api.js");
      const { installNginx, configureNginx } = await import("./nginx.js");

      // 1. DNS record
      console.log(`\nCreating DNS record: ${cfConfig.hostname} → ${sshConfig.host}...`);
      try {
        const dnsRecord = await upsertDnsRecord(cfConfig.apiToken, cfConfig.zoneId, cfConfig.hostname, sshConfig.host, true);
        result.cloudflareDnsRecordId = dnsRecord.id;
        console.log(`DNS record created (${dnsRecord.id}).`);
      } catch (err: any) {
        console.error(`Warning: DNS record creation failed: ${err.message}`);
        console.error(`Falling back to http://${sshConfig.host}:${VPS_CONSTANTS.DEFAULT_GATEWAY_PORT}`);
        return result;
      }

      // 2. Origin CA certificate
      let cert: string, key: string;
      try {
        const existingCert = await backend.read("cloudflare_origin_cert", cfConfig.hostname, "certificate");
        const existingKey = await backend.read("cloudflare_origin_cert", cfConfig.hostname, "private_key");
        const shouldGenerate = existingCert && existingKey
          ? await confirm({ message: "Origin CA certificate already exists. Regenerate?", default: false })
          : true;

        if (shouldGenerate) {
          console.log("Generating Cloudflare Origin CA certificate...");
          const originCert = await createOriginCertificate(cfConfig.apiToken, [cfConfig.hostname], 5475);
          cert = originCert.certificate;
          key = originCert.private_key;
          console.log("Origin CA certificate generated.");
          await writeCredentialFields("cloudflare_origin_cert", cfConfig.hostname, {
            certificate: cert,
            private_key: key,
          });
          console.log(`Origin CA cert saved to credentials (cloudflare_origin_cert/${cfConfig.hostname}).`);
        } else {
          cert = existingCert!;
          key = existingKey!;
          console.log("Using existing Origin CA certificate.");
        }
      } catch (err: any) {
        console.error(`Warning: Origin CA certificate creation failed: ${err.message}`);
        console.error("You can generate one manually at https://dash.cloudflare.com → SSL/TLS → Origin Server.");
        return result;
      }

      // 3. Install nginx
      console.log("Installing nginx...");
      try {
        await installNginx(sshConfig);
        console.log("nginx installed.");
      } catch (err: any) {
        console.error(`Warning: nginx installation failed: ${err.message}`);
        console.error(`SSH into the server and install manually: ssh ${sshConfig.user}@${sshConfig.host}`);
        return result;
      }

      // 4. Configure nginx with cert
      console.log("Configuring nginx TLS reverse proxy...");
      try {
        await configureNginx(sshConfig, cfConfig.hostname, cert, key, VPS_CONSTANTS.DEFAULT_GATEWAY_PORT);
        console.log("nginx configured.");
      } catch (err: any) {
        console.error(`Warning: nginx configuration failed: ${err.message}`);
        console.error(`SSH into the server to configure manually: ssh ${sshConfig.user}@${sshConfig.host}`);
        return result;
      }

      // 5. Set SSL mode to strict
      console.log("Setting Cloudflare SSL mode to strict...");
      try {
        await setSslMode(cfConfig.apiToken, cfConfig.zoneId, "strict");
        console.log("SSL mode set to strict.");
      } catch (err: any) {
        console.error(`Warning: Failed to set SSL mode: ${err.message}`);
        console.error("Set SSL/TLS mode to 'Full (strict)' manually in the Cloudflare dashboard.");
      }

      // 6. Verify nginx is proxying correctly
      const healthCheck = await sshExec(sshConfig, "curl -sf http://localhost/health", 10_000);
      if (healthCheck.exitCode === 0) {
        console.log("nginx reverse proxy verified.");
      } else {
        console.log("Note: nginx health check returned non-zero (gateway may not be running yet).");
      }

      result.gatewayUrl = `https://${cfConfig.hostname}`;
    } catch (err: any) {
      console.error(`Cloudflare HTTPS setup encountered an error: ${err.message}`);
      console.error(`VPS is still available at ${sshConfig.host}. HTTPS can be configured manually.`);
    }
  }

  return result;
}
