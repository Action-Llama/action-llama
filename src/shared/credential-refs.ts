import { discoverAgents, loadAgentConfig, type GlobalConfig } from "./config.js";

/** Webhook secret credential types — these support multiple named instances */
export const WEBHOOK_SECRET_TYPES: Record<string, string> = {
  github: "github_webhook_secret",
  sentry: "sentry_client_secret",
};

/**
 * Collect all credential refs needed by agents in the project,
 * including webhook secret credentials derived from global webhook sources.
 */
export function collectCredentialRefs(projectPath: string, globalConfig: GlobalConfig): Set<string> {
  const credentialRefs = new Set<string>();
  const agents = discoverAgents(projectPath);
  const webhookSources = globalConfig.webhooks ?? {};

  for (const name of agents) {
    const config = loadAgentConfig(projectPath, name);
    for (const ref of config.credentials) {
      credentialRefs.add(ref);
    }
    for (const trigger of config.webhooks || []) {
      const sourceConfig = webhookSources[trigger.source];
      if (!sourceConfig) continue;
      const credType = WEBHOOK_SECRET_TYPES[sourceConfig.type];
      if (credType && sourceConfig.credential) {
        credentialRefs.add(`${credType}:${sourceConfig.credential}`);
      }
    }
  }

  return credentialRefs;
}
