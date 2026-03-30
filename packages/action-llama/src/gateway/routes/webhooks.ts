import type { Hono } from "hono";
import { registerWebhookRoutes } from "../../events/routes/webhooks.js";
import type { WebhookRegistry } from "../../webhooks/registry.js";
import type { WebhookSourceConfig } from "../../shared/config.js";
import type { Logger } from "../../shared/logger.js";
import type { StatusTracker } from "../../tui/status-tracker.js";
import type { StatsStore } from "../../stats/store.js";

/**
 * Register gateway webhook routes, delegating to the events-plane webhook handler.
 * Named `registerGatewayWebhookRoutes` to avoid ambiguity with the plane-level
 * `registerWebhookRoutes` from `events/routes/webhooks.ts` that it wraps.
 */
export function registerGatewayWebhookRoutes(
  app: Hono,
  opts: {
    webhookRegistry: WebhookRegistry;
    webhookSecrets: Record<string, Record<string, string>>;
    webhookConfigs: Record<string, WebhookSourceConfig>;
    logger: Logger;
    statusTracker?: StatusTracker;
    statsStore?: StatsStore;
  },
): void {
  const { webhookRegistry, webhookSecrets, webhookConfigs, logger, statusTracker, statsStore } = opts;
  registerWebhookRoutes(app, webhookRegistry, webhookSecrets, webhookConfigs, logger, statusTracker, statsStore);
}
