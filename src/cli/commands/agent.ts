import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { select, input, checkbox, confirm } from "@inquirer/prompts";
import { parse as parseTOML, stringify as stringifyTOML } from "smol-toml";
import { stringify as stringifyYAML } from "yaml";
import {
  validateAgentName,
  loadAgentConfig,
  loadGlobalConfig,
  discoverAgents,
} from "../../shared/config.js";
import { parseFrontmatter } from "../../shared/frontmatter.js";
import type { AgentConfig, ModelConfig } from "../../shared/config.js";
import type { WebhookTrigger } from "../../webhooks/types.js";
import { scaffoldAgent } from "../../setup/scaffold.js";
import { resolvePackageRoot } from "../../setup/scaffold.js";
import { listBuiltinCredentialIds, getBuiltinCredential, resolveCredential } from "../../credentials/registry.js";
import { listCredentialInstances, writeCredentialFields } from "../../shared/credentials.js";
import { promptCredential } from "../../credentials/prompter.js";
import { WEBHOOK_SECRET_TYPES } from "../../shared/credential-refs.js";

const EXAMPLE_TYPES = ["dev", "reviewer", "devops"] as const;

export async function newAgent(opts: { project: string }): Promise<void> {
  const projectPath = resolve(opts.project);

  const agentType = await select({
    message: "Agent type:",
    choices: [
      { name: "dev — issue solver, writes code", value: "dev" },
      { name: "reviewer — PR reviewer", value: "reviewer" },
      { name: "devops — infra and ops tasks", value: "devops" },
      { name: "custom — blank agent", value: "custom" },
    ],
  });

  const name = await input({
    message: "Agent name:",
    validate: (value) => {
      try {
        validateAgentName(value);
      } catch (err: any) {
        return err.message;
      }
      const agentDir = resolve(projectPath, "agents", value);
      if (existsSync(agentDir)) {
        return `Agent "${value}" already exists at ${agentDir}`;
      }
      return true;
    },
  });

  const agentDir = resolve(projectPath, "agents", name);

  if (EXAMPLE_TYPES.includes(agentType as any)) {
    // Copy example template verbatim
    const exampleDir = resolve(resolvePackageRoot(), "docs", "examples", agentType);
    mkdirSync(agentDir, { recursive: true });

    const skillSrc = resolve(exampleDir, "SKILL.md");
    if (existsSync(skillSrc)) {
      copyFileSync(skillSrc, resolve(agentDir, "SKILL.md"));
    } else {
      throw new Error(`Example template "${agentType}" is missing SKILL.md at ${exampleDir}`);
    }
    console.log(`Created agent "${name}" from ${agentType} template.`);
  } else {
    // Custom: use scaffoldAgent with minimal config
    scaffoldAgent(projectPath, {
      name,
      config: {
        name,
        credentials: [],
        model: undefined as unknown as ModelConfig,
      },
    });
    console.log(`Created agent "${name}" (custom).`);
  }

  // Run interactive config
  await configAgent(name, opts);
}

