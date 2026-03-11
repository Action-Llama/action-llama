import type { GlobalConfig, AgentConfig, WebhookSourceConfig } from "../shared/config.js";
import type { Logger } from "../shared/logger.js";
import { backendListInstances, backendLoadField } from "../shared/credentials.js";
import { WebhookRegistry } from "../webhooks/registry.js";
import { GitHubWebhookProvider } from "../webhooks/providers/github.js";
import { SentryWebhookProvider } from "../webhooks/providers/sentry.js";
import { LinearWebhookProvider } from "../webhooks/providers/linear.js";
import type { WebhookContext, WebhookFilter, WebhookTrigger, GitHubWebhookFilter, SentryWebhookFilter, LinearWebhookFilter } from "../webhooks/types.js";
import type { RunnerPool } from "./runner-pool.js";

// Provider type → credential type for loading secrets
const PROVIDER_TO_CREDENTIAL: Record<string, string> = {
  github: "github_webhook_secret",
  sentry: "sentry_client_secret",
  linear: "linear_webhook_secret",
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
  return undefined;
}

export async function setupWebhookRegistry(
  globalConfig: GlobalConfig,
  activeAgentConfigs: AgentConfig[],
  logger: Logger
): Promise<{registry?: WebhookRegistry, secrets: Record<string, Record<string, string>>}> {
  const anyWebhooks = activeAgentConfigs.some((a) => a.webhooks?.length);
  
  if (!anyWebhooks) {
    return { secrets: {} };
  }

  const webhookRegistry = new WebhookRegistry(logger);

  // Register providers
  webhookRegistry.registerProvider(new GitHubWebhookProvider());
  webhookRegistry.registerProvider(new SentryWebhookProvider());
  webhookRegistry.registerProvider(new LinearWebhookProvider());

  // Resolve webhook sources from global config
  const webhookSources = globalConfig.webhooks ?? {};

  // Load secrets for each provider type referenced by webhook sources
  const providerTypes = new Set(Object.values(webhookSources).map(s => s.type));
  const webhookSecrets: Record<string, Record<string, string>> = {};

  for (const providerType of providerTypes) {
    const credType = PROVIDER_TO_CREDENTIAL[providerType];
    if (!credType) continue;

    const instances = await backendListInstances(credType);
    const secrets: Record<string, string> = {};
    for (const inst of instances) {
      const secret = await backendLoadField(credType, inst, "secret");
      if (secret) secrets[inst] = secret;
    }
    if (Object.keys(secrets).length > 0) {
      webhookSecrets[providerType] = secrets;
      logger.info({ providerType, count: Object.keys(secrets).length }, "loaded webhook secrets");
    }
  }

  return { registry: webhookRegistry, secrets: webhookSecrets };
}

export interface SchedulerContext {
  runnerPools: Record<string, RunnerPool>;
  agentConfigs: AgentConfig[];
  maxReruns: number;
  maxTriggerDepth: number;
  logger: Logger;
  webhookQueue: any; // WebhookEventQueue<WebhookContext> - avoiding circular import
  shuttingDown: boolean;
  skills?: any; // PromptSkills
  useBakedImages: boolean;
  triggerDispatcher: any; // TriggerDispatcher - avoiding circular import
}

export function bindWebhooksToAgents(
  registry: WebhookRegistry,
  agentConfigs: AgentConfig[],
  runnerPools: Record<string, RunnerPool>,
  webhookSources: Record<string, WebhookSourceConfig>,
  ctx: SchedulerContext,
  makeWebhookPrompt: (agentConfig: AgentConfig, context: WebhookContext, ctx: SchedulerContext) => string,
  dispatchTriggers: (triggers: Array<{ agent: string; context: string }>, sourceAgent: string, depth: number, ctx: SchedulerContext) => void,
  drainWebhookQueue: (agentConfig: AgentConfig, ctx: SchedulerContext) => Promise<void>,
  statusTracker?: any // StatusTracker
): void {
  const activeAgentConfigs = agentConfigs.filter((a) => (a.scale ?? 1) > 0);
  
  for (const agentConfig of activeAgentConfigs) {
    if (!agentConfig.webhooks?.length) continue;

    const pool = runnerPools[agentConfig.name];

    for (const trigger of agentConfig.webhooks) {
      const sourceConfig = resolveWebhookSource(trigger.source, agentConfig.name, webhookSources);
      const providerType = sourceConfig.type;
      const filter = buildFilterFromTrigger(trigger, providerType);
      
      registry.addBinding({
        agentName: agentConfig.name,
        source: sourceConfig.credential,
        type: providerType,
        filter,
        trigger: (context: WebhookContext) => {
          // Skip if agent is disabled
          if (statusTracker && !statusTracker.isAgentEnabled(agentConfig.name)) {
            ctx.logger.info({ agent: agentConfig.name, event: context.event }, "agent is disabled, ignoring webhook event");
            return;
          }

          const availableRunner = pool.getAvailableRunner();
          if (!availableRunner) {
            const { accepted, dropped } = ctx.webhookQueue.enqueue(agentConfig.name, context);
            if (accepted) {
              ctx.logger.info(
                { agent: agentConfig.name, event: context.event, queueSize: ctx.webhookQueue.size(agentConfig.name), running: pool.runningJobCount, scale: pool.size },
                "all agent runners busy, webhook event queued"
              );
            }
            if (dropped) {
              ctx.logger.warn(
                { agent: agentConfig.name, droppedEvent: dropped.context.event },
                "webhook queue full, oldest event dropped"
              );
            }
            return;
          }
          ctx.logger.info(
            { agent: agentConfig.name, event: context.event, action: context.action, running: pool.runningJobCount, scale: pool.size },
            "webhook triggering agent"
          );
          const prompt = makeWebhookPrompt(agentConfig, context, ctx);
          availableRunner.run(prompt, { type: 'webhook', source: context.event }).then(({ triggers }) => {
            if (triggers.length > 0) {
              dispatchTriggers(triggers, agentConfig.name, 0, ctx);
            }
            // Drain any events that queued while this webhook run was executing
            return drainWebhookQueue(agentConfig, ctx);
          }).catch((err) => {
            ctx.logger.error({ err }, `${agentConfig.name} webhook run failed`);
          });
        },
      });
    }
  }
}