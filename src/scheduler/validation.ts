/**
 * Config loading, agent discovery, and validation.
 *
 * Pure validation — no mutable state.
 */

import { discoverAgents, loadAgentConfig, validateAgentConfig } from "../shared/config.js";
import type { GlobalConfig, AgentConfig, WebhookSourceConfig } from "../shared/config.js";
import { requireCredentialRef } from "../shared/credentials.js";
import { ConfigError } from "../shared/errors.js";
import type { Logger } from "../shared/logger.js";
import { DEFAULT_MAX_RERUNS, DEFAULT_MAX_TRIGGER_DEPTH } from "./execution.js";
import { resolveWebhookSource } from "./webhook-setup.js";

export interface ValidatedConfig {
  agentConfigs: AgentConfig[];
  activeAgentConfigs: AgentConfig[];
  maxReruns: number;
  maxTriggerDepth: number;
  timezone: string;
  anyWebhooks: boolean;
  webhookSources: Record<string, WebhookSourceConfig>;
}

export async function validateAndDiscover(
  projectPath: string,
  globalConfig: GlobalConfig,
  logger: Logger,
): Promise<ValidatedConfig> {
  // Discover all agents in the project
  const agentNames = discoverAgents(projectPath);
  if (agentNames.length === 0) {
    throw new ConfigError("No agents found. Run 'al new' to create a project with agents.");
  }

  const agentConfigs: AgentConfig[] = agentNames.map((name) => loadAgentConfig(projectPath, name));

  // Validate each agent has schedule, webhooks, or both
  for (const config of agentConfigs) {
    validateAgentConfig(config);
  }

  const activeAgentConfigs = agentConfigs.filter((a) => (a.scale ?? 1) > 0);

  // Validate credentials exist for each active agent
  const allCredentials = new Set(activeAgentConfigs.flatMap((a) => a.credentials));
  for (const credRef of allCredentials) {
    await requireCredentialRef(credRef);
  }

  const maxReruns = globalConfig.maxReruns ?? DEFAULT_MAX_RERUNS;
  const maxTriggerDepth = globalConfig.maxCallDepth ?? globalConfig.maxTriggerDepth ?? DEFAULT_MAX_TRIGGER_DEPTH;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const anyWebhooks = activeAgentConfigs.some((a) => a.webhooks?.length);

  // Validate pi_auth is not used with Docker (containers can't access host auth storage)
  for (const config of activeAgentConfigs) {
    for (const mc of config.models) {
      if (mc.authType === "pi_auth") {
        throw new ConfigError(
          `Agent "${config.name}" uses pi_auth (model "${mc.model}") which is not supported in container mode. ` +
          `Switch to api_key/oauth_token (run 'al doctor').`
        );
      }
    }
  }

  // Resolve webhook sources from global config
  const webhookSources = globalConfig.webhooks ?? {};

  // Validate all agent webhook sources reference valid global config entries
  if (anyWebhooks) {
    for (const config of activeAgentConfigs) {
      for (const trigger of config.webhooks ?? []) {
        resolveWebhookSource(trigger.source, config.name, webhookSources);
      }
    }
  }

  return {
    agentConfigs,
    activeAgentConfigs,
    maxReruns,
    maxTriggerDepth,
    timezone,
    anyWebhooks,
    webhookSources,
  };
}
