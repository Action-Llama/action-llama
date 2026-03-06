import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { resolve } from "path";
import { parse as parseTOML } from "smol-toml";
import type { WebhookTrigger } from "../webhooks/types.js";

// --- Global config (lives at <project>/config.toml) ---

export interface ModelConfig {
  provider: string;
  model: string;
  thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  authType: "api_key" | "oauth_token" | "pi_auth";
}

export interface DockerConfig {
  enabled: boolean;
  runtime?: "local" | "cloud-run" | "ecs";  // default: "local"
  image?: string;
  memory?: string;
  cpus?: number;
  timeout?: number;
  // Cloud Run settings (required when runtime = "cloud-run")
  gcpProject?: string;
  region?: string;
  artifactRegistry?: string;      // e.g. "us-central1-docker.pkg.dev/my-project/al-images"
  serviceAccount?: string;        // Job SA for secret access + execution
  secretPrefix?: string;          // GSM secret name prefix (default: "action-llama")
  // ECS Fargate settings (required when runtime = "ecs")
  awsRegion?: string;
  ecsCluster?: string;            // ECS cluster name or ARN
  ecrRepository?: string;         // ECR repo URI (e.g. "123456789.dkr.ecr.us-east-1.amazonaws.com/al-images")
  executionRoleArn?: string;      // IAM role for ECS task execution (ECR pull + CW Logs)
  taskRoleArn?: string;           // IAM role for the container (Secrets Manager access)
  subnets?: string[];             // VPC subnet IDs for Fargate tasks
  securityGroups?: string[];      // Security group IDs for Fargate tasks
  awsSecretPrefix?: string;       // Secrets Manager name prefix (default: "action-llama")
}

export interface GatewayConfig {
  port?: number;
}

export interface WebhooksGlobalConfig {
  secretCredentials?: Record<string, string>;  // source → credential name
}

export interface RemoteConfig {
  provider: string;       // "gsm" (Google Secret Manager) or "asm" (AWS Secrets Manager)
  gcpProject?: string;    // required for gsm
  awsRegion?: string;     // required for asm
  secretPrefix?: string;  // prefix for secret names (default: "action-llama")
}

export interface GlobalConfig {
  docker?: DockerConfig;
  gateway?: GatewayConfig;
  webhooks?: WebhooksGlobalConfig;
  remotes?: Record<string, RemoteConfig>;
}

// --- Per-agent config (lives at <project>/<agent>/agent-config.toml) ---

export interface AgentConfig {
  name: string;
  credentials: string[];
  model: ModelConfig;
  schedule?: string;
  repos: string[];
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
  return parsed;
}

export function validateAgentConfig(config: AgentConfig): void {
  if (!config.schedule && (!config.webhooks || config.webhooks.length === 0)) {
    throw new Error(
      `Agent "${config.name}" must have a schedule, webhooks, or both.`
    );
  }
}

export function resolveRemote(projectPath: string, remoteName: string): RemoteConfig {
  const globalConfig = loadGlobalConfig(projectPath);
  const remote = globalConfig.remotes?.[remoteName];
  if (!remote) {
    const available = globalConfig.remotes ? Object.keys(globalConfig.remotes).join(", ") : "(none)";
    throw new Error(`Remote "${remoteName}" not found in config.toml. Available remotes: ${available}`);
  }
  return remote;
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