export async function configAgent(name: string, opts: { project: string }): Promise<void> {
  const projectPath = resolve(opts.project);
  const agentDir = resolve(projectPath, "agents", name);

  if (!existsSync(resolve(agentDir, "SKILL.md"))) {
    throw new Error(`Agent "${name}" not found. Run 'al agent new' first.`);
  }

  const config = loadAgentConfig(projectPath, name);

  let done = false;
  while (!done) {
    const credCount = config.credentials?.length ?? 0;
    const webhookCount = config.webhooks?.length ?? 0;
    const paramCount = config.params ? Object.keys(config.params).length : 0;
    const modelLabel = config.model?.provider ?? "inherited";

    const section = await select({
      message: `Configure ${name}:`,
      choices: [
        { name: `Credentials [${credCount} configured]`, value: "credentials" },
        { name: `Model [${modelLabel}]`, value: "model" },
        { name: `Schedule [${config.schedule ?? "none"}]`, value: "schedule" },
        { name: `Webhooks [${webhookCount} trigger${webhookCount !== 1 ? "s" : ""}]`, value: "webhooks" },
        { name: `Params [${paramCount} key${paramCount !== 1 ? "s" : ""}]`, value: "params" },
        { name: "Done — save and run doctor", value: "done" },
      ],
    });

    switch (section) {
      case "credentials":
        await editCredentials(config);
        break;
      case "model":
        await editModel(config);
        break;
      case "schedule":
        await editSchedule(config);
        break;
      case "webhooks":
        await editWebhooks(config, projectPath);
        break;
      case "params":
        await editParams(config);
        break;
      case "done":
        done = true;
        break;
    }
  }

  // Write config back to SKILL.md — preserve the body, update frontmatter
  const { name: _, ...rest } = config;
  const toWrite: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) {
    if (v !== undefined) toWrite[k] = v;
  }
  const skillPath = resolve(agentDir, "SKILL.md");
  const existingBody = existsSync(skillPath)
    ? parseFrontmatter(readFileSync(skillPath, "utf-8")).body
    : `# ${name} Agent\n\nCustom agent.\n`;
  const yamlStr = Object.keys(toWrite).length > 0
    ? stringifyYAML(toWrite).trimEnd()
    : "";
  writeFileSync(skillPath, `---\n${yamlStr}\n---\n\n${existingBody}`);
  console.log(`Saved ${skillPath}`);

  // Run doctor
  const { execute } = await import("./doctor.js");
  await execute({ project: projectPath });
}

// --- Section editors ---

async function editCredentials(config: AgentConfig): Promise<void> {
  const allIds = listBuiltinCredentialIds();
  const current = new Set(config.credentials ?? []);

  const selected = await checkbox({
    message: "Select credentials:",
    choices: allIds.map((id) => {
      const def = getBuiltinCredential(id)!;
      return {
        name: `${def.label} (${id})`,
        value: id,
        checked: current.has(id),
      };
    }),
  });

  config.credentials = selected;
}

async function editModel(config: AgentConfig): Promise<void> {
  const provider = await select({
    message: "Select LLM provider:",
    choices: [
      { name: "Anthropic Claude", value: "anthropic" },
      { name: "OpenAI GPT", value: "openai" },
      { name: "Groq", value: "groq" },
      { name: "Google Gemini", value: "google" },
      { name: "xAI Grok", value: "xai" },
      { name: "Mistral", value: "mistral" },
      { name: "OpenRouter", value: "openrouter" },
      { name: "Other", value: "custom" },
    ],
    default: config.model?.provider ?? "anthropic",
  });

  let modelName: string;
  if (provider === "anthropic") {
    modelName = await select({
      message: "Select model:",
      choices: [
        { name: "claude-sonnet-4-20250514", value: "claude-sonnet-4-20250514" },
        { name: "claude-opus-4-20250514", value: "claude-opus-4-20250514" },
        { name: "claude-haiku-3-5-20241022", value: "claude-haiku-3-5-20241022" },
      ],
      default: config.model?.model ?? "claude-sonnet-4-20250514",
    });
  } else if (provider === "openai") {
    modelName = await select({
      message: "Select model:",
      choices: [
        { name: "gpt-4o", value: "gpt-4o" },
        { name: "gpt-4o-mini", value: "gpt-4o-mini" },
        { name: "gpt-4-turbo", value: "gpt-4-turbo" },
        { name: "o1-preview", value: "o1-preview" },
        { name: "o1-mini", value: "o1-mini" },
      ],
      default: "gpt-4o",
    });
  } else {
    modelName = await input({
      message: `Enter ${provider} model name:`,
      default: provider === "groq" ? "llama-3.3-70b-versatile" :
                provider === "google" ? "gemini-2.0-flash-exp" :
                provider === "xai" ? "grok-beta" :
                provider === "mistral" ? "mistral-large-2411" :
                provider === "openrouter" ? "anthropic/claude-3.5-sonnet" :
                "model-name",
    });
  }

  let thinkingLevel: ModelConfig["thinkingLevel"] | undefined;
  if (provider === "anthropic") {
    thinkingLevel = await select({
      message: "Thinking level:",
      choices: [
        { name: "off", value: "off" as const },
        { name: "minimal", value: "minimal" as const },
        { name: "low", value: "low" as const },
        { name: "medium (recommended)", value: "medium" as const },
        { name: "high", value: "high" as const },
      ],
      default: config.model?.thinkingLevel ?? ("medium" as const),
    });
  }

  config.model = {
    provider,
    model: modelName,
    authType: "api_key",
    ...(thinkingLevel ? { thinkingLevel } : {}),
  };
}

