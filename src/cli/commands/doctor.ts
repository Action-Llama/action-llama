import { resolve } from "path";
import { existsSync } from "fs";
import { discoverAgents, loadAgentConfig, loadGlobalConfig, validateAgentConfig } from "../../shared/config.js";
import { resolveCredential } from "../../credentials/registry.js";
import { promptCredential } from "../../credentials/prompter.js";
import { parseCredentialRef, credentialExists, writeCredentialFields } from "../../shared/credentials.js";
import { ConfigError, CredentialError } from "../../shared/errors.js";
import { ensureGatewayApiKey } from "../../gateway/api-key.js";
import { resolveWebhookSource, validateTriggerFields } from "../../scheduler/webhook-setup.js";
import { collectCredentialRefs } from "../../shared/credential-refs.js";

export async function execute(opts: { project: string; env?: string; checkOnly?: boolean; silent?: boolean }): Promise<void> {
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

  // Validate each agent's config (schedule/webhooks required, name rules)
  for (const name of agents) {
    const config = loadAgentConfig(projectPath, name);
    validateAgentConfig(config);

    // Validate pi_auth is not used (incompatible with container mode)
    if (config.model?.authType === "pi_auth") {
      throw new ConfigError(
        `Agent "${name}" uses pi_auth which is not supported in container mode. ` +
        `Switch to api_key/oauth_token (run 'al doctor').`
      );
    }
  }

  // Validate project-wide scale limits
  if (globalConfig.scale !== undefined) {
    const scaleViolations: string[] = [];
    for (const name of agents) {
      const config = loadAgentConfig(projectPath, name);
      const agentScale = config.scale ?? 1;
      if (agentScale > globalConfig.scale) {
        scaleViolations.push(
          `Agent "${name}" scale (${agentScale}) exceeds project scale limit (${globalConfig.scale})`
        );
      }
    }
    if (scaleViolations.length > 0) {
      throw new ConfigError(
        "Agent scale violations:\n" +
        scaleViolations.map(e => `  - ${e}`).join("\n")
      );
    }
  }

  // Validate webhook sources exist and trigger fields are correct
  const configErrors: string[] = [];
  for (const name of agents) {
    const config = loadAgentConfig(projectPath, name);
    for (const trigger of config.webhooks || []) {
      // Validate the source exists in [webhooks]
      const sourceConfig = webhookSources[trigger.source];
      if (!sourceConfig) {
        const available = Object.keys(webhookSources).join(", ") || "(none)";
        configErrors.push(
          `Agent "${name}" references webhook source "${trigger.source}" ` +
          `which is not defined in config.toml [webhooks]. Available: ${available}`
        );
        continue;
      }
      configErrors.push(...validateTriggerFields(trigger, sourceConfig.type, name));
    }
  }
  if (configErrors.length > 0) {
    throw new ConfigError(
      "Invalid webhook configuration:\n" +
      configErrors.map(e => `  - ${e}`).join("\n")
    );
  }

  if (credentialRefs.size === 0) {
    if (!opts.silent) console.log("No credentials required by any agent.");
  } else if (opts.checkOnly) {
    await checkCredentials(credentialRefs, opts.silent);
  } else {
    await promptCredentials(credentialRefs, opts.silent);
  }

  // --- Gateway API key (interactive only — CI doesn't need one) ---
  if (!opts.checkOnly) {
    const { key, generated } = await ensureGatewayApiKey();
    if (generated) {
      console.log(`\nGateway API key: ${key}`);
      console.log("Save this key — you'll need it to log into the dashboard.");
    } else if (!opts.silent) {
      console.log("\nGateway API key:");
      console.log("  [ok] Gateway API key already configured.");
    }
  }
}

// --- Credential check (headless / non-interactive) ---

async function checkCredentials(credentialRefs: Set<string>, silent?: boolean): Promise<void> {
  let okCount = 0;
  const missing: string[] = [];

  if (!silent) console.log(`Checking ${credentialRefs.size} credential(s)...`);

  for (const ref of credentialRefs) {
    const { type, instance } = parseCredentialRef(ref);
    const def = resolveCredential(type);

    if (await credentialExists(type, instance)) {
      if (!silent) console.log(`  [ok] ${def.label} (${ref})`);
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

  if (!silent) console.log(`${okCount} credential(s) verified.`);
}

// --- Interactive credential prompting ---

async function promptCredentials(credentialRefs: Set<string>, silent?: boolean): Promise<void> {
  // In silent mode, check if all credentials exist first — skip output entirely if so
  if (silent) {
    const missing: string[] = [];
    for (const ref of credentialRefs) {
      const { type, instance } = parseCredentialRef(ref);
      if (!(await credentialExists(type, instance))) {
        missing.push(ref);
      }
    }
    if (missing.length === 0) return;
    // Fall through to interactive prompting for missing credentials
    console.log(`\n${missing.length} credential(s) need to be configured:\n`);
  } else {
    console.log(`\nChecking ${credentialRefs.size} credential(s)...\n`);
  }

  let okCount = 0;
  let promptedCount = 0;

  for (const ref of credentialRefs) {
    const { type, instance } = parseCredentialRef(ref);
    const def = resolveCredential(type);

    if (await credentialExists(type, instance)) {
      if (!silent) console.log(`  [ok] ${def.label} (${ref})`);
      okCount++;
      continue;
    }

    const result = await promptCredential(def, instance);
    if (result && Object.keys(result.values).length > 0) {
      await writeCredentialFields(type, instance, result.values);
      promptedCount++;
    }
  }

  if (!silent) {
    console.log(`\nDone. ${okCount} already present, ${promptedCount} configured.`);
  }
}
