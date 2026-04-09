/**
 * Hot reload watcher for `al start`.
 *
 * Watches the `agents/` directory for changes and automatically reloads
 * agent configs and updates runners/cron/webhooks.
 */

import { watch, type FSWatcher } from "fs";
import { resolve } from "path";
import { Cron } from "croner";
import { loadAgentConfig, discoverAgents, validateAgentConfig } from "../shared/config.js";
import type { GlobalConfig, AgentConfig } from "../shared/config.js";
import type { StatusTracker } from "../tui/status-tracker.js";
import { buildTriggerLabels } from "../tui/status-tracker.js";
import type { Logger } from "../shared/logger.js";
import type { WebhookRegistry } from "../webhooks/registry.js";
import type { WebhookSourceConfig } from "../shared/config.js";
import { RunnerPool, type PoolRunner } from "../execution/runner-pool.js";
import { registerWebhookBindings } from "../events/webhook-setup.js";
import type { SchedulerContext } from "../execution/execution.js";
import { runWithReruns, makeWebhookPrompt, executeRun, drainQueues } from "../execution/execution.js";

function buildWebhookTrigger(pool: RunnerPool, ctx: HotReloadContext) {
  return (config: AgentConfig, context: import("../webhooks/types.js").WebhookContext) => {
    if (ctx.statusTracker && !ctx.statusTracker.isAgentEnabled(config.name)) return false;
    if (ctx.statusTracker?.isPaused()) {
      ctx.logger.info({ agent: config.name, event: context.event }, "scheduler paused, webhook rejected");
      return false;
    }
    const runner = pool.getAvailableRunner();
    if (!runner) {
      const { dropped } = ctx.schedulerCtx.workQueue.enqueue(config.name, { type: 'webhook', context });
      ctx.logger.info({ agent: config.name, event: context.event, queueSize: ctx.schedulerCtx.workQueue.size(config.name) }, "webhook queued");
      if (dropped) ctx.logger.warn({ agent: config.name }, "queue full, oldest event dropped");
      return true;
    }
    ctx.logger.info({ agent: config.name, event: context.event, action: context.action }, "webhook triggering agent");
    const prompt = makeWebhookPrompt(config, context, ctx.schedulerCtx);
    executeRun(runner, prompt, { type: 'webhook', source: context.source, receiptId: context.receiptId }, config.name, 0, ctx.schedulerCtx)
      .then(() => drainQueues(ctx.schedulerCtx))
      .catch((err) => ctx.logger.error({ err, agent: config.name }, "webhook run failed"));
    return true;
  };
}

/** Debounce delay in ms. Overridable for testing. */
export const DEBOUNCE_MS = 500;

export interface HotReloadContext {
  projectPath: string;
  globalConfig: GlobalConfig;
  runnerPools: Record<string, RunnerPool>;
  agentConfigs: AgentConfig[];
  cronJobs: Cron[];
  schedulerCtx: SchedulerContext;
  webhookRegistry?: WebhookRegistry;
  webhookSources: Record<string, WebhookSourceConfig>;
  statusTracker?: StatusTracker;
  logger: Logger;
  timezone: string;
  baseImage: string;
  createRunner: (agentConfig: AgentConfig) => PoolRunner;
}

/**
 * Extract the agent name from a filesystem event path.
 * The path is relative to the watched `agents/` directory, e.g. "my-agent/SKILL.md".
 */
export function agentNameFromPath(filePath: string): string | null {
  if (!filePath) return null;
  const parts = filePath.split(/[/\\]/);
  const name = parts[0];
  if (!name || name.startsWith(".")) return null;
  return name;
}

export interface WatcherHandle {
  stop: () => void;
  /** Resolves when all in-flight handlers complete (for testing) */
  _waitForPending: () => Promise<void>;
  /** Trigger handler directly, bypassing debounce (for testing) */
  _handleAgentChange: (agentName: string) => Promise<void>;
}

/**
 * Watch the agents/ directory and hot-reload on changes.
 * Returns a handle with a stop() method.
 */
