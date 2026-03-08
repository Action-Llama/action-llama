import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { resolve } from "path";
import { parse as parseTOML } from "smol-toml";
import type { WebhookTrigger } from "../webhooks/types.js";

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
}

export interface GatewayConfig {
  port?: number;
}

export interface WebhooksGlobalConfig {
  secretCredentials?: Record<string, string>;  // source → credential name
}

export interface GlobalConfig {
  model?: ModelConfig;
  local?: LocalConfig;
  cloud?: CloudConfig;
  gateway?: GatewayConfig;
  webhooks?: WebhooksGlobalConfig;
  maxReruns?: number;
  maxTriggerDepth?: number;
  webhookQueueSize?: number;
}

// --- Per-agent config (lives at <project>/<agent>/agent-config.toml) ---

export interface AgentConfig {
  name: string;
  credentials: string[];
  model: ModelConfig;
  schedule?: string;
  webhooks?: WebhookTrigger[];
  params?: Record<string, unknown>;
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
    throw new Error(`Agent config not found at ${tomlPath}.`);
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

export function validateAgentConfig(config: AgentConfig): void {
  if (!config.schedule && (!config.webhooks || config.webhooks.length === 0)) {
    throw new Error(
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
