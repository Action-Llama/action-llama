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
import { resolveWebhookSource, validateTriggerFields } from "../../scheduler/webhook-setup.js";
import { collectCredentialRefs } from "../../shared/credential-refs.js";

export async function execute(opts: { project: string; env?: string; checkOnly?: boolean }): Promise<void> {
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
  const globalConfig = loadGlobalConfig(projectPath, opts.env);
  const webhookSources = globalConfig.webhooks ?? {};
  const credentialRefs = collectCredentialRefs(projectPath, globalConfig);

  // Validate webhook trigger fields
  const triggerErrors: string[] = [];
  for (const name of agents) {
    const config = loadAgentConfig(projectPath, name);
    for (const trigger of config.webhooks || []) {
      const sourceConfig = webhookSources[trigger.source];
      if (!sourceConfig) continue; // resolveWebhookSource already handles this
      triggerErrors.push(...validateTriggerFields(trigger, sourceConfig.type, name));
    }
  }
  if (triggerErrors.length > 0) {
    throw new ConfigError(
      "Invalid webhook trigger configuration:\n" +
      triggerErrors.map(e => `  - ${e}`).join("\n")
    );
  }

  const cloudMode = !!globalConfig.cloud;

  if (credentialRefs.size === 0) {
    console.log("No credentials required by any agent.");
  } else if (opts.checkOnly) {
    await checkCredentials(credentialRefs, globalConfig, cloudMode);
  } else {
    await promptCredentials(credentialRefs);
  }

  // --- Gateway API key (interactive only — CI doesn't need one) ---
  if (!opts.checkOnly) {
    console.log("\nGateway API key:");
    const { key, generated } = await ensureGatewayApiKey();
    if (generated) {
      console.log(`  [new] Generated gateway API key: ${key}`);
      console.log("  Save this key — you'll need it to log into the dashboard.");
    } else {
      console.log("  [ok] Gateway API key already configured.");
    }
  }

  // --- Cloud mode: push creds + reconcile IAM (interactive only) ---

  if (cloudMode && !opts.checkOnly) {
    const cloudConfig = globalConfig.cloud!;

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
  globalConfig: { cloud?: any },
  cloudMode: boolean,
): Promise<void> {
  let okCount = 0;
  const missing: string[] = [];

  if (cloudMode) {
    const cloudConfig = globalConfig.cloud!;

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
        `Push them with 'al doctor --env <name>' first.`
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
