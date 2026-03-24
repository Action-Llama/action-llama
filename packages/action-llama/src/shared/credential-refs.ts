import { discoverAgents, loadAgentConfig, type GlobalConfig } from "./config.js";

/** Webhook secret credential types — these support multiple named instances */
export const WEBHOOK_SECRET_TYPES: Record<string, string> = {
  github: "github_webhook_secret",
  sentry: "sentry_client_secret",
  linear: "linear_webhook_secret",
  mintlify: "mintlify_webhook_secret",
};

/** Credentials that are always required but may not be explicitly referenced */
export const IMPLICIT_CREDENTIAL_REFS = new Set([
  "gateway_api_key",  // Required for gateway authentication
]);

/**
 * Convert credential refs to relative file paths within the credentials directory.
 * Example: "github_token:default" -> "github_token/default"
 */
export function credentialRefsToRelativePaths(refs: Set<string>): string[] {
  const paths: string[] = [];
  for (const ref of refs) {
    const [type, instance] = ref.split(":");
    paths.push(`${type}/${instance || "default"}`);
  }
  return paths;
}

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
    // Add provider credentials for all models in the chain
    for (const mc of config.models ?? []) {
      if (mc.authType !== "pi_auth") {
        credentialRefs.add(`${mc.provider}_key`);
      }
    }
    for (const trigger of config.webhooks || []) {
      const sourceConfig = webhookSources[trigger.source];
      if (!sourceConfig) continue;
      const credType = WEBHOOK_SECRET_TYPES[sourceConfig.type];
      if (credType) {
        credentialRefs.add(`${credType}:${sourceConfig.credential ?? "default"}`);
      }
    }
  }

  return credentialRefs;
}
