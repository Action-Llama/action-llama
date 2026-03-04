import { input, select, checkbox, confirm } from "@inquirer/prompts";
import { existsSync } from "fs";
import { resolve } from "path";
import { validateGitHubToken } from "./validators.js";
import { loadCredential, writeCredential, writeStructuredCredential } from "../shared/credentials.js";
import { CREDENTIALS_DIR } from "../shared/paths.js";
import type { GlobalConfig, AgentConfig, ModelConfig } from "../shared/config.js";
import type { ScaffoldAgent } from "./scaffold.js";
import type { WebhookFilter, WebhookTriggerConfig } from "../webhooks/types.js";
import { listBuiltinDefinitions, loadDefinition } from "../agents/definitions/loader.js";
import type { AgentDefinition } from "../agents/definitions/schema.js";
import { resolveCredential } from "../credentials/registry.js";
import { promptCredential } from "../credentials/prompter.js";
import type { CredentialDefinition, CredentialPromptResult } from "../credentials/schema.js";
import { listWebhookDefinitions } from "../webhooks/definitions/registry.js";
import type { WebhookDefinition, FilterFieldSpec } from "../webhooks/definitions/schema.js";

interface ConfigureAgentContext {
  availableRepos: Array<{ owner: string; repo: string; fullName: string }>;
  githubUser: string;
  modelConfig: ModelConfig;
  existingAgentNames?: string[];
}

interface ConfigureAgentResult {
  agent: ScaffoldAgent;
  secrets: {
    sentryToken?: string;
    githubWebhookSecret?: string;
    webhookSecrets?: Record<string, string>;
  };
  usesWebhooks: boolean;
}

/**
 * Write credential values to disk based on the definition's field count.
 * Single-field: plain text (backward compatible). Multi-field: JSON.
 */
function writeCredentialValues(def: CredentialDefinition, values: Record<string, string>): void {
  if (Object.keys(values).length === 0) return; // e.g. pi_auth
  if (def.fields.length === 1) {
    const fieldName = def.fields[0].name;
    writeCredential(def.filename, values[fieldName]);
  } else {
    writeStructuredCredential(def.filename, values);
  }
}

/**
 * Prompt for a credential and write it to disk.
 * Returns the prompt result (values + optional params), or undefined if skipped.
 */
async function promptAndStoreCredential(
  def: CredentialDefinition
): Promise<CredentialPromptResult | undefined> {
  const result = await promptCredential(def);
  if (result && Object.keys(result.values).length > 0) {
    writeCredentialValues(def, result.values);
  }
  return result;
}

function formatDefChoice(d: AgentDefinition): string {
  const parts = [d.name];
  if (d.label) parts.push(d.label);
  if (d.description) parts.push(`(${d.description})`);
  return parts.join(" — ");
}

// --- Shared: configure a single agent from a definition ---

