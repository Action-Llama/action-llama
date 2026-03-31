import type { WebhookTrigger } from "../../webhooks/types.js";

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
  credential?: string;    // DEPRECATED: generic credential instance name. Use provider-specific fields instead.
  allowUnsigned?: boolean; // allow unsigned webhooks (default: false, shows warning if true)
  // Provider-specific credential instance names (any key matching a credential type is accepted)
  [credentialType: string]: string | boolean | undefined;
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
 * Per-agent `[runtime]` table from `agents/<name>/config.toml`.
 * Controls how the agent process is launched.
 */
export interface AgentRuntimeType {
  type?: "container" | "host-user";  // default: "container"
  run_as?: string;                   // OS user for host-user mode (default: "al-agent")
  groups?: string[];                 // Additional OS groups for host-user mode (e.g. ["docker"])
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
  runtime?: AgentRuntimeType;
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
  runtime?: AgentRuntimeType;
}
