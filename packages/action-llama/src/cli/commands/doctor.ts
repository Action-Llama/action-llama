import { resolve } from "path";
import { existsSync, readFileSync } from "fs";
import { discoverAgents, loadAgentRuntimeConfig, loadGlobalConfig, validateAgentConfig, loadProjectConfig } from "../../shared/config.js";
import { resolveCredential } from "../../credentials/registry.js";
import { promptCredential } from "../../credentials/prompter.js";
import { parseCredentialRef, credentialExists, writeCredentialFields } from "../../shared/credentials.js";
import { ConfigError, CredentialError } from "../../shared/errors.js";
import { ensureGatewayApiKey } from "../../control/api-key.js";
import { resolveWebhookSource, validateTriggerFields, KNOWN_PROVIDER_TYPES, PROVIDER_TO_CREDENTIAL } from "../../events/webhook-setup.js";
import { collectCredentialRefs } from "../../shared/credential-refs.js";
import { parseFrontmatter } from "../../shared/frontmatter.js";
import { parse as parseTOML } from "smol-toml";
import {
  validateGlobalConfig,
  validateAgentConfig as validateAgentConfigEnhanced,
  detectGlobalConfigUnknownFields,
  detectAgentFrontmatterUnknownFields,
  detectAgentRuntimeConfigUnknownFields,
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

  const globalConfig = loadGlobalConfig(projectPath, opts.env);
  const webhookSources = globalConfig.webhooks ?? {};

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

      // Check for unknown fields (always an error)
      const unknownFields = detectGlobalConfigUnknownFields(parsedConfig);
      if (unknownFields.length > 0) {
        validationErrors.push(`Unknown fields in config.toml: ${unknownFields.join(", ")}`);
      }
    }
  } catch (err) {
    validationErrors.push(`Error reading global config: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Validate each agent config with enhanced validation
  // Uses raw runtime config to avoid throwing on unresolved model references
  for (const name of agents) {
    try {
      const agentDir = resolve(projectPath, "agents", name);
      const skillPath = resolve(agentDir, "SKILL.md");

      if (existsSync(skillPath)) {
        const rawSkill = readFileSync(skillPath, "utf-8");
        const { data } = parseFrontmatter(rawSkill);

        const runtime = loadAgentRuntimeConfig(projectPath, name);

        // Build a partial AgentConfig for the enhanced validator without resolving models
        // (model reference validation is handled separately below)
        const partialConfig = {
          name,
          credentials: runtime.credentials ?? [],
          models: [] as any[],
          schedule: runtime.schedule,
          webhooks: runtime.webhooks,
          scale: runtime.scale,
          timeout: runtime.timeout,
        };

        // Load raw runtime config for schema validation
        const configTomlPath = resolve(agentDir, "config.toml");
        let rawRuntimeConfig: unknown;
        if (existsSync(configTomlPath)) {
          rawRuntimeConfig = parseTOML(readFileSync(configTomlPath, "utf-8"));
        }

        const agentValidation = validateAgentConfigEnhanced(partialConfig, data, rawRuntimeConfig);

        validationErrors.push(...agentValidation.errors.map(e =>
          `Agent "${name}": ${e.message}${e.field ? ` (${e.field})` : ""}`
        ));
        validationWarnings.push(...agentValidation.warnings.map(e =>
          `Agent "${name}": ${e.message}${e.field ? ` (${e.field})` : ""}`
        ));

        // Check for unknown fields in agent SKILL.md frontmatter
        const unknownFrontmatter = detectAgentFrontmatterUnknownFields(data);
        if (unknownFrontmatter.length > 0) {
          validationErrors.push(`Unknown fields in agent "${name}" SKILL.md: ${unknownFrontmatter.join(", ")}`);
        }

        // Check for unknown fields in agent config.toml
        if (rawRuntimeConfig) {
          const unknownRuntime = detectAgentRuntimeConfigUnknownFields(rawRuntimeConfig);
          if (unknownRuntime.length > 0) {
            validationErrors.push(`Unknown fields in agent "${name}" config.toml: ${unknownRuntime.join(", ")}`);
          }
        }
      }
    } catch (err) {
      validationErrors.push(`Error validating agent "${name}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Validate each agent's config (schedule/webhooks required, name rules)
  // Uses raw runtime config to avoid throwing on unresolved model references
  for (const name of agents) {
    try {
      const runtime = loadAgentRuntimeConfig(projectPath, name);

      // Validate agent name
      try {
        validateAgentConfig({ name, credentials: [], models: [], schedule: runtime.schedule, webhooks: runtime.webhooks, scale: runtime.scale });
      } catch (err) {
        validationErrors.push(err instanceof Error ? err.message : String(err));
      }

      // Validate model references resolve
      const availableModels = globalConfig.models ?? {};
      for (const modelRef of runtime.models ?? []) {
        if (!availableModels[modelRef]) {
          const available = Object.keys(availableModels).join(", ") || "(none)";
          validationErrors.push(
            `Agent "${name}" references model "${modelRef}" which is not defined in config.toml. Available: ${available}`
          );
        }
      }

      // Validate pi_auth is not used (incompatible with container mode)
      for (const modelRef of runtime.models ?? []) {
        const mc = availableModels[modelRef];
        if (mc?.authType === "pi_auth") {
          validationErrors.push(
            `Agent "${name}" uses pi_auth (model "${mc.model}") which is not supported in container mode. ` +
            `Switch to api_key/oauth_token.`
          );
        }
      }
    } catch (err) {
      validationErrors.push(`Error validating agent "${name}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Validate project-wide scale limits
  if (globalConfig.scale !== undefined) {
    const defaultScale = globalConfig.defaultAgentScale ?? 1;
    let totalRequested = 0;
    for (const name of agents) {
      const runtime = loadAgentRuntimeConfig(projectPath, name);
      const agentScale = runtime.scale ?? defaultScale;
      totalRequested += agentScale;
      if (agentScale > globalConfig.scale) {
        validationErrors.push(
          `Agent "${name}" scale (${agentScale}) exceeds project scale limit (${globalConfig.scale})`
        );
      }
    }
    if (totalRequested > globalConfig.scale) {
      validationWarnings.push(
        `Total agent scale (${totalRequested}) exceeds project scale cap (${globalConfig.scale}) — agents will be throttled at startup`
      );
    }
  }

  // Validate webhook source definitions have known provider types
  for (const [sourceName, sourceConfig] of Object.entries(webhookSources)) {
    if (!KNOWN_PROVIDER_TYPES.has(sourceConfig.type)) {
      const known = [...KNOWN_PROVIDER_TYPES].join(", ");
      validationErrors.push(
        `Webhook source "${sourceName}" has unknown type "${sourceConfig.type}". Known types: ${known}`
      );
    }
  }

  // Validate agent webhook triggers reference valid sources with correct fields
  for (const name of agents) {
    const runtime = loadAgentRuntimeConfig(projectPath, name);
    for (const trigger of runtime.webhooks || []) {
      const sourceConfig = webhookSources[trigger.source];
      if (!sourceConfig) {
        const available = Object.keys(webhookSources).join(", ") || "(none)";
        validationErrors.push(
          `Agent "${name}" references webhook source "${trigger.source}" ` +
          `which is not defined in config.toml [webhooks]. Available: ${available}`
        );
        continue;
      }
      validationErrors.push(...validateTriggerFields(trigger, sourceConfig.type, name));
    }
  }

  // Check webhook security configurations (skip when --skip-creds / skipCredentials)
  if (!opts.skipCredentials) {
    for (const [sourceName, sourceConfig] of Object.entries(webhookSources)) {
      const credInstance = sourceConfig.credential ?? "default";
      if (sourceConfig.type !== "test" && sourceConfig.allowUnsigned !== true) {
        const credType = PROVIDER_TO_CREDENTIAL[sourceConfig.type];
        if (credType && !credentialExists(credType, credInstance)) {
          validationErrors.push(
            `Webhook source "${sourceName}" (${sourceConfig.type}) has no webhook secret stored ` +
            `(credential instance "${credInstance}"). ` +
            `Run "al doctor" to configure it, or add allowUnsigned = true for insecure mode.`
          );
        }
      }
    }

    // Show security warnings for allowUnsigned webhook sources
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
  }

  // Display all validation results
  if (validationErrors.length > 0 || validationWarnings.length > 0) {
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

  // Throw after displaying all errors
  if (validationErrors.length > 0) {
    throw new ConfigError(
      `${validationErrors.length} validation error(s) found:\n` +
      validationErrors.map(e => `  - ${e}`).join("\n")
    );
  }

  if (opts.skipCredentials) {
    if (!opts.silent) console.log("Skipping credential checks (--skip-creds).");
  } else {
    // Collect all credential refs from agents (including webhook secrets)
    const credentialRefs = collectCredentialRefs(projectPath, globalConfig);
    if (credentialRefs.size === 0) {
      if (!opts.silent) console.log("No credentials required by any agent.");
    } else if (opts.checkOnly) {
      await checkCredentials(credentialRefs, opts.silent);
    } else {
      await promptCredentials(credentialRefs, opts.silent);
    }
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
