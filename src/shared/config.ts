import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { resolve, basename } from "path";
import type { WebhookTriggerConfig } from "../webhooks/types.js";

// --- Global config (lives at <project>/config.json) ---

export interface ModelConfig {
  provider: string;
  model: string;
  thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  authType: "api_key" | "oauth_token" | "pi_auth";
}

export interface DockerConfig {
  enabled: boolean;
  image?: string;
  memory?: string;
  cpus?: number;
  timeout?: number;
}

export interface BrokerConfig {
  port?: number;
}

export interface WebhooksGlobalConfig {
  githubSecretCredential?: string;
}

export interface GlobalConfig {
  docker?: DockerConfig;
  broker?: BrokerConfig;
  webhooks?: WebhooksGlobalConfig;
}

// --- Per-agent config (lives at <project>/<agent>/config.json) ---

export interface AgentConfig {
  name: string;
  credentials: string[];
  model: ModelConfig;
  schedule?: string;
  prompt: string;
  repos: string[];
  webhooks?: WebhookTriggerConfig;
  params?: Record<string, unknown>;
}

// --- Loaders ---

export function loadGlobalConfig(projectPath: string): GlobalConfig {
  const configPath = resolve(projectPath, "config.json");
  if (!existsSync(configPath)) {
    return {};
  }
  const raw = readFileSync(configPath, "utf-8");
  return JSON.parse(raw) as GlobalConfig;
}

export function loadAgentConfig(projectPath: string, agentName: string): AgentConfig {
  const configPath = resolve(projectPath, agentName, "config.json");
  if (!existsSync(configPath)) {
    throw new Error(
      `Agent config not found at ${configPath}.`
    );
  }
  const raw = readFileSync(configPath, "utf-8");
  const parsed = JSON.parse(raw) as AgentConfig;
  parsed.name = agentName;
  return parsed;
}

export function validateAgentConfig(config: AgentConfig): void {
  if (!config.schedule && !config.webhooks) {
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
    if (existsSync(resolve(entryPath, "config.json"))) {
      agents.push(entry);
    }
  }

  return agents.sort();
}

