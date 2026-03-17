import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { resolve } from "path";
import { parse as parseTOML } from "smol-toml";
import type { WebhookTrigger } from "../webhooks/types.js";
import type { PreflightStep } from "../preflight/schema.js";
import { ConfigError } from "./errors.js";
import {
  resolveEnvironmentName,
  loadEnvToml,
  loadEnvironmentConfig,
  deepMerge,
} from "./environment.js";

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

export interface EcsCloudConfig {
  provider: "ecs";
  awsRegion: string;
  ecsCluster: string;
  ecrRepository: string;
  executionRoleArn: string;
  taskRoleArn: string;
  subnets: string[];
  securityGroups?: string[];
  awsSecretPrefix?: string;
  buildBucket?: string;
  // Lambda (auto-routed for agents with timeout <= 900)
  lambdaRoleArn?: string;
  lambdaSubnets?: string[];
  lambdaSecurityGroups?: string[];
  // Cloud scheduler (al cloud deploy)
  schedulerCpu?: string;
  schedulerMemory?: string;
  // App Runner (AWS scheduler)
  appRunnerInstanceRoleArn?: string;
  appRunnerAccessRoleArn?: string;
}

export interface CloudRunCloudConfig {
  provider: "cloud-run";
  gcpProject: string;
  region: string;
  artifactRegistry: string;
  serviceAccount: string;
  secretPrefix?: string;
  // Cloud scheduler (al cloud deploy)
  schedulerCpu?: string;
  schedulerMemory?: string;
}

export type CloudConfig = EcsCloudConfig | CloudRunCloudConfig;

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
  provider: "otel" | "xray" | "none";
  endpoint?: string;
  serviceName?: string;
  headers?: Record<string, string>;
  samplingRate?: number;
}

export interface GlobalConfig {
  model?: ModelConfig;
  local?: LocalConfig;
  cloud?: CloudConfig;
  gateway?: GatewayConfig;
  webhooks?: Record<string, WebhookSourceConfig>;
  telemetry?: TelemetryConfig;
  maxReruns?: number;
  maxCallDepth?: number;
  /** @deprecated Use maxCallDepth instead */
  maxTriggerDepth?: number;
  /** @deprecated Use workQueueSize instead */
  webhookQueueSize?: number;
  workQueueSize?: number;
}

// --- Per-agent config (lives at <project>/<agent>/agent-config.toml) ---

export interface AgentConfig {
  name: string;
  credentials: string[];
  model: ModelConfig;
  schedule?: string;
  webhooks?: WebhookTrigger[];
  preflight?: PreflightStep[];
  params?: Record<string, unknown>;
  scale?: number; // Number of concurrent runs allowed (default: 1)
  timeout?: number; // Max runtime in seconds (falls back to global local.timeout, then 900)
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

  // Emit deprecation warning if [cloud] is in config.toml
  if (config.cloud) {
    console.error(
      "[DEPRECATED] [cloud] section found in config.toml. " +
      "Move cloud infrastructure config to an environment file. " +
      "Run 'al env init <name>' to create one."
    );
  }

  // Layer 2: .env.toml overrides
  const envToml = loadEnvToml(projectPath);
  if (envToml) {
    const { environment: _, ...overrides } = envToml;
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

  // Validate cloud config if present (from any layer)
  if (config.cloud) {
    config.cloud = validateCloudConfig(config.cloud);
  }

  return config;
}

export function validateCloudConfig(raw: any): CloudConfig {
  if (!raw.provider) {
    throw new ConfigError("cloud.provider is required");
  }

  if (raw.provider === "ecs") {
    const required = ["awsRegion", "ecsCluster", "ecrRepository", "executionRoleArn", "taskRoleArn", "subnets"] as const;
    const missing = required.filter((k) => !raw[k] || (Array.isArray(raw[k]) && raw[k].length === 0));
    if (missing.length > 0) {
      throw new ConfigError(
        `ECS cloud config is missing required fields: ${missing.map((k) => `cloud.${k}`).join(", ")}. ` +
        `Run 'al env init <name>' to configure.`
      );
    }
    return raw as EcsCloudConfig;
  }

  if (raw.provider === "cloud-run") {
    const required = ["gcpProject", "region", "artifactRegistry", "serviceAccount"] as const;
    const missing = required.filter((k) => !raw[k]);
    if (missing.length > 0) {
      throw new ConfigError(
        `Cloud Run config is missing required fields: ${missing.map((k) => `cloud.${k}`).join(", ")}. ` +
        `Run 'al env init <name>' to configure.`
      );
    }
    return raw as CloudRunCloudConfig;
  }

  throw new ConfigError(`Unknown cloud provider: "${raw.provider}". Supported: ecs, cloud-run`);
}

export function loadAgentConfig(projectPath: string, agentName: string): AgentConfig {
  const agentDir = resolve(projectPath, "agents", agentName);
  const tomlPath = resolve(agentDir, "agent-config.toml");

  if (!existsSync(tomlPath)) {
    throw new ConfigError(`Agent config not found at ${tomlPath}.`);
  }

  const raw = readFileSync(tomlPath, "utf-8");
  const parsed = parseTOML(raw) as unknown as AgentConfig;
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

const AGENT_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

export function validateAgentName(name: string): void {
  if (!name || name.length > 63) {
    throw new ConfigError(
      `Agent name "${name}" is invalid: must be 1-63 characters.`
    );
  }
  if (!AGENT_NAME_PATTERN.test(name)) {
    throw new ConfigError(
      `Agent name "${name}" is invalid: must contain only lowercase letters, numbers, and hyphens (cannot start or end with a hyphen).`
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
    if (existsSync(resolve(entryPath, "agent-config.toml"))) {
      agents.push(entry);
    }
  }

  return agents.sort();
}