export async function configureAgent(
  definition: AgentDefinition,
  context: ConfigureAgentContext
): Promise<ConfigureAgentResult> {
  // Agent name
  const name = await input({
    message: "Agent name:",
    default: definition.name,
    validate: (v) => {
      const trimmed = v.trim();
      if (!trimmed) return "Name is required";
      if (context.existingAgentNames?.includes(trimmed)) return `Agent "${trimmed}" already exists`;
      return true;
    },
  });

  // Repos
  const repoChoices = context.availableRepos.map((r) => ({
    name: r.fullName,
    value: r.fullName,
  }));

  const repos = await checkbox({
    message: `Repos for ${name}:`,
    choices: repoChoices,
    validate: (v) => (v.length > 0 ? true : "Select at least one repo"),
  });

  // Credentials — handle required and optional
  const credentials = [...definition.credentials.required];
  let sentryToken: string | undefined;
  const credentialParams: Record<string, unknown> = {};

  for (const cred of definition.credentials.optional) {
    const def = resolveCredential(cred, definition);
    const result = await promptAndStoreCredential(def);
    if (result) {
      credentials.push(cred);
      if (result.params) {
        Object.assign(credentialParams, result.params);
      }
      if (cred === "sentry-token" && result.values.token) {
        sentryToken = result.values.token;
      }
    }
  }

  // Params — prompt for each non-credential param; resolve credential params
  const params: Record<string, unknown> = {};

  for (const [key, paramDef] of Object.entries(definition.params)) {
    // Credential-linked params are populated by the credential handler above
    if (paramDef.credential) {
      if (credentialParams[key] !== undefined) {
        params[key] = credentialParams[key];
      }
      continue;
    }

    // Resolve special defaults
    let defaultValue = paramDef.default;
    if (defaultValue === "$githubUser") {
      defaultValue = context.githubUser;
    }

    if (paramDef.type === "string") {
      const value = await input({
        message: `${paramDef.description}:`,
        default: defaultValue,
        ...(paramDef.required ? { validate: (v: string) => v.trim().length > 0 ? true : `${key} is required` } : {}),
      });
      if (value.trim()) {
        params[key] = value.trim();
      }
    } else if (paramDef.type === "string[]") {
      const value = await input({
        message: `${paramDef.description} (comma-separated):`,
        default: defaultValue,
      });
      if (value.trim()) {
        params[key] = value.split(",").map((s) => s.trim()).filter(Boolean);
      }
    }
  }

  // Webhook trigger
  const useWebhooks = await confirm({
    message: "Enable webhooks?",
    default: true,
  });

  let webhooks: WebhookTriggerConfig | undefined;
  if (useWebhooks) {
    const allWebhookDefs = listWebhookDefinitions();
    const selectedWebhookIds = await checkbox({
      message: "Which webhook sources?",
      choices: allWebhookDefs.map((d) => ({
        name: `${d.label} — ${d.description}`,
        value: d.id,
      })),
      validate: (v) => (v.length > 0 ? true : "Select at least one webhook source"),
    });

    const filters: WebhookFilter[] = [];
    const selectedWebhookDefs: WebhookDefinition[] = [];
    for (const whId of selectedWebhookIds) {
      const whDef = allWebhookDefs.find((d) => d.id === whId)!;
      selectedWebhookDefs.push(whDef);
      filters.push(await buildFilterFromSpec(whDef, repos));
    }
    webhooks = { filters };
  }

  // Schedule trigger
  const useSchedule = await confirm({
    message: "Run on a schedule?",
    default: !useWebhooks,
  });

  let schedule: string | undefined;
  if (useSchedule) {
    schedule = await input({
      message: `${name} poll interval (cron):`,
      default: "*/5 * * * *",
    });
  }

  // Webhook secrets — prompt for each unique secretCredential from selected webhook definitions
  let githubWebhookSecret: string | undefined;
  const webhookSecrets: Record<string, string> = {};
  if (useWebhooks) {
    const allWebhookDefs = listWebhookDefinitions();
    const selectedDefs = allWebhookDefs.filter((d) =>
      webhooks?.filters.some((f) => f.source === d.id)
    );
    const seenCredentials = new Set<string>();
    for (const whDef of selectedDefs) {
      if (!whDef.secretCredential || seenCredentials.has(whDef.secretCredential)) continue;
      seenCredentials.add(whDef.secretCredential);

      const credDef = resolveCredential(whDef.secretCredential);
      const existingSecret = loadCredential(credDef.filename);
      if (!existingSecret) {
        const value = (await input({
          message: `${whDef.label} webhook secret (${credDef.description}):`,
          validate: (v) => (v.trim().length > 0 ? true : "Secret is required to verify webhook payloads"),
        })).trim();
        webhookSecrets[whDef.secretCredential] = value;
        if (whDef.secretCredential === "github-webhook-secret") {
          githubWebhookSecret = value;
        }
      }
    }
  }

  // Build agent config
  const config: AgentConfig = {
    name,
    credentials,
    model: context.modelConfig,
    repos,
    ...(schedule ? { schedule } : {}),
    ...(webhooks ? { webhooks } : {}),
    ...(Object.keys(params).length > 0 ? { params } : {}),
  };

  return {
    agent: { name, template: definition.name, config },
    secrets: { sentryToken, githubWebhookSecret, webhookSecrets },
    usesWebhooks: useWebhooks,
  };
}

// --- Build webhook filter from a definition's filterSpec via prompts ---

async function buildFilterFromSpec(
  def: WebhookDefinition,
  repos: string[]
): Promise<WebhookFilter> {
  const filter: Record<string, unknown> = { source: def.id };

  // Only add repos for sources that use them (e.g. GitHub)
  if (def.id === "github") {
    filter.repos = repos;
  }

  for (const spec of def.filterSpec) {
    const value = await promptFilterField(spec);
    if (value !== undefined) {
      filter[spec.field] = value;
    }
  }

  return filter as unknown as WebhookFilter;
}

