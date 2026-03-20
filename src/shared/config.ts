import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { resolve } from "path";
import { parse as parseTOML } from "smol-toml";
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
  lockTimeout?: number;
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

export interface GlobalConfig {
  model?: ModelConfig;
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
  model: ModelConfig;
  schedule?: string;
  webhooks?: WebhookTrigger[];
  hooks?: AgentHooks;
  params?: Record<string, unknown>;
  scale?: number; // Number of concurrent runs allowed (default: 1)
  timeout?: number; // Max runtime in seconds (falls back to global local.timeout, then 900)
  metadata?: Record<string, string>;
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
    config = parseTOML(raw) as unknown as GlobalConfig;
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
  const { data } = parseFrontmatter(raw);
  const parsed = data as unknown as AgentConfig;
  parsed.name = agentName;

  // Fall back to global [model] if agent doesn't define its own
  if (!parsed.model) {
    const global = loadGlobalConfig(projectPath);
    if (global.model) {
      parsed.model = global.model;
    }
  }

  return parsed;
}

/**
 * Load the SKILL.md body (markdown content after frontmatter).
 * Used by image builder and container entry to get agent instructions.
 */
export function loadAgentBody(projectPath: string, agentName: string): string {
  const skillPath = resolve(projectPath, "agents", agentName, "SKILL.md");
  if (!existsSync(skillPath)) return "";
  const raw = readFileSync(skillPath, "utf-8");
  const { body } = parseFrontmatter(raw);
  return body;
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
