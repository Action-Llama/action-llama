import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { resolve, basename } from "path";
import { parse as parseTOML } from "smol-toml";
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

export interface GatewayConfig {
  port?: number;
}

export interface WebhooksGlobalConfig {
  secretCredentials?: Record<string, string>;  // source → credential name
}

export interface GlobalConfig {
  docker?: DockerConfig;
  gateway?: GatewayConfig;
  webhooks?: WebhooksGlobalConfig;
}

// --- Per-agent config (lives at <project>/<agent>/config.json) ---

export interface AgentConfig {
  name: string;
  credentials: string[];
  model: ModelConfig;
  schedule?: string;
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
  const parsed = JSON.parse(raw) as GlobalConfig & { broker?: GatewayConfig };
  // Backward compat: read old "broker" field if "gateway" is missing
  if (!parsed.gateway && parsed.broker) {
    parsed.gateway = parsed.broker;
    delete parsed.broker;
  }
  return parsed;
}

export function loadAgentConfig(projectPath: string, agentName: string): AgentConfig {
  const agentDir = resolve(projectPath, agentName);
  const tomlPath = resolve(agentDir, "agent-config.toml");
  const jsonPath = resolve(agentDir, "config.json");

  let parsed: AgentConfig;
  if (existsSync(tomlPath)) {
    const raw = readFileSync(tomlPath, "utf-8");
    parsed = parseTOML(raw) as unknown as AgentConfig;
  } else if (existsSync(jsonPath)) {
    const raw = readFileSync(jsonPath, "utf-8");
    parsed = JSON.parse(raw) as AgentConfig;
  } else {
    throw new Error(
      `Agent config not found at ${tomlPath} or ${jsonPath}.`
    );
  }

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
    if (existsSync(resolve(entryPath, "agent-config.toml")) || existsSync(resolve(entryPath, "config.json"))) {
      agents.push(entry);
    }
  }

  return agents.sort();
}

