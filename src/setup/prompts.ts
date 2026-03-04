import { input, select, checkbox, confirm } from "@inquirer/prompts";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { validateGitHubToken, validateSentryToken, validateSentryProjects, validateAnthropicApiKey, validateOAuthTokenFormat } from "./validators.js";
import { loadCredential } from "../shared/credentials.js";
import { CREDENTIALS_DIR } from "../shared/paths.js";
import type { GlobalConfig, AgentConfig, ModelConfig } from "../shared/config.js";
import type { ScaffoldAgent } from "./scaffold.js";
import type { GitHubWebhookFilter, WebhookTriggerConfig } from "../webhooks/types.js";
import { listBuiltinDefinitions, loadDefinition } from "../agents/definitions/loader.js";
import type { AgentDefinition } from "../agents/definitions/schema.js";

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
  };
  usesWebhooks: boolean;
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
  let sentryOrg: string | undefined;
  let sentryProjectSlugs: string[] = [];

  for (const cred of definition.credentials.optional) {
    if (cred === "sentry-token") {
      const result = await promptSentryCredential();
      sentryToken = result.sentryToken;
      sentryOrg = result.sentryOrg;
      sentryProjectSlugs = result.sentryProjectSlugs;
      if (sentryToken) {
        credentials.push("sentry-token");
      }
    }
  }

  // Params — prompt for each non-credential param; resolve credential params
  const params: Record<string, unknown> = {};

  for (const [key, paramDef] of Object.entries(definition.params)) {
    // Credential-linked params are populated by the credential handler above
    if (paramDef.credential === "sentry-token") {
      if (key === "sentryOrg" && sentryOrg) {
        params[key] = sentryOrg;
      } else if (key === "sentryProjects" && sentryProjectSlugs.length > 0) {
        params[key] = sentryProjectSlugs;
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
    message: `Listen for webhooks? (${definition.webhooks.description})`,
    default: true,
  });

  let webhooks: WebhookTriggerConfig | undefined;
  if (useWebhooks) {
    const filter = buildWebhookFilter(definition, repos, params);
    webhooks = { filters: [filter] };
  }

  // Schedule trigger
  const useSchedule = await confirm({
    message: "Also run on a schedule (polling)?",
    default: !useWebhooks,
  });

  let schedule: string | undefined;
  if (useSchedule) {
    schedule = await input({
      message: `${name} poll interval (cron):`,
      default: definition.defaultSchedule,
    });
  }

  // Select prompt based on trigger mode
  const prompt = useWebhooks ? definition.prompts.webhook : definition.prompts.schedule;

  // Webhook secret
  let githubWebhookSecret: string | undefined;
  if (useWebhooks) {
    const existingSecret = loadCredential("github-webhook-secret");
    if (!existingSecret) {
      githubWebhookSecret = (await input({
        message: "GitHub webhook secret (set this same value in your GitHub webhook settings):",
        validate: (v) => (v.trim().length > 0 ? true : "Secret is required to verify webhook payloads"),
      })).trim();
    }
  }

  // Build agent config
  const config: AgentConfig = {
    name,
    credentials,
    model: context.modelConfig,
    prompt,
    repos,
    ...(schedule ? { schedule } : {}),
    ...(webhooks ? { webhooks } : {}),
    ...(Object.keys(params).length > 0 ? { params } : {}),
  };

  return {
    agent: { name, template: definition.name, config },
    secrets: { sentryToken, githubWebhookSecret },
    usesWebhooks: useWebhooks,
  };
}

// --- Build webhook filter from definition + params ---

function buildWebhookFilter(
  definition: AgentDefinition,
  repos: string[],
  params: Record<string, unknown>
): GitHubWebhookFilter {
  const filter: GitHubWebhookFilter = {
    source: "github",
    repos,
    events: definition.webhooks.events,
    actions: definition.webhooks.actions,
  };

  // Inject param values into filter via webhookFilter mappings
  for (const [key, paramDef] of Object.entries(definition.params)) {
    if (paramDef.webhookFilter && params[key] !== undefined) {
      const value = params[key];
      const field = paramDef.webhookFilter.field as keyof GitHubWebhookFilter;
      if (paramDef.webhookFilter.wrap === "array") {
        (filter as any)[field] = [value];
      } else {
        (filter as any)[field] = value;
      }
    }
  }

  return filter;
}

// --- Sentry credential handler ---

