/**
 * Cron job creation, enable/disable event handling, and initial run firing.
 */

import { Cron } from "croner";
import type { AgentConfig, WebhookSourceConfig } from "../shared/config.js";
import type { GlobalConfig } from "../shared/config.js";
import type { StatusTracker } from "../tui/status-tracker.js";
import type { Logger } from "../shared/logger.js";

/**
 * Callback invoked when a cron schedule fires for an agent.
 * The implementation lives in scheduler/ and handles runner dispatch internally.
 */
export type ScheduledRunCallback = (agentConfig: AgentConfig) => Promise<void>;

export interface CronSetupResult {
  cronJobs: Cron[];
  agentCronJobs: Map<string, Cron>;
  webhookUrls: string[];
}

export function setupCronJobs(opts: {
  activeAgentConfigs: AgentConfig[];
  webhookSources: Record<string, WebhookSourceConfig>;
  globalConfig: GlobalConfig;
  agentConfigs: AgentConfig[];
  onScheduledRun: ScheduledRunCallback;
  statusTracker?: StatusTracker;
  logger: Logger;
  timezone: string;
  anyWebhooks: boolean;
  gatewayPort?: number;
}): CronSetupResult {
  const {
    activeAgentConfigs, webhookSources,
    globalConfig, agentConfigs, onScheduledRun, statusTracker, logger, timezone, anyWebhooks,
  } = opts;

  const cronJobs: Cron[] = [];
  const agentCronJobs = new Map<string, Cron>();

  for (const agentConfig of activeAgentConfigs) {
    if (!agentConfig.schedule) continue;

    const job = new Cron(agentConfig.schedule, { timezone }, async () => {
      // Skip if scheduler is paused
      if (statusTracker?.isPaused()) {
        logger.info({ agent: agentConfig.name }, "scheduler paused, skipping scheduled run");
        return;
      }
      // Skip if agent is disabled
      if (statusTracker && !statusTracker.isAgentEnabled(agentConfig.name)) {
        logger.info({ agent: agentConfig.name }, "agent is disabled, skipping scheduled run");
        return;
      }

      await onScheduledRun(agentConfig);
    });

    cronJobs.push(job);
    agentCronJobs.set(agentConfig.name, job);
    const nextRun = job.nextRun();
    if (nextRun) {
      statusTracker?.setNextRunAt(agentConfig.name, nextRun);
    }
    logger.info(`Scheduled ${agentConfig.name}: "${agentConfig.schedule}" (${timezone})`);
  }

  const webhookUrls: string[] = [];
  if (anyWebhooks && opts.gatewayPort) {
    const gatewayPort = opts.gatewayPort;
    const providerTypes = new Set(
      agentConfigs.flatMap((a) =>
        a.webhooks?.map((t) => webhookSources[t.source]?.type).filter(Boolean) || []
      )
    );
    for (const pt of providerTypes) {
      webhookUrls.push(`http://localhost:${gatewayPort}/webhooks/${pt}`);
    }
  }

  return { cronJobs, agentCronJobs, webhookUrls };
}

export function setupEnableDisableHandlers(opts: {
  statusTracker: StatusTracker;
  agentCronJobs: Map<string, Cron>;
  logger: Logger;
}): void {
  const { statusTracker, agentCronJobs, logger } = opts;

  statusTracker.on("agent-enabled", (agentName: string) => {
    const job = agentCronJobs.get(agentName);
    if (job) {
      job.resume();
      const nextRun = job.nextRun();
      if (nextRun) {
        statusTracker.setNextRunAt(agentName, nextRun);
      }
      logger.info({ agent: agentName }, "agent enabled, cron job resumed");
    }
  });

  statusTracker.on("agent-disabled", (agentName: string) => {
    const job = agentCronJobs.get(agentName);
    if (job) {
      job.pause();
      statusTracker.setNextRunAt(agentName, null);
      logger.info({ agent: agentName }, "agent disabled, cron job paused");
    }
  });
}
