import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "fs";
import { resolve } from "path";
import { parse as parseTOML, stringify as stringifyTOML } from "smol-toml";
import type { WebhookTrigger } from "../webhooks/types.js";
import { ConfigError } from "./errors.js";
import {
  resolveEnvironmentName,
  loadEnvToml,
  loadEnvironmentConfig,
  deepMerge,
} from "./environment.js";
import { parseFrontmatter } from "./frontmatter.js";
import { stringify as stringifyYAML } from "yaml";

// --- Global config (lives at <project>/config.toml) ---

export interface ModelConfig {
  provider: string;
  model: string;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  authType: "api_key" | "oauth_token" | "pi_auth";
}

export interface LocalConfig {
  enabled: boolean;        // Docker isolation (default true)
  image?: string;          // Base Docker image (default: CONSTANTS.DEFAULT_IMAGE)
  memory?: string;         // e.g. "4g"
  cpus?: number;
  timeout?: number;        // Max container runtime in seconds
}

export interface VpsConfig {
  provider: "vps";
  host: string;
  sshUser?: string;         // default: "root"
  sshPort?: number;         // default: 22
  sshKeyPath?: string;      // default: ~/.ssh/id_rsa
  // Vultr-specific (present only if AL provisioned the instance)
  vultrInstanceId?: string;
  vultrRegion?: string;
  // Hetzner-specific (present only if AL provisioned the instance)
  hetznerServerId?: number;
  hetznerLocation?: string;
  // Cloudflare-specific (present only if HTTPS was configured)
  cloudflareZoneId?: string;
  cloudflareDnsRecordId?: string;
  cloudflareHostname?: string;
}

export type CloudConfig = VpsConfig;


export interface GatewayConfig {
  port?: number;
  url?: string;
}

export interface WebhookSourceConfig {
  type: string;           // provider type: "github", "sentry"
  credential?: string;    // credential instance name for HMAC validation (optional — omit for unsigned)
}

export interface TelemetryConfig {
  enabled: boolean;
  provider: "otel" | "none";
  endpoint?: string;
  serviceName?: string;
  headers?: Record<string, string>;
  samplingRate?: number;
}

export interface FeedbackConfig {
  enabled: boolean;
  agent?: string; // name of feedback agent, defaults to built-in
  errorPatterns?: string[]; // regex patterns, defaults to ["error", "fail"]
  contextLines?: number; // lines around error, default 2
}

export interface GlobalConfig {
  models?: Record<string, ModelConfig>;
  local?: LocalConfig;
  gateway?: GatewayConfig;
  webhooks?: Record<string, WebhookSourceConfig>;
  telemetry?: TelemetryConfig;
  feedback?: FeedbackConfig;
  projectName?: string;
  maxReruns?: number;
  maxCallDepth?: number;
  /** @deprecated Use maxCallDepth instead */
  maxTriggerDepth?: number;
  /** @deprecated Use workQueueSize instead */
  webhookQueueSize?: number;
  workQueueSize?: number;
  resourceLockTimeout?: number;
  // Max simultaneous agent runs project-wide
  scale?: number;
}

// --- Per-agent config (lives at <project>/agents/<name>/SKILL.md frontmatter) ---

export interface AgentHooks {
  pre?: string[];
  post?: string[];
}

export interface AgentConfig {
  name: string;
  description?: string;
  credentials: string[];
  models: ModelConfig[];
  schedule?: string;
  webhooks?: WebhookTrigger[];
  hooks?: AgentHooks;
  params?: Record<string, unknown>;
  scale?: number; // Number of concurrent runs allowed (default: 1)
  timeout?: number; // Max runtime in seconds (falls back to global local.timeout, then 900)
  feedback?: { enabled?: boolean }; // per-agent feedback override
  license?: string;
  compatibility?: string;
}

// --- Loaders ---

/**
 * Load the raw project config.toml without environment merging.
 * Used internally and by tests that need the raw project config.
 */
