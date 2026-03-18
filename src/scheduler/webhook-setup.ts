/**
 * Webhook registry setup and helper functions.
 *
 * Extracted from scheduler/index.ts to keep webhook-specific logic separate
 * from the main scheduling orchestrator.
 */

import type { GlobalConfig, WebhookSourceConfig } from "../shared/config.js";
import type { Logger } from "../shared/logger.js";
import { listCredentialInstances, loadCredentialField } from "../shared/credentials.js";
import { WebhookRegistry } from "../webhooks/registry.js";
import { GitHubWebhookProvider } from "../webhooks/providers/github.js";
import { SentryWebhookProvider } from "../webhooks/providers/sentry.js";
import { LinearWebhookProvider } from "../webhooks/providers/linear.js";
import { MintlifyWebhookProvider } from "../webhooks/providers/mintlify.js";
import { TestWebhookProvider } from "../webhooks/providers/test.js";
import type { WebhookFilter, WebhookTrigger, GitHubWebhookFilter, SentryWebhookFilter, LinearWebhookFilter, MintlifyWebhookFilter } from "../webhooks/types.js";
import type { TestWebhookFilter } from "../webhooks/providers/test.js";

// Provider type → credential type for loading secrets
export const PROVIDER_TO_CREDENTIAL: Record<string, string> = {
  github: "github_webhook_secret",
  sentry: "sentry_client_secret",
  linear: "linear_webhook_secret",
  mintlify: "mintlify_webhook_secret",
};

export function resolveWebhookSource(
  sourceName: string,
  agentName: string,
  webhookSources: Record<string, WebhookSourceConfig>
): WebhookSourceConfig {
  const source = webhookSources[sourceName];
  if (!source) {
    const available = Object.keys(webhookSources).join(", ") || "(none)";
    throw new Error(
      `Agent "${agentName}" references webhook source "${sourceName}" ` +
      `which is not defined in config.toml [webhooks]. Available: ${available}`
    );
  }
  return source;
}

export function buildFilterFromTrigger(trigger: WebhookTrigger, providerType: string): WebhookFilter | undefined {
  if (providerType === "github") {
    const f: GitHubWebhookFilter = {};
    if (trigger.events) f.events = trigger.events;
    if (trigger.actions) f.actions = trigger.actions;
    if (trigger.repos) f.repos = trigger.repos;
    if (trigger.org) f.orgs = [trigger.org, ...(trigger.orgs ?? [])];
    else if (trigger.orgs) f.orgs = trigger.orgs;
    if (trigger.labels) f.labels = trigger.labels;
    if (trigger.assignee) f.assignee = trigger.assignee;
    if (trigger.author) f.author = trigger.author;
    if (trigger.branches) f.branches = trigger.branches;
    return Object.keys(f).length > 0 ? f : undefined;
  }
  if (providerType === "sentry") {
    const f: SentryWebhookFilter = {};
    if (trigger.resources) f.resources = trigger.resources;
    return Object.keys(f).length > 0 ? f : undefined;
  }
  if (providerType === "linear") {
    const f: LinearWebhookFilter = {};
    if (trigger.events) f.events = trigger.events;
    if (trigger.actions) f.actions = trigger.actions;
    if (trigger.organizations) f.organizations = trigger.organizations;
    if (trigger.labels) f.labels = trigger.labels;
    if (trigger.assignee) f.assignee = trigger.assignee;
    if (trigger.author) f.author = trigger.author;
    return Object.keys(f).length > 0 ? f : undefined;
  }
  if (providerType === "test") {
    const f: TestWebhookFilter = {};
    if (trigger.events) f.events = trigger.events;
    if (trigger.actions) f.actions = trigger.actions;
    if (trigger.repos) f.repos = trigger.repos;
    return Object.keys(f).length > 0 ? f : undefined;
  }
  if (providerType === "mintlify") {
    const f: MintlifyWebhookFilter = {};
    if (trigger.events) f.events = trigger.events;
    if (trigger.actions) f.actions = trigger.actions;
    if (trigger.repos) f.projects = trigger.repos; // Map repos to projects for Mintlify
    if (trigger.branches) f.branches = trigger.branches;
    return Object.keys(f).length > 0 ? f : undefined;
  }
  return undefined;
}

// Valid trigger fields per provider type (filter fields + source)
const VALID_TRIGGER_FIELDS: Record<string, Set<string>> = {
  github: new Set(["source", "events", "actions", "repos", "orgs", "org", "labels", "assignee", "author", "branches"]),
  sentry: new Set(["source", "resources"]),
  linear: new Set(["source", "events", "actions", "organizations", "labels", "assignee", "author"]),
  test: new Set(["source", "events", "actions", "repos"]),
  mintlify: new Set(["source", "events", "actions", "repos", "branches"]),
};

// Suggest similar valid fields for common typos
const FIELD_SUGGESTIONS: Record<string, string> = {
  repository: "repos",
  repo: "repos",
  event: "events",
  action: "actions",
  label: "labels",
  branch: "branches",
  organization: "organizations",
};

export function validateTriggerFields(
  trigger: WebhookTrigger,
  providerType: string,
  agentName: string,
): string[] {
  const validFields = VALID_TRIGGER_FIELDS[providerType];
  if (!validFields) {
    // Unknown provider — flag everything except "source"
    return Object.keys(trigger)
      .filter(k => k !== "source")
      .map(k => `Agent "${agentName}" webhook trigger: unrecognized field "${k}" for unknown provider type "${providerType}".`);
  }

  const errors: string[] = [];
  for (const key of Object.keys(trigger)) {
    if (!validFields.has(key)) {
      const suggestion = FIELD_SUGGESTIONS[key];
      const didYouMean = suggestion && validFields.has(suggestion)
        ? ` Did you mean "${suggestion}"?`
        : "";
      errors.push(
        `Agent "${agentName}" webhook trigger: unrecognized field "${key}" for ${providerType} provider.${didYouMean}`
      );
    }
  }
  return errors;
}

export interface WebhookSetupResult {
  registry?: WebhookRegistry;
  secrets: Record<string, Record<string, string>>;
}

export async function setupWebhookRegistry(
  globalConfig: GlobalConfig,
  logger: Logger,
): Promise<WebhookSetupResult> {
  const webhookSources = globalConfig.webhooks ?? {};
  const providerTypes = new Set(Object.values(webhookSources).map(s => s.type));

  if (providerTypes.size === 0) {
    return { secrets: {} };
  }

  const registry = new WebhookRegistry(logger);
  registry.registerProvider(new GitHubWebhookProvider());
  registry.registerProvider(new SentryWebhookProvider());
  registry.registerProvider(new LinearWebhookProvider());
  registry.registerProvider(new MintlifyWebhookProvider());
  registry.registerProvider(new TestWebhookProvider());

  // Load secrets for each provider type referenced by webhook sources
  const secrets: Record<string, Record<string, string>> = {};

  for (const providerType of providerTypes) {
    const credType = PROVIDER_TO_CREDENTIAL[providerType];
    if (!credType) continue;

    const instances = await listCredentialInstances(credType);
    const providerSecrets: Record<string, string> = {};
    for (const inst of instances) {
      const secret = await loadCredentialField(credType, inst, "secret");
      if (secret) providerSecrets[inst] = secret;
    }
    if (Object.keys(providerSecrets).length > 0) {
      secrets[providerType] = providerSecrets;
      logger.info({ providerType, count: Object.keys(providerSecrets).length }, "loaded webhook secrets");
    }
  }

  return { registry, secrets };
}
