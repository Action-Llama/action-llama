import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { select, input, checkbox, confirm } from "@inquirer/prompts";
import { stringify as stringifyTOML } from "smol-toml";
import {
  validateAgentName,
  loadAgentConfig,
  loadGlobalConfig,
  discoverAgents,
} from "../../shared/config.js";
import type { AgentConfig, ModelConfig } from "../../shared/config.js";
import type { WebhookTrigger } from "../../webhooks/types.js";
import { scaffoldAgent } from "../../setup/scaffold.js";
import { resolvePackageRoot } from "../../setup/scaffold.js";
import { listBuiltinCredentialIds, getBuiltinCredential } from "../../credentials/registry.js";

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

    for (const file of ["ACTIONS.md", "agent-config.toml"]) {
      const src = resolve(exampleDir, file);
      if (existsSync(src)) {
        copyFileSync(src, resolve(agentDir, file));
      }
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

  if (!existsSync(resolve(agentDir, "agent-config.toml"))) {
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

  // Write config — strip name (derived from dir) and undefined values
  const { name: _, ...rest } = config;
  const toWrite: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) {
    if (v !== undefined) toWrite[k] = v;
  }
  writeFileSync(
    resolve(agentDir, "agent-config.toml"),
    stringifyTOML(toWrite) + "\n",
  );
  console.log(`Saved ${resolve(agentDir, "agent-config.toml")}`);

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

async function editWebhooks(config: AgentConfig, projectPath: string): Promise<void> {
  let globalConfig;
  try {
    globalConfig = loadGlobalConfig(projectPath);
  } catch {
    globalConfig = {};
  }

  const sources = globalConfig.webhooks;
  if (!sources || Object.keys(sources).length === 0) {
    console.log("No webhook sources in config.toml — add [webhooks.<name>] first.");
    return;
  }

  const sourceNames = Object.keys(sources);
  if (!config.webhooks) config.webhooks = [];

  let back = false;
  while (!back) {
    const action = await select({
      message: "Webhooks:",
      choices: [
        { name: "Add trigger", value: "add" },
        { name: "Remove trigger", value: "remove" },
        { name: "Back", value: "back" },
      ],
    });

    if (action === "back") {
      back = true;
    } else if (action === "add") {
      const source = await select({
        message: "Webhook source:",
        choices: sourceNames.map((s) => ({ name: `${s} (${sources[s].type})`, value: s })),
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
    const action = await select({
      message: "Params:",
      choices: [
        { name: "Add/edit param", value: "add" },
        { name: "Remove param", value: "remove" },
        { name: "Back", value: "back" },
      ],
    });

    if (action === "back") {
      back = true;
    } else if (action === "add") {
      const key = await input({ message: "Param key:" });
      const value = await input({
        message: "Param value:",
        default: config.params![key] != null ? String(config.params![key]) : "",
      });
      config.params![key] = value;
    } else if (action === "remove") {
      const keys = Object.keys(config.params!);
      if (keys.length === 0) {
        console.log("No params to remove.");
        continue;
      }
      const toRemove = await checkbox({
        message: "Select params to remove:",
        choices: keys.map((k) => ({ name: `${k} = ${config.params![k]}`, value: k })),
      });
      for (const key of toRemove) {
        delete (config.params as Record<string, unknown>)[key];
      }
    }
  }

  // Clean up empty object
  if (Object.keys(config.params).length === 0) config.params = undefined;
}