export function watchAgents(ctx: HotReloadContext): WatcherHandle {
  const agentsDir = resolve(ctx.projectPath, "agents");
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const rebuilding = new Set<string>();
  const pendingRebuild = new Set<string>();
  const inflightHandlers: Promise<void>[] = [];

  let watcher: FSWatcher;
  try {
    watcher = watch(agentsDir, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const agentName = agentNameFromPath(filename);
      if (!agentName) return;

      // Debounce per agent
      const existing = debounceTimers.get(agentName);
      if (existing) clearTimeout(existing);

      debounceTimers.set(agentName, setTimeout(() => {
        debounceTimers.delete(agentName);
        const p = handleAgentChange(agentName);
        inflightHandlers.push(p);
        p.finally(() => {
          const idx = inflightHandlers.indexOf(p);
          if (idx >= 0) inflightHandlers.splice(idx, 1);
        });
      }, 500));
    });
  } catch (err) {
    ctx.logger.warn({ err }, "Could not watch agents/ directory — hot reload disabled");
    return { stop: () => {}, _waitForPending: async () => {}, _handleAgentChange: async () => {} };
  }

  async function handleAgentChange(agentName: string) {
    if (rebuilding.has(agentName)) {
      pendingRebuild.add(agentName);
      return;
    }

    rebuilding.add(agentName);
    try {
      const currentNames = new Set(discoverAgents(ctx.projectPath));
      const knownNames = new Set(ctx.agentConfigs.map(a => a.name));

      if (!currentNames.has(agentName) && knownNames.has(agentName)) {
        await handleRemovedAgent(agentName);
      } else if (currentNames.has(agentName) && !knownNames.has(agentName)) {
        await handleNewAgent(agentName);
      } else if (currentNames.has(agentName) && knownNames.has(agentName)) {
        await handleChangedAgent(agentName);
      }
    } catch (err: any) {
      ctx.logger.error({ err, agent: agentName }, "hot reload failed");
      ctx.statusTracker?.setAgentError(agentName, `Hot reload error: ${String(err?.message || err).slice(0, 200)}`);
    } finally {
      rebuilding.delete(agentName);
      if (pendingRebuild.has(agentName)) {
        pendingRebuild.delete(agentName);
        handleAgentChange(agentName);
      }
    }
  }

  async function handleNewAgent(agentName: string) {
    ctx.logger.info({ agent: agentName }, "hot reload: new agent detected");

    let agentConfig: AgentConfig;
    try {
      agentConfig = loadAgentConfig(ctx.projectPath, agentName);
      validateAgentConfig(agentConfig);
    } catch (err: any) {
      ctx.logger.error({ err, agent: agentName }, "hot reload: invalid agent config");
      ctx.statusTracker?.registerAgent(agentName, 0);
      ctx.statusTracker?.setAgentError(agentName, `Invalid config: ${String(err?.message || err).slice(0, 200)}`);
      return;
    }

    const scale = agentConfig.scale ?? 1;
    ctx.statusTracker?.registerAgent(agentName, scale, agentConfig.description);
    ctx.statusTracker?.setAgentTriggers(agentName, buildTriggerLabels(agentConfig));

    if (agentConfig.maxWorkQueueSize !== undefined) {
      ctx.schedulerCtx.workQueue.setAgentMaxSize(agentName, agentConfig.maxWorkQueueSize);
    }

    if (scale === 0) {
      ctx.agentConfigs.push(agentConfig);
      ctx.logger.info({ agent: agentName }, "hot reload: agent registered (scale=0, disabled)");
      return;
    }

    // Create runners
    const runners: PoolRunner[] = [];
    for (let i = 0; i < scale; i++) {
      runners.push(ctx.createRunner(agentConfig));
    }
    const pool = new RunnerPool(runners);
    ctx.runnerPools[agentName] = pool;
    ctx.agentConfigs.push(agentConfig);
    ctx.schedulerCtx.agentConfigs = ctx.agentConfigs;

    // Set up cron
    if (agentConfig.schedule) {
      const job = new Cron(agentConfig.schedule, { timezone: ctx.timezone }, async () => {
        if (ctx.statusTracker && !ctx.statusTracker.isAgentEnabled(agentName)) return;
        const runner = pool.getAvailableRunner();
        if (!runner) {
          const { dropped } = ctx.schedulerCtx.workQueue.enqueue(agentName, { type: 'schedule' });
          ctx.logger.info({ agent: agentName }, "all runners busy, scheduled run queued");
          if (dropped) ctx.logger.warn({ agent: agentName }, "queue full, oldest event dropped");
          return;
        }
        await runWithReruns(runner, agentConfig, 0, ctx.schedulerCtx);
      });
      ctx.cronJobs.push(job);
      const nextRun = job.nextRun();
      if (nextRun) ctx.statusTracker?.setNextRunAt(agentName, nextRun);
    }

    // Set up webhooks
    if (ctx.webhookRegistry) {
      registerWebhookBindings({
        agentConfig, webhookRegistry: ctx.webhookRegistry,
        webhookSources: ctx.webhookSources,
        onTrigger: buildWebhookTrigger(pool, ctx),
        logger: ctx.logger,
      });
    }

    ctx.statusTracker?.setAgentState(agentName, "idle");
    ctx.statusTracker?.addLogLine(agentName, "hot-reloaded (new)");
    ctx.logger.info({ agent: agentName }, "hot reload: new agent ready");
  }

  async function handleRemovedAgent(agentName: string) {
    ctx.logger.info({ agent: agentName }, "hot reload: agent removed");

    const pool = ctx.runnerPools[agentName];
    if (pool) {
      pool.killAll();
      delete ctx.runnerPools[agentName];
    }

    const agentConfig = ctx.agentConfigs.find(a => a.name === agentName);
    if (agentConfig?.schedule) {
      rebuildCronJobs(agentName);
    }

    ctx.webhookRegistry?.removeBindingsForAgent(agentName);

    ctx.agentConfigs = ctx.agentConfigs.filter(a => a.name !== agentName);
    ctx.schedulerCtx.agentConfigs = ctx.agentConfigs;

    ctx.statusTracker?.unregisterAgent(agentName);
    ctx.statusTracker?.addLogLine("scheduler", `${agentName} removed (hot reload)`);
    ctx.logger.info({ agent: agentName }, "hot reload: agent teardown complete");
  }

  async function handleChangedAgent(agentName: string) {
    ctx.logger.info({ agent: agentName }, "hot reload: agent changed");

    let newConfig: AgentConfig;
    try {
      newConfig = loadAgentConfig(ctx.projectPath, agentName);
      validateAgentConfig(newConfig);
    } catch (err: any) {
      ctx.logger.error({ err, agent: agentName }, "hot reload: invalid agent config after change");
      ctx.statusTracker?.setAgentError(agentName, `Invalid config: ${String(err?.message || err).slice(0, 200)}`);
      return;
    }

    const oldConfig = ctx.agentConfigs.find(a => a.name === agentName);
    const oldScale = oldConfig?.scale ?? 1;
    const newScale = newConfig.scale ?? 1;
    const oldSchedule = oldConfig?.schedule;

    // Update config in the list
    const configIdx = ctx.agentConfigs.findIndex(a => a.name === agentName);
    if (configIdx >= 0) {
      ctx.agentConfigs[configIdx] = newConfig;
    }
    ctx.schedulerCtx.agentConfigs = ctx.agentConfigs;

    ctx.statusTracker?.setAgentDescription(agentName, newConfig.description);
    ctx.statusTracker?.setAgentTriggers(agentName, buildTriggerLabels(newConfig));

    // Handle scale 0 → N transition
    if (oldScale === 0 && newScale > 0) {
      const runners: PoolRunner[] = [];
      for (let i = 0; i < newScale; i++) {
        runners.push(ctx.createRunner(newConfig));
      }
      const pool = new RunnerPool(runners);
      ctx.runnerPools[agentName] = pool;

      ctx.statusTracker?.updateAgentScale(agentName, newScale);

      if (newConfig.schedule) {
        const job = new Cron(newConfig.schedule, { timezone: ctx.timezone }, async () => {
          if (ctx.statusTracker && !ctx.statusTracker.isAgentEnabled(agentName)) return;
          const runner = pool.getAvailableRunner();
          if (!runner) {
            const { dropped } = ctx.schedulerCtx.workQueue.enqueue(agentName, { type: 'schedule' });
            ctx.logger.info({ agent: agentName }, "all runners busy, scheduled run queued");
            if (dropped) ctx.logger.warn({ agent: agentName }, "queue full, oldest event dropped");
            return;
          }
          await runWithReruns(runner, newConfig, 0, ctx.schedulerCtx);
        });
        ctx.cronJobs.push(job);
        const nextRun = job.nextRun();
        if (nextRun) ctx.statusTracker?.setNextRunAt(agentName, nextRun);
      }

      if (ctx.webhookRegistry) {
        registerWebhookBindings({
          agentConfig: newConfig,
          webhookRegistry: ctx.webhookRegistry,
          webhookSources: ctx.webhookSources,
          onTrigger: buildWebhookTrigger(pool, ctx),
          logger: ctx.logger,
        });
      }

      ctx.statusTracker?.setAgentState(agentName, "idle");
      ctx.statusTracker?.addLogLine(agentName, "hot-reloaded (activated from scale=0)");
      ctx.logger.info({ agent: agentName, scale: newScale }, "hot reload: agent activated from scale=0");
      return;
    }

    // Handle scale N → 0 transition
    if (oldScale > 0 && newScale === 0) {
      const pool = ctx.runnerPools[agentName];
      if (pool) {
        pool.killAll();
        delete ctx.runnerPools[agentName];
      }

      rebuildCronJobs(agentName);
      ctx.statusTracker?.setNextRunAt(agentName, null);
      ctx.webhookRegistry?.removeBindingsForAgent(agentName);

      ctx.statusTracker?.updateAgentScale(agentName, 0);
      ctx.statusTracker?.setAgentState(agentName, "idle");
      ctx.statusTracker?.addLogLine(agentName, "hot-reloaded (deactivated to scale=0)");
      ctx.logger.info({ agent: agentName }, "hot reload: agent deactivated (scale=0)");
      return;
    }

    // Update existing runners with new config
    const pool = ctx.runnerPools[agentName];
    if (pool) {
      for (const runner of pool.allRunners) {
        if ('setAgentConfig' in runner && typeof (runner as any).setAgentConfig === 'function') {
          (runner as any).setAgentConfig(newConfig);
        }
      }

      // Handle scale changes
      if (newScale > oldScale) {
        for (let i = oldScale; i < newScale; i++) {
          pool.addRunner(ctx.createRunner(newConfig));
        }
        ctx.statusTracker?.updateAgentScale(agentName, newScale);
      } else if (newScale < oldScale) {
        pool.shrinkTo(newScale);
        ctx.statusTracker?.updateAgentScale(agentName, newScale);
      }
    }

    // Handle schedule changes
    if (oldSchedule !== newConfig.schedule) {
      rebuildCronJobs(agentName);

      if (newConfig.schedule && pool) {
        const job = new Cron(newConfig.schedule, { timezone: ctx.timezone }, async () => {
          if (ctx.statusTracker && !ctx.statusTracker.isAgentEnabled(agentName)) return;
          const runner = pool.getAvailableRunner();
          if (!runner) {
            const { dropped } = ctx.schedulerCtx.workQueue.enqueue(agentName, { type: 'schedule' });
            ctx.logger.info({ agent: agentName }, "all runners busy, scheduled run queued");
            if (dropped) ctx.logger.warn({ agent: agentName }, "queue full, oldest event dropped");
            return;
          }
          await runWithReruns(runner, newConfig, 0, ctx.schedulerCtx);
        });
        ctx.cronJobs.push(job);
        const nextRun = job.nextRun();
        if (nextRun) ctx.statusTracker?.setNextRunAt(agentName, nextRun);
      } else {
        ctx.statusTracker?.setNextRunAt(agentName, null);
      }
    }

    if (newConfig.maxWorkQueueSize !== undefined) {
      ctx.schedulerCtx.workQueue.setAgentMaxSize(agentName, newConfig.maxWorkQueueSize);
    }

    // Handle webhook changes
    const oldWebhooks = JSON.stringify(oldConfig?.webhooks ?? []);
    const newWebhooks = JSON.stringify(newConfig.webhooks ?? []);
    if (oldWebhooks !== newWebhooks) {
      ctx.webhookRegistry?.removeBindingsForAgent(agentName);
      if (pool && ctx.webhookRegistry) {
        registerWebhookBindings({
          agentConfig: newConfig, webhookRegistry: ctx.webhookRegistry,
          webhookSources: ctx.webhookSources,
          onTrigger: buildWebhookTrigger(pool, ctx),
          logger: ctx.logger,
        });
      }
    }

    const currentAgent = ctx.statusTracker?.getAllAgents?.().find(a => a.name === agentName);
    if (!currentAgent || currentAgent.runningCount === 0) {
      ctx.statusTracker?.setAgentState(agentName, "idle");
    }
    ctx.statusTracker?.addLogLine(agentName, "hot-reloaded");
    ctx.logger.info({ agent: agentName }, "hot reload: agent updated");
  }

  function rebuildCronJobs(removedAgentName: string) {
    for (const job of ctx.cronJobs) {
      job.stop();
    }
    ctx.cronJobs.length = 0;

    for (const agentConfig of ctx.agentConfigs) {
      if (agentConfig.name === removedAgentName) continue;
      if (!agentConfig.schedule) continue;

      const pool = ctx.runnerPools[agentConfig.name];
      if (!pool) continue;

      const job = new Cron(agentConfig.schedule, { timezone: ctx.timezone }, async () => {
        if (ctx.statusTracker && !ctx.statusTracker.isAgentEnabled(agentConfig.name)) return;
        const runner = pool.getAvailableRunner();
        if (!runner) {
          const { dropped } = ctx.schedulerCtx.workQueue.enqueue(agentConfig.name, { type: 'schedule' });
          ctx.logger.info({ agent: agentConfig.name }, "all runners busy, scheduled run queued");
          if (dropped) ctx.logger.warn({ agent: agentConfig.name }, "queue full, oldest event dropped");
          return;
        }
        await runWithReruns(runner, agentConfig, 0, ctx.schedulerCtx);
      });
      ctx.cronJobs.push(job);
      const nextRun = job.nextRun();
      if (nextRun) ctx.statusTracker?.setNextRunAt(agentConfig.name, nextRun);
    }
  }

  return {
    stop: () => {
      watcher.close();
      for (const timer of debounceTimers.values()) {
        clearTimeout(timer);
      }
      debounceTimers.clear();
    },
    _waitForPending: async () => {
      await Promise.all(inflightHandlers);
    },
    _handleAgentChange: handleAgentChange,
  };
}
