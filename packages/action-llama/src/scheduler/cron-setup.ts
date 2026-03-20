/**
 * Cron job creation, enable/disable event handling, and initial run firing.
 */

import { Cron } from "croner";
import type { AgentConfig, WebhookSourceConfig } from "../shared/config.js";
import type { GlobalConfig } from "../shared/config.js";
import type { GatewayServer } from "../gateway/index.js";
import type { StatusTracker } from "../tui/status-tracker.js";
import type { Logger } from "../shared/logger.js";
import { RunnerPool } from "./runner-pool.js";
import type { SchedulerContext } from "./execution.js";
import { runWithReruns } from "./execution.js";

export interface CronSetupResult {
  cronJobs: Cron[];
  agentCronJobs: Map<string, Cron>;
  webhookUrls: string[];
}

export function setupCronJobs(opts: {
  activeAgentConfigs: AgentConfig[];
  runnerPools: Record<string, RunnerPool>;
  schedulerCtx: SchedulerContext;
  webhookSources: Record<string, WebhookSourceConfig>;
  globalConfig: GlobalConfig;
  agentConfigs: AgentConfig[];
  gateway?: GatewayServer;
  statusTracker?: StatusTracker;
  logger: Logger;
  timezone: string;
  anyWebhooks: boolean;
}): CronSetupResult {
  const {
    activeAgentConfigs, runnerPools, schedulerCtx, webhookSources,
    globalConfig, agentConfigs, gateway, statusTracker, logger, timezone, anyWebhooks,
  } = opts;

  const cronJobs: Cron[] = [];
  const agentCronJobs = new Map<string, Cron>();

  for (const agentConfig of activeAgentConfigs) {
    if (!agentConfig.schedule) continue;

    const pool = runnerPools[agentConfig.name];

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

      const availableRunner = pool.getAvailableRunner();
      if (!availableRunner) {
        const { dropped } = schedulerCtx.workQueue.enqueue(agentConfig.name, { type: 'schedule' });
        logger.info({ agent: agentConfig.name, running: pool.runningJobCount, scale: pool.size }, "all runners busy, scheduled run queued");
        if (dropped) logger.warn({ agent: agentConfig.name }, "queue full, oldest event dropped");
        return;
      }
      logger.info({ agent: agentConfig.name, running: pool.runningJobCount, scale: pool.size }, "triggering scheduled run");
      await runWithReruns(availableRunner, agentConfig, 0, schedulerCtx);
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
  if (anyWebhooks && gateway) {
    const gatewayPort = globalConfig.gateway?.port || 8080;
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

export function fireInitialRuns(opts: {
  agentConfigs: AgentConfig[];
  runnerPools: Record<string, RunnerPool>;
  schedulerCtx: SchedulerContext;
  logger: Logger;
}): void {
  const { agentConfigs, runnerPools, schedulerCtx, logger } = opts;

  for (const agentConfig of agentConfigs) {
    if (!agentConfig.schedule) continue;

    const pool = runnerPools[agentConfig.name];
    const availableRunner = pool.getAvailableRunner();
    if (availableRunner) {
      logger.info(`Initial run for ${agentConfig.name}`);
      runWithReruns(availableRunner, agentConfig, 0, schedulerCtx).catch((err) => {
        logger.error({ err }, `Initial ${agentConfig.name} run failed`);
      });
    } else {
      logger.warn(`${agentConfig.name}: all runners busy, skipping initial run`);
    }
  }
}
