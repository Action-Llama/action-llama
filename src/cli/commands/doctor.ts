import { resolve } from "path";
import { existsSync } from "fs";
import { discoverAgents, loadAgentConfig, loadGlobalConfig } from "../../shared/config.js";
import { resolveCredential } from "../../credentials/registry.js";
import { promptCredential } from "../../credentials/prompter.js";
import { parseCredentialRef, credentialExists, writeCredentialFields } from "../../shared/credentials.js";
import { createLocalBackend, createBackendFromCloudConfig } from "../../shared/remote.js";
import { ConfigError, CredentialError } from "../../shared/errors.js";
import { createCloudProvider } from "../../cloud/provider.js";
import { ensureGatewayApiKey } from "../../gateway/api-key.js";

// Webhook secret credential types — these support multiple named instances
const WEBHOOK_SECRET_TYPES: Record<string, string> = {
  github: "github_webhook_secret",
  sentry: "sentry_client_secret",
};

export async function execute(opts: { project: string; cloud?: boolean; checkOnly?: boolean }): Promise<void> {
  const projectPath = resolve(opts.project);

  // Guard: refuse to run if the project path looks like an agent directory
  if (existsSync(resolve(projectPath, "agent-config.toml")) || existsSync(resolve(projectPath, "ACTIONS.md"))) {
    throw new ConfigError(
      `"${projectPath}" looks like an agent directory, not a project directory. ` +
      `Run 'al doctor' from the project root (the parent directory).`
    );
  }

  const agents = discoverAgents(projectPath);
  if (agents.length === 0) {
    console.log("No agents found. Create agents first, then re-run doctor.");
    return;
  }

  // Collect all credential refs from agents (including webhook secrets)
  const credentialRefs = new Set<string>();
  const globalConfig = loadGlobalConfig(projectPath);
  const webhookSources = globalConfig.webhooks ?? {};

  for (const name of agents) {
    const config = loadAgentConfig(projectPath, name);
    for (const ref of config.credentials) {
      credentialRefs.add(ref);
    }
    // Derive webhook secret credential refs from global webhook sources
    for (const trigger of config.webhooks || []) {
      const sourceConfig = webhookSources[trigger.source];
      if (!sourceConfig) continue;
      const credType = WEBHOOK_SECRET_TYPES[sourceConfig.type];
      if (credType && sourceConfig.credential) {
        credentialRefs.add(`${credType}:${sourceConfig.credential}`);
      }
    }
  }

  if (credentialRefs.size === 0) {
    console.log("No credentials required by any agent.");
  } else if (opts.checkOnly) {
    await checkCredentials(credentialRefs, projectPath, opts.cloud);
  } else {
    await promptCredentials(credentialRefs);
  }

  // --- Gateway API key ---
  console.log("\nGateway API key:");
  const { key, generated } = await ensureGatewayApiKey();
  if (generated) {
    console.log(`  [new] Generated gateway API key: ${key}`);
    console.log("  Save this key — you'll need it to log into the dashboard.");
  } else {
    console.log("  [ok] Gateway API key already configured.");
  }

  // --- Cloud mode: push creds + reconcile IAM (interactive only) ---

  if (opts.cloud && !opts.checkOnly) {
    const cloudConfig = globalConfig.cloud;

    if (!cloudConfig) {
      throw new ConfigError(
        "No [cloud] section found in config.toml. " +
        "Run 'al setup cloud' to configure a cloud provider first."
      );
    }

    const provider = await createCloudProvider(cloudConfig);

    // Push local creds to cloud
    console.log(`\nPushing credentials to cloud (${cloudConfig.provider})...`);
    const local = createLocalBackend();
    const remote = await provider.createCredentialBackend();
    const localEntries = await local.list();

    if (localEntries.length === 0) {
      console.log("No local credentials found. Run 'al doctor' first to configure them.");
    } else {
      let pushed = 0;
      for (const entry of localEntries) {
        const value = await local.read(entry.type, entry.instance, entry.field);
        if (value !== undefined) {
          await remote.write(entry.type, entry.instance, entry.field, value);
          pushed++;
        }
      }
      console.log(`Pushed ${pushed} credential field(s) to ${cloudConfig.provider}.`);
    }

    // Reconcile infrastructure-level IAM policies (App Runner instance role, etc.)
    console.log(`\nReconciling infrastructure IAM policies...`);
    await provider.reconcileInfraPolicy();

    // Reconcile per-agent IAM (task roles, service accounts, Lambda roles)
    console.log(`\nReconciling agent IAM...`);
    await provider.reconcileAgents(projectPath);

    // Validate IAM roles
    console.log(`\nValidating IAM roles...`);
    await provider.validateRoles(projectPath);
  }
}

// --- Credential check (headless / non-interactive) ---

async function checkCredentials(
  credentialRefs: Set<string>,
  projectPath: string,
  cloud?: boolean,
): Promise<void> {
  let okCount = 0;
  const missing: string[] = [];

  if (cloud) {
    const globalConfig = loadGlobalConfig(projectPath);
    const cloudConfig = globalConfig.cloud;
    if (!cloudConfig) {
      throw new ConfigError(
        "No [cloud] section found in config.toml. " +
        "Run 'al setup cloud' to configure a cloud provider first."
      );
    }

    const remote = await createBackendFromCloudConfig(cloudConfig);
    console.log(`Checking ${credentialRefs.size} credential(s) in ${cloudConfig.provider}...`);

    for (const ref of credentialRefs) {
      const { type, instance } = parseCredentialRef(ref);
      const def = resolveCredential(type);

      if (await remote.exists(type, instance)) {
        console.log(`  [ok] ${def.label} (${ref})`);
        okCount++;
      } else {
        console.log(`  [MISSING] ${def.label} (${ref})`);
        missing.push(ref);
      }
    }

    if (missing.length > 0) {
      throw new CredentialError(
        `${missing.length} credential(s) missing from ${cloudConfig.provider}: ${missing.join(", ")}.\n` +
        `Push them with 'al doctor -c' first.`
      );
    }

    console.log(`${okCount} credential(s) verified in ${cloudConfig.provider}.`);
  } else {
    console.log(`Checking ${credentialRefs.size} credential(s)...`);

    for (const ref of credentialRefs) {
      const { type, instance } = parseCredentialRef(ref);
      const def = resolveCredential(type);

      if (await credentialExists(type, instance)) {
        console.log(`  [ok] ${def.label} (${ref})`);
        okCount++;
      } else {
        console.log(`  [MISSING] ${def.label} (${ref})`);
        missing.push(ref);
      }
    }

    if (missing.length > 0) {
      throw new CredentialError(
        `${missing.length} credential(s) missing: ${missing.join(", ")}.\n` +
        `Run 'al doctor' interactively to configure them.`
      );
    }

    console.log(`${okCount} credential(s) verified.`);
  }
}

// --- Interactive credential prompting ---

async function promptCredentials(credentialRefs: Set<string>): Promise<void> {
  console.log(`\nChecking ${credentialRefs.size} credential(s)...\n`);

  let okCount = 0;
  let promptedCount = 0;

  for (const ref of credentialRefs) {
    const { type, instance } = parseCredentialRef(ref);
    const def = resolveCredential(type);

    if (await credentialExists(type, instance)) {
      console.log(`  [ok] ${def.label} (${ref})`);
      okCount++;
      continue;
    }

    const result = await promptCredential(def, instance);
    if (result && Object.keys(result.values).length > 0) {
      await writeCredentialFields(type, instance, result.values);
      promptedCount++;
    }
  }

  console.log(`\nDone. ${okCount} already present, ${promptedCount} configured.`);
}