async function editSchedule(config: AgentConfig): Promise<void> {
  const schedule = await input({
    message: "Cron schedule (empty to remove):",
    default: config.schedule ?? "",
    validate: (value) => {
      if (!value) return true;
      const parts = value.trim().split(/\s+/);
      if (parts.length !== 5) return "Cron expression must have 5 space-separated fields";
      return true;
    },
  });

  if (schedule.trim()) {
    config.schedule = schedule.trim();
  } else {
    config.schedule = undefined;
  }
}

const WEBHOOK_PROVIDER_TYPES = ["github", "sentry", "linear", "test"] as const;

async function addWebhookSource(projectPath: string): Promise<Record<string, { type: string; credential?: string }>> {
  const configPath = resolve(projectPath, "config.toml");
  let existing: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    existing = parseTOML(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
  }

  const sourceName = await input({
    message: "Webhook source name (e.g. my-github):",
    validate: (v) => v.trim() ? true : "Name is required",
  });

  const providerType = await select({
    message: "Provider type:",
    choices: WEBHOOK_PROVIDER_TYPES.map((t) => ({ name: t, value: t })),
  });

  // Prompt for webhook secret credential (for HMAC signature validation)
  const credType = WEBHOOK_SECRET_TYPES[providerType];
  let credentialInstance: string | undefined;

  if (credType) {
    credentialInstance = await pickOrAddCredentialInstance(credType);
  }

  const sourceConfig: { type: string; credential?: string } = { type: providerType };
  if (credentialInstance) sourceConfig.credential = credentialInstance;

  // Merge into config.toml
  const webhooks = (existing.webhooks ?? {}) as Record<string, unknown>;
  webhooks[sourceName] = sourceConfig;
  existing.webhooks = webhooks;
  writeFileSync(configPath, stringifyTOML(existing) + "\n");
  console.log(`Added webhook source "${sourceName}" (${providerType}) to config.toml.`);

  return { ...webhooks, [sourceName]: sourceConfig } as Record<string, { type: string; credential?: string }>;
}

/**
 * Let the user pick an existing credential instance or add a new one.
 * Returns the instance name, or undefined to skip.
 */
async function pickOrAddCredentialInstance(credType: string): Promise<string | undefined> {
  const def = resolveCredential(credType);
  const instances = await listCredentialInstances(credType);

  type Choice = { name: string; value: string };
  const choices: Choice[] = [];

  for (const inst of instances) {
    const label = inst === "default" ? `${def.label} (default)` : `${def.label} (${inst})`;
    choices.push({ name: label, value: inst });
  }

  choices.push({ name: "+ Add new webhook secret", value: "__add__" });
  choices.push({ name: "Skip — accept unsigned webhooks", value: "__skip__" });

  const choice = await select({
    message: `${def.label} for signature verification:`,
    choices,
  });

  if (choice === "__skip__") return undefined;

  if (choice === "__add__") {
    const instance = await input({
      message: "Instance name (e.g. default, prod, staging):",
      default: instances.length === 0 ? "default" : "",
      validate: (v) => v.trim() ? true : "Instance name is required",
    });

    const result = await promptCredential(def, instance.trim());
    if (result && Object.keys(result.values).length > 0) {
      await writeCredentialFields(credType, instance.trim(), result.values);
      console.log(`Credential "${credType}:${instance.trim()}" saved.`);
    }
    return instance.trim();
  }

  return choice;
}