async function promptSentryCredential(): Promise<{
  sentryToken?: string;
  sentryOrg?: string;
  sentryProjectSlugs: string[];
}> {
  let sentryToken: string | undefined;
  let sentryOrg: string | undefined;
  let sentryProjectSlugs: string[] = [];

  const existingSentryToken = loadCredential("sentry-token");

  if (existingSentryToken) {
    const reuse = await confirm({
      message: `Found existing Sentry token in ${CREDENTIALS_DIR}/sentry-token. Use it?`,
      default: true,
    });
    if (reuse) {
      sentryToken = existingSentryToken;
    }
  }

  if (!sentryToken) {
    const useSentry = await confirm({
      message: "Configure Sentry integration?",
      default: false,
    });
    if (useSentry) {
      sentryToken = (await input({
        message: "Sentry auth token:",
        validate: (v) => (v.trim().length > 0 ? true : "Token is required"),
      })).trim();
    }
  }

  if (sentryToken) {
    console.log("Validating Sentry token...");
    try {
      const { organizations } = await validateSentryToken(sentryToken);
      if (organizations.length === 0) throw new Error("No organizations found");

      if (organizations.length === 1) {
        sentryOrg = organizations[0].slug;
        console.log(`Organization: ${sentryOrg}\n`);
      } else {
        sentryOrg = await select({
          message: "Select Sentry organization:",
          choices: organizations.map((o) => ({ name: `${o.name} (${o.slug})`, value: o.slug })),
        });
      }

      const { projects } = await validateSentryProjects(sentryToken, sentryOrg);
      if (projects.length > 0) {
        sentryProjectSlugs = await checkbox({
          message: "Select Sentry projects to monitor:",
          choices: projects.map((p) => ({ name: p.name, value: p.slug })),
        });
      }
    } catch (err: any) {
      console.log(`Sentry validation failed: ${err.message}. Skipping Sentry.\n`);
      sentryToken = undefined;
    }
  }

  return { sentryToken, sentryOrg, sentryProjectSlugs };
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
      name: `${d.name} — ${d.label} (${d.description})`,
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

  // GitHub token (always required)
  const existingGithubToken = loadCredential("github-token");
  let githubToken: string;

  if (existingGithubToken) {
    const reuse = await confirm({
      message: `Found existing GitHub token in ${CREDENTIALS_DIR}/github-token. Use it?`,
      default: true,
    });
    if (reuse) {
      githubToken = existingGithubToken;
    } else {
      githubToken = (await input({
        message: "GitHub Personal Access Token (needs repo, workflow scopes):",
        validate: (v) => (v.trim().length > 0 ? true : "Token is required"),
      })).trim();
    }
  } else {
    githubToken = (await input({
      message: "GitHub Personal Access Token (needs repo, workflow scopes):",
      validate: (v) => (v.trim().length > 0 ? true : "Token is required"),
    })).trim();
  }

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

  const existingSshKey = existsSync(resolve(CREDENTIALS_DIR, "id_rsa"));
  let sshKey: string | undefined;

  if (existingSshKey) {
    const reuse = await confirm({
      message: `Found existing SSH key in ${CREDENTIALS_DIR}/id_rsa. Use it?`,
      default: true,
    });
    if (!reuse) {
      sshKey = await promptSshKey();
    }
  } else {
    sshKey = await promptSshKey();
  }

  // Sentry token (only if any selected definition has it as optional)
  let sentryToken: string | undefined;
  let sentryOrg: string | undefined;
  let sentryProjectSlugs: string[] = [];

  if (allOptionalCredentials.has("sentry-token")) {
    console.log("\n--- Sentry ---\n");

    const existingSentryToken = loadCredential("sentry-token");

    if (existingSentryToken) {
      const reuse = await confirm({
        message: `Found existing Sentry token in ${CREDENTIALS_DIR}/sentry-token. Use it?`,
        default: true,
      });
      if (reuse) {
        sentryToken = existingSentryToken;
      }
    }

    if (!sentryToken) {
      const useSentry = await confirm({
        message: "Configure Sentry integration?",
        default: false,
      });
      if (useSentry) {
        sentryToken = (await input({
          message: "Sentry auth token:",
          validate: (v) => (v.trim().length > 0 ? true : "Token is required"),
        })).trim();
      }
    }

    if (sentryToken) {
      console.log("Validating Sentry token...");
      try {
        const { organizations } = await validateSentryToken(sentryToken);
        if (organizations.length === 0) {
          throw new Error("No organizations found");
        }

        if (organizations.length === 1) {
          sentryOrg = organizations[0].slug;
          console.log(`Organization: ${sentryOrg}\n`);
        } else {
          sentryOrg = await select({
            message: "Select Sentry organization:",
            choices: organizations.map((o) => ({ name: `${o.name} (${o.slug})`, value: o.slug })),
          });
        }

        const { projects } = await validateSentryProjects(sentryToken, sentryOrg);
        if (projects.length > 0) {
          sentryProjectSlugs = await checkbox({
            message: "Select Sentry projects to monitor:",
            choices: projects.map((p) => ({ name: p.name, value: p.slug })),
          });
        }
      } catch (err: any) {
        console.log(`Sentry validation failed: ${err.message}. Skipping Sentry.\n`);
        sentryToken = undefined;
      }
    }
  }

  // Anthropic auth
  console.log("\n--- Anthropic Auth ---\n");

  const existingAnthropicKey = loadCredential("anthropic-key");
  let authType: "api_key" | "oauth_token" | "pi_auth";
  let anthropicKey: string | undefined;

  if (existingAnthropicKey) {
    const reuse = await confirm({
      message: `Found existing Anthropic credential in ${CREDENTIALS_DIR}/anthropic-key. Use it?`,
      default: true,
    });
    if (reuse) {
      anthropicKey = existingAnthropicKey;
      authType = anthropicKey.includes("sk-ant-oat") ? "oauth_token" : "api_key";
      console.log(`Using existing credential (detected type: ${authType}).\n`);
    } else {
      ({ authType, anthropicKey } = await promptAnthropicAuth());
    }
  } else {
    ({ authType, anthropicKey } = await promptAnthropicAuth());
  }

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
    // We accomplish this by building params for credential-linked params here.
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

    // Use configureAgentInit for init flow (skips credential prompts done globally)
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

    const existingSecret = loadCredential("github-webhook-secret");
    if (existingSecret) {
      const reuse = await confirm({
        message: `Found existing webhook secret in ${CREDENTIALS_DIR}/github-webhook-secret. Use it?`,
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
    globalConfig.webhooks = { githubSecretCredential: "github-webhook-secret" };
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
    message: `Listen for webhooks? (${definition.webhooks.description})`,
    default: true,
  });

  let webhooks: WebhookTriggerConfig | undefined;
  if (useWebhooks) {
    const filter = buildWebhookFilter(definition, repos, params);
    webhooks = { filters: [filter] };
  }

  // Schedule trigger
  const useSchedule = await confirm({
    message: `Also run on a schedule (polling)?`,
    default: !useWebhooks,
  });

  let schedule: string | undefined;
  if (useSchedule) {
    schedule = await input({
      message: `${name} poll interval (cron):`,
      default: definition.defaultSchedule,
    });
  }

  const prompt = useWebhooks ? definition.prompts.webhook : definition.prompts.schedule;

  // Build agent config
  const config: AgentConfig = {
    name,
    credentials,
    model: context.modelConfig,
    prompt,
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

// --- SSH key prompt ---

async function promptSshKey(): Promise<string | undefined> {
  const defaultPath = resolve(process.env.HOME || "~", ".ssh", "id_rsa");
  const keyPath = await input({
    message: `Path to SSH private key for git operations (leave empty to use system default):`,
    default: existsSync(defaultPath) ? defaultPath : "",
  });

  if (!keyPath.trim()) {
    console.log("No SSH key configured — git will use your system SSH config.\n");
    return undefined;
  }

  const resolvedPath = resolve(keyPath.trim());
  if (!existsSync(resolvedPath)) {
    throw new Error(`SSH key not found at ${resolvedPath}`);
  }

  const content = readFileSync(resolvedPath, "utf-8");
  console.log("SSH key loaded.\n");
  return content;
}

// --- Anthropic auth prompt ---

async function promptAnthropicAuth(): Promise<{
  authType: "api_key" | "oauth_token" | "pi_auth";
  anthropicKey: string | undefined;
}> {
  const authMethod = await select({
    message: "How do you want to authenticate with Anthropic?",
    choices: [
      { name: "Use existing pi auth (already ran `pi /login` or `claude setup-token`)", value: "pi_auth" as const },
      { name: "Enter an API key (sk-ant-api...)", value: "api_key" as const },
      { name: "Enter an OAuth token (sk-ant-oat...)", value: "oauth_token" as const },
    ],
  });

  if (authMethod === "pi_auth") {
    const { AuthStorage, ModelRegistry } = await import("@mariozechner/pi-coding-agent");
    const authStorage = AuthStorage.create();
    const registry = new ModelRegistry(authStorage);
    const available = await registry.getAvailable();
    const hasAnthropic = available.some((m: any) => m.provider === "anthropic");
    if (!hasAnthropic) {
      throw new Error(
        "No Anthropic credentials found in pi auth storage (~/.pi/agent/auth.json). " +
        "Run `pi /login` first, or choose a different auth method."
      );
    }
    console.log("Found existing Anthropic credentials in pi auth storage.\n");
    return { authType: "pi_auth", anthropicKey: undefined };
  } else if (authMethod === "api_key") {
    let anthropicKey = (await input({
      message: "Anthropic API key:",
      validate: (v) => (v.trim().length > 0 ? true : "Key is required"),
    })).trim();
    console.log("Validating API key...");
    try {
      await validateAnthropicApiKey(anthropicKey);
      console.log("API key validated.\n");
    } catch (err: any) {
      throw new Error(`Anthropic validation failed: ${err.message}`);
    }
    return { authType: "api_key", anthropicKey };
  } else {
    let anthropicKey = (await input({
      message: "Anthropic OAuth token (from `claude setup-token`):",
      validate: (v) => (v.trim().length > 0 ? true : "Token is required"),
    })).trim();
    try {
      validateOAuthTokenFormat(anthropicKey);
      console.log("OAuth token format looks valid. It will be verified on first agent run.\n");
    } catch (err: any) {
      throw new Error(err.message);
    }
    return { authType: "oauth_token", anthropicKey };
  }
}
