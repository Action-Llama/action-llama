import { resolve } from "path";
import { existsSync, readFileSync } from "fs";
import { discoverAgents, loadAgentConfig, loadGlobalConfig, validateAgentConfig, loadProjectConfig } from "../../shared/config.js";
import { resolveCredential } from "../../credentials/registry.js";
import { promptCredential } from "../../credentials/prompter.js";
import { parseCredentialRef, credentialExists, writeCredentialFields } from "../../shared/credentials.js";
import { ConfigError, CredentialError } from "../../shared/errors.js";
import { ensureGatewayApiKey } from "../../gateway/api-key.js";
import { resolveWebhookSource, validateTriggerFields, KNOWN_PROVIDER_TYPES } from "../../scheduler/webhook-setup.js";
import { collectCredentialRefs } from "../../shared/credential-refs.js";
import { parseFrontmatter } from "../../shared/frontmatter.js";
import { parse as parseTOML } from "smol-toml";
import {
  validateGlobalConfig,
  validateAgentConfig as validateAgentConfigEnhanced,
  detectGlobalConfigUnknownFields,
  detectAgentConfigUnknownFields,
  type ValidationResult
} from "../../shared/validation.js";

export async function execute(opts: { project: string; env?: string; checkOnly?: boolean; skipCredentials?: boolean; silent?: boolean; strict?: boolean }): Promise<void> {
  const projectPath = resolve(opts.project);

  // Guard: refuse to run if the project path looks like an agent directory
  if (existsSync(resolve(projectPath, "SKILL.md"))) {
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

  // --- Enhanced validation: schema, unknown fields, cron, model compatibility ---
  const validationErrors: string[] = [];
  const validationWarnings: string[] = [];

  // Validate global config schema and detect unknown fields
  try {
    const configPath = resolve(projectPath, "config.toml");
    if (existsSync(configPath)) {
      const rawConfig = readFileSync(configPath, "utf-8");
      const parsedConfig = parseTOML(rawConfig);
      
      const globalValidation = validateGlobalConfig(globalConfig, parsedConfig);
      validationErrors.push(...globalValidation.errors.map(e => `Global config: ${e.message}${e.field ? ` (${e.field})` : ""}`));
      validationWarnings.push(...globalValidation.warnings.map(e => `Global config: ${e.message}${e.field ? ` (${e.field})` : ""}`));

      // Check for unknown fields
      const unknownFields = detectGlobalConfigUnknownFields(parsedConfig);
      if (unknownFields.length > 0) {
        const message = `Unknown fields in config.toml: ${unknownFields.join(", ")}`;
        if (opts.strict) {
          validationErrors.push(message);
        } else {
          validationWarnings.push(message);
        }
      }
    }
  } catch (err) {
    validationErrors.push(`Error reading global config: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Validate each agent config with enhanced validation
  for (const name of agents) {
    try {
      const agentDir = resolve(projectPath, "agents", name);
      const skillPath = resolve(agentDir, "SKILL.md");
      
      if (existsSync(skillPath)) {
        const rawSkill = readFileSync(skillPath, "utf-8");
        const { data } = parseFrontmatter(rawSkill);
        
        const config = loadAgentConfig(projectPath, name);
        const agentValidation = validateAgentConfigEnhanced(config, data);
        
        validationErrors.push(...agentValidation.errors.map(e => 
          `Agent "${name}": ${e.message}${e.field ? ` (${e.field})` : ""}`
        ));
        validationWarnings.push(...agentValidation.warnings.map(e => 
          `Agent "${name}": ${e.message}${e.field ? ` (${e.field})` : ""}`
        ));

        // Check for unknown fields in agent config
        const unknownFields = detectAgentConfigUnknownFields(data);
        if (unknownFields.length > 0) {
          const message = `Unknown fields in agent "${name}": ${unknownFields.join(", ")}`;
          if (opts.strict) {
            validationErrors.push(message);
          } else {
            validationWarnings.push(message);
          }
        }
      }
    } catch (err) {
      validationErrors.push(`Error validating agent "${name}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Validate each agent's config (schedule/webhooks required, name rules)
  for (const name of agents) {
    const config = loadAgentConfig(projectPath, name);
    validateAgentConfig(config);

    // Validate pi_auth is not used (incompatible with container mode)
    for (const mc of config.models ?? []) {
      if (mc.authType === "pi_auth") {
        throw new ConfigError(
          `Agent "${name}" uses pi_auth (model "${mc.model}") which is not supported in container mode. ` +
          `Switch to api_key/oauth_token (run 'al doctor').`
        );
      }
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

  // Validate webhook source definitions have known provider types
  const configErrors: string[] = [];
  for (const [sourceName, sourceConfig] of Object.entries(webhookSources)) {
    if (!KNOWN_PROVIDER_TYPES.has(sourceConfig.type)) {
      const known = [...KNOWN_PROVIDER_TYPES].join(", ");
      configErrors.push(
        `Webhook source "${sourceName}" has unknown type "${sourceConfig.type}". Known types: ${known}`
      );
    }
  }

  // Validate agent webhook triggers reference valid sources with correct fields
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

  // Check webhook security configurations
  const securityErrors: string[] = [];
  for (const [sourceName, sourceConfig] of Object.entries(webhookSources)) {
    if (!sourceConfig.credential && sourceConfig.type !== "test") {
      if (sourceConfig.allowUnsigned !== true) {
        // Missing credential and allowUnsigned not explicitly set to true = error
        securityErrors.push(
          `Webhook source "${sourceName}" (${sourceConfig.type}) has no credential and allowUnsigned is not set to true. ` +
          `Either set credential in config.toml or add allowUnsigned = true for insecure mode.`
        );
      }
    }
  }

  if (securityErrors.length > 0) {
    throw new ConfigError(
      "Configuration errors:\n" +
      securityErrors.map(e => `  - ${e}`).join("\n")
    );
  }

  // Show security warnings for allowUnsigned webhook sources (after error checks pass)
  for (const [sourceName, sourceConfig] of Object.entries(webhookSources)) {
    if (sourceConfig.allowUnsigned && sourceConfig.type !== "test") {
      if (!opts.silent) {
        console.log(
          `  [SECURITY] Webhook source "${sourceName}" allows unsigned requests. ` +
          `This is insecure for production!`
        );
      }
    }
  }

  // Display validation results
  if (validationErrors.length > 0 || validationWarnings.length > 0) {
    // Always show errors (even in silent mode) since we throw on them.
    // Only suppress warnings in silent mode.
    const showWarnings = !opts.silent && validationWarnings.length > 0;
    const showErrors = validationErrors.length > 0;

    if (showWarnings || showErrors) {
      console.log("\n--- Configuration Validation ---");

      if (showWarnings) {
        console.log("\nWarnings:");
        for (const warning of validationWarnings) {
          console.log(`  [warn] ${warning}`);
        }
      }

      if (showErrors) {
        console.log("\nErrors:");
        for (const error of validationErrors) {
          console.log(`  [error] ${error}`);
        }
      }
    }
  }

  // Throw error if there are validation errors
  if (validationErrors.length > 0) {
    throw new ConfigError(
      `${validationErrors.length} validation error(s) found. See details above.`
    );
  }

  if (opts.skipCredentials) {
    if (!opts.silent) console.log("Skipping credential checks (--no-creds).");
  } else if (credentialRefs.size === 0) {
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