async function editWebhooks(config: AgentConfig, projectPath: string): Promise<void> {
  let globalConfig;
  try {
    globalConfig = loadGlobalConfig(projectPath);
  } catch {
    globalConfig = {};
  }

  let sources = globalConfig.webhooks;
  if (!sources || Object.keys(sources).length === 0) {
    console.log("No webhook sources configured in config.toml.");
    const shouldAdd = await confirm({
      message: "Would you like to add a webhook source now?",
      default: true,
    });
    if (!shouldAdd) return;

    sources = await addWebhookSource(projectPath);
  }

  const sourceNames = Object.keys(sources);
  if (!config.webhooks) config.webhooks = [];

  let back = false;
  while (!back) {
    const action = await select({
      message: "Webhooks:",
      choices: [
        { name: "Add trigger", value: "add" },
        { name: "Add webhook source to config.toml", value: "add-source" },
        { name: "Remove trigger", value: "remove" },
        { name: "Back", value: "back" },
      ],
    });

    if (action === "back") {
      back = true;
    } else if (action === "add-source") {
      sources = await addWebhookSource(projectPath);
      sourceNames.length = 0;
      sourceNames.push(...Object.keys(sources));
    } else if (action === "add") {
      const source = await select({
        message: "Webhook source:",
        choices: sourceNames.map((s) => ({ name: `${s} (${sources![s].type})`, value: s })),
      });

      const events = await input({ message: "Events (comma-separated, empty for all):", default: "" });
      const actions = await input({ message: "Actions (comma-separated, empty for all):", default: "" });
      const repos = await input({ message: "Repos (comma-separated, empty for all):", default: "" });
      const labels = await input({ message: "Labels (comma-separated, empty for all):", default: "" });

      const trigger: WebhookTrigger = { source };
      if (events.trim()) trigger.events = events.split(",").map((s) => s.trim());
      if (actions.trim()) trigger.actions = actions.split(",").map((s) => s.trim());
      if (repos.trim()) trigger.repos = repos.split(",").map((s) => s.trim());
      if (labels.trim()) trigger.labels = labels.split(",").map((s) => s.trim());

      config.webhooks!.push(trigger);
      console.log(`Added trigger for source "${source}".`);
    } else if (action === "remove") {
      if (config.webhooks!.length === 0) {
        console.log("No triggers to remove.");
        continue;
      }
      const toRemove = await checkbox({
        message: "Select triggers to remove:",
        choices: config.webhooks!.map((t, i) => ({
          name: `${t.source} [${(t.events ?? ["*"]).join(",")}]`,
          value: i,
        })),
      });
      // Remove in reverse order to preserve indices
      for (const idx of toRemove.sort((a, b) => b - a)) {
        config.webhooks!.splice(idx, 1);
      }
    }
  }

  // Clean up empty array
  if (config.webhooks.length === 0) config.webhooks = undefined;
}

async function editParams(config: AgentConfig): Promise<void> {
  if (!config.params) config.params = {};

  let back = false;
  while (!back) {
    const keys = Object.keys(config.params!);

    // Build choices: existing params as selectable items, plus add/back
    const choices: Array<{ name: string; value: string }> = keys.map((k) => ({
      name: `${k} = ${config.params![k]}`,
      value: `edit:${k}`,
    }));
    choices.push({ name: "+ Add new param", value: "add" });
    choices.push({ name: "Back", value: "back" });

    const action = await select({ message: "Params:", choices });

    if (action === "back") {
      back = true;
    } else if (action === "add") {
      const key = await input({ message: "Param key:" });
      const value = await input({ message: "Param value:" });
      config.params![key] = value;
    } else if (action.startsWith("edit:")) {
      const key = action.slice(5);
      const editAction = await select({
        message: `${key} = ${config.params![key]}`,
        choices: [
          { name: "Edit value", value: "edit" },
          { name: "Remove", value: "remove" },
          { name: "Back", value: "back" },
        ],
      });
      if (editAction === "edit") {
        const value = await input({
          message: `New value for "${key}":`,
          default: String(config.params![key]),
        });
        config.params![key] = value;
      } else if (editAction === "remove") {
        delete (config.params as Record<string, unknown>)[key];
        console.log(`Removed param "${key}".`);
      }
    }
  }

  // Clean up empty object
  if (Object.keys(config.params).length === 0) config.params = undefined;
}
