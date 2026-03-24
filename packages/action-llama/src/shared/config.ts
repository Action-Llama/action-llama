import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "fs";
import { resolve, relative, join } from "path";
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
  maxChatSessions?: number;
}

export interface WebhookSourceConfig {
  type: string;           // provider type: "github", "sentry"
  credential?: string;    // credential instance name for HMAC validation (optional — omit for unsigned)
  allowUnsigned?: boolean; // allow unsigned webhooks (default: false, shows warning if true)
}

export interface TelemetryConfig {
  enabled: boolean;
  provider: "otel" | "none";
  endpoint?: string;
  serviceName?: string;
  headers?: Record<string, string>;
  samplingRate?: number;
}

export interface GlobalConfig {
  models?: Record<string, ModelConfig>;
  local?: LocalConfig;
  gateway?: GatewayConfig;
  webhooks?: Record<string, WebhookSourceConfig>;
  telemetry?: TelemetryConfig;
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
  // Default scale for agents without an explicit per-agent config.toml scale (default: 1)
  defaultAgentScale?: number;
  // How many days to keep trigger history and webhook receipts (default: 14)
  historyRetentionDays?: number;
}

// --- Per-agent runtime config (lives at <project>/agents/<name>/config.toml) ---

export interface AgentHooks {
  pre?: string[];
  post?: string[];
}

/**
 * Raw per-agent runtime config from `agents/<name>/config.toml`.
 * Fields here are project-specific bindings — not portable.
 */
export interface AgentRuntimeConfig {
  source?: string;          // Install origin for `al update` (e.g. "author/repo")
  credentials?: string[];
  models?: string[];        // Named model references (resolved against [models.*])
  schedule?: string;
  webhooks?: WebhookTrigger[];
  hooks?: AgentHooks;
  params?: Record<string, unknown>;
  scale?: number;
  timeout?: number;
}

/**
 * Resolved agent config — the runtime representation after merging
 * portable SKILL.md fields with per-agent config.toml and global defaults.
 */
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

  // Validate defaultAgentScale
  if (config.defaultAgentScale !== undefined) {
    if (!Number.isInteger(config.defaultAgentScale) || config.defaultAgentScale < 0) {
      throw new ConfigError("defaultAgentScale must be a non-negative integer.");
    }
  }

  return config;
}


/**
 * Load the raw per-agent runtime config from `agents/<name>/config.toml`.
 */
export function loadAgentRuntimeConfig(projectPath: string, agentName: string): AgentRuntimeConfig {
  const configPath = resolve(projectPath, "agents", agentName, "config.toml");

  if (!existsSync(configPath)) {
    return {};
  }

  const raw = readFileSync(configPath, "utf-8");
  try {
    return parseTOML(raw) as unknown as AgentRuntimeConfig;
  } catch (err) {
    throw new ConfigError(
      `Error parsing ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

export function loadAgentConfig(projectPath: string, agentName: string): AgentConfig {
  const agentDir = resolve(projectPath, "agents", agentName);
  const skillPath = resolve(agentDir, "SKILL.md");

  if (!existsSync(skillPath)) {
    throw new ConfigError(`Agent config not found at ${skillPath}.`);
  }

  // Read portable fields from SKILL.md frontmatter
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

  // Read runtime config from per-agent config.toml
  const runtime = loadAgentRuntimeConfig(projectPath, agentName);

  const parsed: Record<string, unknown> = {
    name: agentName,
    // Portable fields from SKILL.md frontmatter
    description: data.description,
    license: data.license,
    compatibility: data.compatibility,
    // Runtime fields from config.toml
    credentials: runtime.credentials,
    schedule: runtime.schedule,
    webhooks: runtime.webhooks,
    hooks: runtime.hooks,
    params: runtime.params,
    scale: runtime.scale,
    timeout: runtime.timeout,
  };

  // Resolve named model references from global config
  const rawModels = runtime.models;
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

  // Apply defaultAgentScale as fallback when no explicit per-agent scale is set
  if (parsed.scale === undefined && global.defaultAgentScale !== undefined) {
    parsed.scale = global.defaultAgentScale;
  }

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

/**
 * Load all files from `<projectPath>/shared/` recursively.
 * Returns a map of relative paths (prefixed with `shared/`) to file contents.
 * Returns an empty object if the directory doesn't exist.
 */
export function loadSharedFiles(projectPath: string): Record<string, string> {
  const sharedDir = resolve(projectPath, "shared");
  if (!existsSync(sharedDir) || !statSync(sharedDir).isDirectory()) {
    return {};
  }

  const result: Record<string, string> = {};

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith(".")) continue;
      const fullPath = resolve(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (stat.isFile()) {
        const relPath = join("shared", relative(sharedDir, fullPath));
        result[relPath] = readFileSync(fullPath, "utf-8");
      }
    }
  }

  walk(sharedDir);
  return result;
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
  // defaultAgentScale is already applied in loadAgentConfig, so just fall back to 1
  return config.scale ?? 1;
}

/**
 * Update a field in the per-agent config.toml.
 */
export function updateAgentRuntimeField(
  projectPath: string,
  agentName: string,
  field: string,
  value: unknown,
): void {
  const configPath = resolve(projectPath, "agents", agentName, "config.toml");
  let existing: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    existing = parseTOML(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
  }
  existing[field] = value;
  writeFileSync(configPath, stringifyTOML(existing));
}