export function loadProjectConfig(projectPath: string): GlobalConfig {
  const configPath = resolve(projectPath, "config.toml");
  let config: GlobalConfig = {};

  if (existsSync(configPath)) {
    const raw = readFileSync(configPath, "utf-8");
    try {
      config = parseTOML(raw) as unknown as GlobalConfig;
    } catch (err) {
      throw new ConfigError(
        `Error parsing ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  }

  return config;
}

/**
 * Load the merged global config: config.toml → .env.toml → environment file.
 *
 * @param projectPath - path to the project directory
 * @param envName - explicit environment name (from --env flag); takes precedence over .env.toml and AL_ENV
 */
export function loadGlobalConfig(projectPath: string, envName?: string): GlobalConfig {
  let config = loadProjectConfig(projectPath);

  // Layer 2: .env.toml overrides
  const envToml = loadEnvToml(projectPath);
  let projectName: string | undefined;
  if (envToml) {
    const { environment: _, projectName: pn, ...overrides } = envToml;
    projectName = typeof pn === "string" ? pn : undefined;
    if (Object.keys(overrides).length > 0) {
      config = deepMerge(config, overrides);
    }
  }

  // Layer 3: environment file
  const resolvedEnv = resolveEnvironmentName(envName, projectPath);
  if (resolvedEnv) {
    const envConfig = loadEnvironmentConfig(resolvedEnv);
    config = deepMerge(config, envConfig);
  }

  // Set default telemetry config if not provided
  if (!config.telemetry) {
    config.telemetry = {
      enabled: false,
      provider: "none",
    };
  }

  // projectName is .env.toml-only — not deep-merged from config.toml or environment files
  if (projectName) {
    config.projectName = projectName;
  }

  return config;
}


export function loadAgentConfig(projectPath: string, agentName: string): AgentConfig {
  const agentDir = resolve(projectPath, "agents", agentName);
  const skillPath = resolve(agentDir, "SKILL.md");

  if (!existsSync(skillPath)) {
    throw new ConfigError(`Agent config not found at ${skillPath}.`);
  }

  const raw = readFileSync(skillPath, "utf-8");
  let data: Record<string, unknown>;
  try {
    ({ data } = parseFrontmatter(raw));
  } catch (err) {
    throw new ConfigError(
      `Error parsing ${skillPath}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  const meta = ((data as Record<string, unknown>).metadata ?? {}) as Record<string, unknown>;

  const parsed: Record<string, unknown> = {
    name: agentName,
    // Top-level (platform-allowed)
    description: (data as Record<string, unknown>).description,
    license: (data as Record<string, unknown>).license,
    compatibility: (data as Record<string, unknown>).compatibility,
    // From metadata (AL-specific)
    credentials: meta.credentials,
    models: meta.models,
    schedule: meta.schedule,
    webhooks: meta.webhooks,
    hooks: meta.hooks,
    params: meta.params,
    scale: meta.scale,
    timeout: meta.timeout,
    feedback: meta.feedback,
  };

  // Resolve named model references from global config
  const rawModels = parsed.models as string[] | undefined;
  if (!rawModels || !Array.isArray(rawModels) || rawModels.length === 0) {
    throw new ConfigError(
      `Agent "${agentName}" must have a "models" field listing at least one named model.`
    );
  }

  const global = loadGlobalConfig(projectPath);
  if (!global.models || Object.keys(global.models).length === 0) {
    throw new ConfigError(
      `No models defined in config.toml [models]. Define at least one named model.`
    );
  }

  const resolvedModels: ModelConfig[] = [];
  for (const name of rawModels) {
    const modelDef = global.models[name];
    if (!modelDef) {
      const available = Object.keys(global.models).join(", ");
      throw new ConfigError(
        `Agent "${agentName}" references model "${name}" which is not defined in config.toml. Available: ${available}`
      );
    }
    resolvedModels.push(modelDef);
  }

  parsed.models = resolvedModels;
  return parsed as unknown as AgentConfig;
}

/**
 * Load the SKILL.md body (markdown content after frontmatter).
 * Used by image builder and container entry to get agent instructions.
 */
export function loadAgentBody(projectPath: string, agentName: string): string {
  const skillPath = resolve(projectPath, "agents", agentName, "SKILL.md");
  if (!existsSync(skillPath)) return "";
  const raw = readFileSync(skillPath, "utf-8");
  try {
    const { body } = parseFrontmatter(raw);
    return body;
  } catch (err) {
    throw new ConfigError(
      `Error parsing ${skillPath}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

const AGENT_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9]))*$/;

export function validateAgentName(name: string): void {
  if (!name || name.length > 64) {
    throw new ConfigError(
      `Agent name "${name}" is invalid: must be 1-64 characters.`
    );
  }
  if (!AGENT_NAME_PATTERN.test(name)) {
    throw new ConfigError(
      `Agent name "${name}" is invalid: must contain only lowercase letters, numbers, and hyphens (cannot start or end with a hyphen, no consecutive hyphens).`
    );
  }
  if (name === "default") {
    throw new ConfigError(
      `Agent name "default" is reserved. Choose a different name.`
    );
  }
}

export function validateAgentConfig(config: AgentConfig): void {
  validateAgentName(config.name);

  // scale = 0 disables the agent — skip schedule/webhook requirement
  if (config.scale === 0) return;

  if (!config.schedule && (!config.webhooks || config.webhooks.length === 0)) {
    throw new ConfigError(
      `Agent "${config.name}" must have a schedule, webhooks, or both.`
    );
  }
}

export function discoverAgents(projectPath: string): string[] {
  const excluded = new Set(["node_modules"]);
  const agents: string[] = [];

  if (!existsSync(projectPath)) return agents;

  const agentsPath = resolve(projectPath, "agents");
  if (!existsSync(agentsPath)) return agents;

  for (const entry of readdirSync(agentsPath)) {
    if (excluded.has(entry)) continue;
    if (entry.startsWith(".")) continue;
    const entryPath = resolve(agentsPath, entry);
    if (!statSync(entryPath).isDirectory()) continue;
    if (existsSync(resolve(entryPath, "SKILL.md"))) {
      agents.push(entry);
    }
  }

  return agents.sort();
}

// --- Configuration Update Functions ---

/**
 * Update the project-level scale in config.toml
 */
export function updateProjectScale(projectPath: string, scale: number): void {
  const config = loadProjectConfig(projectPath);
  config.scale = scale;
  
  const configPath = resolve(projectPath, "config.toml");
  const tomlStr = stringifyTOML(config);
  writeFileSync(configPath, tomlStr);
}

/**
 * Update an agent's scale in its SKILL.md frontmatter
 */
export function updateAgentScale(projectPath: string, agentName: string, scale: number): void {
  const agentDir = resolve(projectPath, "agents", agentName);
  const skillPath = resolve(agentDir, "SKILL.md");
  
  if (!existsSync(skillPath)) {
    throw new ConfigError(`Agent config not found at ${skillPath}.`);
  }

  // Read current SKILL.md
  const raw = readFileSync(skillPath, "utf-8");
  const { data, body } = parseFrontmatter(raw);
  
  // Update the scale in metadata
  const metadata = ((data as Record<string, unknown>).metadata ?? {}) as Record<string, unknown>;
  metadata.scale = scale;
  
  // Reconstruct the file with updated metadata
  const updatedData = { ...data, metadata };
  const yamlStr = Object.keys(updatedData).length > 0
    ? stringifyYAML(updatedData).trimEnd()
    : "";
  
  writeFileSync(skillPath, `---\n${yamlStr}\n---\n\n${body}`);
}

/**
 * Get current project scale from config
 */
export function getProjectScale(projectPath: string): number {
  const config = loadGlobalConfig(projectPath);
  return config.scale ?? 5; // Default project scale
}

/**
 * Get current agent scale from config  
 */
export function getAgentScale(projectPath: string, agentName: string): number {
  const config = loadAgentConfig(projectPath, agentName);
  return config.scale ?? 1; // Default agent scale
}
