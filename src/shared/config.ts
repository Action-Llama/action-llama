import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { resolve } from "path";
import { parse as parseTOML } from "smol-toml";
import type { WebhookTrigger } from "../webhooks/types.js";
import { ConfigError } from "./errors.js";

// --- Global config (lives at <project>/config.toml) ---

export interface ModelConfig {
  provider: string;
  model: string;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  authType: "api_key" | "oauth_token" | "pi_auth";
}

export interface LocalConfig {
  enabled: boolean;        // Docker isolation (default true)
  image?: string;          // Base Docker image (default: AWS_CONSTANTS.DEFAULT_IMAGE)
  memory?: string;         // e.g. "4g"
  cpus?: number;
  timeout?: number;        // Max container runtime in seconds
}

export interface CloudConfig {
  provider: "cloud-run" | "ecs";
  // Cloud Run (GCP)
  gcpProject?: string;
  region?: string;
  artifactRegistry?: string;
  serviceAccount?: string;
  secretPrefix?: string;
  // ECS Fargate (AWS)
  awsRegion?: string;
  ecsCluster?: string;
  ecrRepository?: string;
  executionRoleArn?: string;
  taskRoleArn?: string;
  subnets?: string[];
  securityGroups?: string[];
  awsSecretPrefix?: string;
  buildBucket?: string;             // S3 bucket for CodeBuild source (remote builds)
  // Lambda (auto-routed for ECS agents with timeout <= 900)
  lambdaRoleArn?: string;            // Lambda execution role ARN (or derived per-agent)
  lambdaSubnets?: string[];          // VPC subnets for Lambda (optional)
  lambdaSecurityGroups?: string[];   // Security groups for Lambda (optional)
  // Cloud scheduler (al cloud deploy)
  schedulerCpu?: string;             // CPU for scheduler (e.g. "1024" for App Runner, "1" for Cloud Run)
  schedulerMemory?: string;          // Memory (e.g. "2048" for App Runner, "2Gi" for Cloud Run)
  // App Runner (AWS scheduler)
  appRunnerInstanceRoleArn?: string;  // IAM role assumed by the App Runner instance
  appRunnerAccessRoleArn?: string;    // IAM role for App Runner to pull ECR images
}

export interface GatewayConfig {
  port?: number;
  lockTimeout?: number;
  url?: string;
}

export interface WebhookSourceConfig {
  type: string;           // provider type: "github", "sentry"
  credential?: string;    // credential instance name for HMAC validation (optional — omit for unsigned)
}

export interface GlobalConfig {
  model?: ModelConfig;
  local?: LocalConfig;
  cloud?: CloudConfig;
  gateway?: GatewayConfig;
  webhooks?: Record<string, WebhookSourceConfig>;
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
  params?: Record<string, unknown>;
  scale?: number; // Number of concurrent runs allowed (default: 1)
  timeout?: number; // Max runtime in seconds (falls back to global local.timeout, then 900)
}

// --- Loaders ---

export function loadGlobalConfig(projectPath: string): GlobalConfig {
  const configPath = resolve(projectPath, "config.toml");
  if (!existsSync(configPath)) {
    return {};
  }
  const raw = readFileSync(configPath, "utf-8");
  return parseTOML(raw) as unknown as GlobalConfig;
}

export function loadAgentConfig(projectPath: string, agentName: string): AgentConfig {
  const agentDir = resolve(projectPath, agentName);
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

  for (const entry of readdirSync(projectPath)) {
    if (excluded.has(entry)) continue;
    if (entry.startsWith(".")) continue;
    const entryPath = resolve(projectPath, entry);
    if (!statSync(entryPath).isDirectory()) continue;
    if (existsSync(resolve(entryPath, "agent-config.toml"))) {
      agents.push(entry);
    }
  }

  return agents.sort();
}