async function promptFilterField(
  spec: FilterFieldSpec
): Promise<string | string[] | undefined> {
  if (spec.type === "multi-select" && spec.options) {
    const choices = spec.options.map((o) => ({
      name: o.label,
      value: o.value,
    }));
    const selected = await checkbox({
      message: `${spec.label}:`,
      choices,
      ...(spec.required
        ? { validate: (v: readonly unknown[]) => (v.length > 0 ? true : `${spec.label} is required`) }
        : {}),
    });
    return selected.length > 0 ? selected : undefined;
  }

  if (spec.type === "text[]") {
    const value = await input({
      message: `${spec.label} (comma-separated):`,
      ...(spec.required
        ? { validate: (v: string) => (v.trim().length > 0 ? true : `${spec.label} is required`) }
        : {}),
    });
    if (value.trim()) {
      return value.split(",").map((s) => s.trim()).filter(Boolean);
    }
    return undefined;
  }

  if (spec.type === "text") {
    const value = await input({
      message: `${spec.label}:`,
      ...(spec.required
        ? { validate: (v: string) => (v.trim().length > 0 ? true : `${spec.label} is required`) }
        : {}),
    });
    return value.trim() || undefined;
  }

  return undefined;
}

// --- Full interactive setup (new command) ---

export async function runSetup(): Promise<{
  globalConfig: GlobalConfig;
  agents: ScaffoldAgent[];
  secrets: {
    githubToken: string;
    sentryToken?: string;
    anthropicKey?: string;
    sshKey?: string;
    githubWebhookSecret?: string;
  };
}> {
  console.log("\n=== Action Llama — Setup ===\n");

  // Step 1: Agent Selection
  console.log("--- Step 1: Agents ---\n");

  const builtinDefs = listBuiltinDefinitions();
  const selectedDefNames = await checkbox({
    message: "Which agents do you want to create?",
    choices: builtinDefs.map((d) => ({
      name: formatDefChoice(d),
      value: d.name,
    })),
    validate: (v) => (v.length > 0 ? true : "Select at least one agent"),
  });

  const selectedDefs = selectedDefNames.map((name) => loadDefinition(name));

  // Collect all required/optional credentials from selected definitions
  const allOptionalCredentials = new Set<string>();
  for (const def of selectedDefs) {
    for (const cred of def.credentials.optional) {
      allOptionalCredentials.add(cred);
    }
  }

  // Step 2: Credentials
  console.log("\n--- Step 2: Credentials ---\n");

  // GitHub token (always required) — use definition-driven prompting
  const githubTokenDef = resolveCredential("github-token");
  const githubTokenResult = await promptAndStoreCredential(githubTokenDef);
  if (!githubTokenResult) throw new Error("GitHub token is required");
  const githubToken = githubTokenResult.values.token;

  console.log("Validating GitHub token...");
  let githubUser: string;
  let availableRepos: Array<{ owner: string; repo: string; fullName: string }>;
  try {
    const result = await validateGitHubToken(githubToken);
    githubUser = result.user;
    availableRepos = result.repos;
    console.log(`Authenticated as: ${githubUser} (${availableRepos.length} repos found)\n`);
  } catch (err: any) {
    throw new Error(`GitHub validation failed: ${err.message}`);
  }

  // SSH key
  console.log("--- Git SSH Key ---\n");
  const sshKeyDef = resolveCredential("id_rsa");
  const sshKeyResult = await promptAndStoreCredential(sshKeyDef);
  const sshKey = sshKeyResult?.values.key;

  // Sentry token (only if any selected definition has it as optional)
  let sentryToken: string | undefined;
  let sentryOrg: string | undefined;
  let sentryProjectSlugs: string[] = [];

  if (allOptionalCredentials.has("sentry-token")) {
    console.log("\n--- Sentry ---\n");
    const sentryDef = resolveCredential("sentry-token");
    const sentryResult = await promptAndStoreCredential(sentryDef);
    if (sentryResult) {
      sentryToken = sentryResult.values.token;
      sentryOrg = sentryResult.params?.sentryOrg as string | undefined;
      sentryProjectSlugs = (sentryResult.params?.sentryProjects as string[] | undefined) || [];
    }
  }

  // Anthropic auth
  console.log("\n--- Anthropic Auth ---\n");
  const anthropicDef = resolveCredential("anthropic-key");
  const anthropicResult = await promptAndStoreCredential(anthropicDef);
  const anthropicKey = anthropicResult?.values.token;
  const authType = (anthropicResult?.params?.authType as "api_key" | "oauth_token" | "pi_auth") || "api_key";

  // Step 3: LLM defaults
  console.log("\n--- Step 3: LLM Defaults ---\n");

  const modelName = await select({
    message: "Select model:",
    choices: [
      { name: "claude-sonnet-4-20250514 (recommended)", value: "claude-sonnet-4-20250514" },
      { name: "claude-opus-4-20250514", value: "claude-opus-4-20250514" },
      { name: "claude-haiku-3-5-20241022", value: "claude-haiku-3-5-20241022" },
    ],
    default: "claude-sonnet-4-20250514",
  });

  const thinkingLevel = await select({
    message: "Thinking level:",
    choices: [
      { name: "off", value: "off" as const },
      { name: "minimal", value: "minimal" as const },
      { name: "low", value: "low" as const },
      { name: "medium (recommended)", value: "medium" as const },
      { name: "high", value: "high" as const },
    ],
    default: "medium" as const,
  });

  const modelConfig: ModelConfig = {
    provider: "anthropic",
    model: modelName,
    thinkingLevel,
    authType,
  };

  // Step 4: Configure each agent
  console.log("\n--- Step 4: Configure Agents ---\n");

  const agents: ScaffoldAgent[] = [];
  let anyWebhooks = false;
  let firstGithubWebhookSecret: string | undefined;

  for (const def of selectedDefs) {
    console.log(`\n  --- Configure ${def.name} agent ---\n`);

    // For init flow, we pre-populate sentry params from the top-level credential gathering
    // so we skip the per-agent sentry prompt.
    const prePopulatedParams: Record<string, unknown> = {};
    for (const [key, paramDef] of Object.entries(def.params)) {
      if (paramDef.credential === "sentry-token") {
        if (key === "sentryOrg" && sentryOrg) {
          prePopulatedParams[key] = sentryOrg;
        } else if (key === "sentryProjects" && sentryProjectSlugs.length > 0) {
          prePopulatedParams[key] = sentryProjectSlugs;
        }
      }
    }

    const result = await configureAgentInit(def, {
      availableRepos,
      githubUser,
      modelConfig,
    }, prePopulatedParams, sentryToken ? true : false);

    if (result.usesWebhooks) {
      anyWebhooks = true;
      if (!firstGithubWebhookSecret) {
        firstGithubWebhookSecret = result.secrets.githubWebhookSecret;
      }
    }

    agents.push(result.agent);
  }

  // GitHub webhook secret (if any agent uses webhooks and not already prompted)
  let githubWebhookSecret: string | undefined = firstGithubWebhookSecret;

  if (anyWebhooks && !githubWebhookSecret) {
    console.log("\n--- GitHub Webhook Secret ---\n");

    const webhookSecretDef = resolveCredential("github-webhook-secret");
    const existingSecret = loadCredential(webhookSecretDef.filename);
    if (existingSecret) {
      const reuse = await confirm({
        message: `Found existing webhook secret in ${CREDENTIALS_DIR}/${webhookSecretDef.filename}. Use it?`,
        default: true,
      });
      if (reuse) {
        githubWebhookSecret = existingSecret;
      }
    }

    if (!githubWebhookSecret) {
      githubWebhookSecret = (await input({
        message: "GitHub webhook secret (set this same value in your GitHub webhook settings):",
        validate: (v) => (v.trim().length > 0 ? true : "Secret is required to verify webhook payloads"),
      })).trim();
    }
  }

  // Build global config
  const globalConfig: GlobalConfig = {};
  if (githubWebhookSecret) {
    globalConfig.webhooks = {
      secretCredentials: { github: "github-webhook-secret" },
    };
  }

  return {
    globalConfig,
    agents,
    secrets: {
      githubToken,
      sentryToken,
      anthropicKey,
      sshKey,
      githubWebhookSecret,
    },
  };
}

/**
 * Init-flow variant: configures an agent from a definition, but skips optional
 * credential prompts (those were handled globally in runSetup).
 */
async function configureAgentInit(
  definition: AgentDefinition,
  context: ConfigureAgentContext,
  prePopulatedParams: Record<string, unknown>,
  hasSentryToken: boolean
): Promise<ConfigureAgentResult> {
  const name = await input({
    message: `Agent name:`,
    default: definition.name,
  });

  const repoChoices = context.availableRepos.map((r) => ({
    name: r.fullName,
    value: r.fullName,
  }));

  const repos = await checkbox({
    message: `Repos for ${name}:`,
    choices: repoChoices,
    validate: (v) => (v.length > 0 ? true : "Select at least one repo"),
  });

  // Credentials from definition
  const credentials = [...definition.credentials.required];
  if (hasSentryToken && definition.credentials.optional.includes("sentry-token")) {
    credentials.push("sentry-token");
  }

  // Params — prompt for non-credential params, use pre-populated for credential params
  const params: Record<string, unknown> = { ...prePopulatedParams };

  for (const [key, paramDef] of Object.entries(definition.params)) {
    if (paramDef.credential) continue; // Already handled

    let defaultValue = paramDef.default;
    if (defaultValue === "$githubUser") {
      defaultValue = context.githubUser;
    }

    if (paramDef.type === "string") {
      const value = await input({
        message: `${paramDef.description}:`,
        default: defaultValue,
        ...(paramDef.required ? { validate: (v: string) => v.trim().length > 0 ? true : `${key} is required` } : {}),
      });
      if (value.trim()) {
        params[key] = value.trim();
      }
    } else if (paramDef.type === "string[]") {
      const value = await input({
        message: `${paramDef.description} (comma-separated):`,
        default: defaultValue,
      });
      if (value.trim()) {
        params[key] = value.split(",").map((s) => s.trim()).filter(Boolean);
      }
    }
  }

  // Webhook trigger
  const useWebhooks = await confirm({
    message: "Enable webhooks?",
    default: true,
  });

  let webhooks: WebhookTriggerConfig | undefined;
  if (useWebhooks) {
    const allWebhookDefs = listWebhookDefinitions();
    const selectedWebhookIds = await checkbox({
      message: "Which webhook sources?",
      choices: allWebhookDefs.map((d) => ({
        name: `${d.label} — ${d.description}`,
        value: d.id,
      })),
      validate: (v) => (v.length > 0 ? true : "Select at least one webhook source"),
    });

    const filters: WebhookFilter[] = [];
    for (const whId of selectedWebhookIds) {
      const whDef = allWebhookDefs.find((d) => d.id === whId)!;
      filters.push(await buildFilterFromSpec(whDef, repos));
    }
    webhooks = { filters };
  }

  // Schedule trigger
  const useSchedule = await confirm({
    message: "Run on a schedule?",
    default: !useWebhooks,
  });

  let schedule: string | undefined;
  if (useSchedule) {
    schedule = await input({
      message: `${name} poll interval (cron):`,
      default: "*/5 * * * *",
    });
  }

  // Build agent config
  const config: AgentConfig = {
    name,
    credentials,
    model: context.modelConfig,
    repos,
    ...(schedule ? { schedule } : {}),
    ...(webhooks ? { webhooks } : {}),
    ...(Object.keys(params).length > 0 ? { params } : {}),
  };

  return {
    agent: { name, template: definition.name, config },
    secrets: {},
    usesWebhooks: useWebhooks,
  };
}

// --- Add agent to existing project ---

export async function runAddAgent(opts: {
  definition: AgentDefinition;
  availableRepos: Array<{ owner: string; repo: string; fullName: string }>;
  githubUser: string;
  modelConfig: ModelConfig;
  existingAgentNames: string[];
}): Promise<{
  agent: ScaffoldAgent;
  secrets: {
    sentryToken?: string;
    githubWebhookSecret?: string;
  };
}> {
  console.log("\n=== Action Llama — Add Agent ===\n");

  const result = await configureAgent(opts.definition, {
    availableRepos: opts.availableRepos,
    githubUser: opts.githubUser,
    modelConfig: opts.modelConfig,
    existingAgentNames: opts.existingAgentNames,
  });

  return {
    agent: result.agent,
    secrets: result.secrets,
  };
}
