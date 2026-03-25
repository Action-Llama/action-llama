import { loadGlobalConfig } from "../shared/config.js";
import type { GlobalConfig } from "../shared/config.js";
import { createLogger, createFileOnlyLogger } from "../shared/logger.js";
import type { StatusTracker } from "../tui/status-tracker.js";
import type { PromptSkills } from "../agents/prompt.js";
import { CONSTANTS } from "../shared/constants.js";
import { createWorkQueue } from "../events/event-queue.js";
import { createContainerRuntime, buildAgentImages } from "../execution/runtime-factory.js";
import { setupWebhookRegistry, registerWebhookBindings } from "../events/webhook-setup.js";
import { initTelemetry } from "../telemetry/index.js";
import type { StateStore } from "../shared/state-store.js";
import type { StatsStore } from "../stats/index.js";
import type { WorkItem, SchedulerContext } from "../execution/execution.js";
import { drainQueues, makeWebhookPrompt, executeRun, runWithReruns } from "../execution/execution.js";
import { SchedulerEventBus } from "./events.js";
import type { SchedulerState } from "./state.js";
import { validateAndDiscover } from "./validation.js";
import { setupGateway } from "./gateway-setup.js";
import { createRunnerPools } from "../execution/runner-setup.js";
import { wireCallDispatcher } from "../execution/call-dispatcher.js";
import { setupCronJobs, setupEnableDisableHandlers } from "../events/cron-setup.js";
import { registerShutdownHandlers } from "./shutdown.js";
import { loadBuiltinExtensions } from "../extensions/loader.js";

export type { SchedulerContext, WorkItem } from "../execution/execution.js";
export { SchedulerEventBus } from "./events.js";

export async function startScheduler(projectPath: string, globalConfigOverride?: GlobalConfig, statusTracker?: StatusTracker, webUI?: boolean, expose?: boolean) {
  const mkLogger = statusTracker ? createFileOnlyLogger : createLogger;
  const logger = mkLogger(projectPath, "scheduler");
  logger.info("Starting scheduler...");

  const globalConfig = globalConfigOverride || loadGlobalConfig(projectPath);

  // Only load model extensions for providers actually referenced in config
  const usedProviders = globalConfig.models
    ? new Set(Object.values(globalConfig.models).map(m => m.provider))
    : undefined;

  try {
    await loadBuiltinExtensions(undefined, usedProviders);
    logger.info("Extensions loaded successfully");
  } catch (error: any) {
    logger.warn({ error: error.message }, "Failed to load extensions");
  }

  // Initialize telemetry if enabled
  let telemetry: any;
  if (globalConfig.telemetry?.enabled) {
    try {
      telemetry = initTelemetry(globalConfig.telemetry);
      await telemetry.init();
      logger.info("Telemetry initialized successfully");
    } catch (error: any) {
      logger.warn({ error: error.message }, "Failed to initialize telemetry");
    }
  }

  // Discover agents and validate config
  const validated = await validateAndDiscover(projectPath, globalConfig, logger);
  const { agentConfigs, activeAgentConfigs, maxReruns, maxTriggerDepth, timezone, anyWebhooks, webhookSources } = validated;

  // Set up webhook registry if any agents use webhooks
  const { registry: webhookRegistry, secrets: webhookSecrets } = anyWebhooks
    ? await setupWebhookRegistry(globalConfig, logger)
    : { registry: undefined, secrets: {} };

  let baseImage = CONSTANTS.DEFAULT_IMAGE;
  const agentImages: Record<string, string> = {};

  // Register agents early so the TUI shows them during image builds
  for (const agentConfig of agentConfigs) {
    statusTracker?.registerAgent(agentConfig.name, agentConfig.scale ?? 1);
  }

  // Create persistent state store (SQLite)
  let stateStore: StateStore | undefined;
  {
    const { createStateStore } = await import("../shared/state-store.js");
    const { resolve: resolvePath } = await import("path");
    stateStore = await createStateStore({
      type: "sqlite",
      path: resolvePath(projectPath, ".al", "state.db"),
    });
    logger.info("State store: SQLite (.al/state.db)");
  }

  // Create stats store (SQLite)
  let statsStore: StatsStore | undefined;
  {
    const { StatsStore: StatsStoreClass } = await import("../stats/index.js");
    const { statsDbPath } = await import("../shared/paths.js");
    statsStore = new StatsStoreClass(statsDbPath(projectPath));
    // Auto-prune old data on startup
    const retentionDays = globalConfig.historyRetentionDays ?? 14;
    const pruned = statsStore.prune(retentionDays);
    if (pruned.runs > 0 || pruned.callEdges > 0 || pruned.receipts > 0) {
      logger.info({ prunedRuns: pruned.runs, prunedCallEdges: pruned.callEdges, prunedReceipts: pruned.receipts, retentionDays }, "Pruned old stats data");
    }
    logger.info("Stats store: SQLite (.al/stats.db)");
  }

  // Create the lifecycle event bus
  const events = new SchedulerEventBus();

  // Create the shared mutable state container for late-binding closures
  const state: SchedulerState = {
    runnerPools: {},
    cronJobs: [],
    schedulerCtx: null,
  };

  // Start gateway early (before Docker builds) so users can see build status
  const { gateway, gatewayPort, registerContainer, unregisterContainer, setChatRuntime } = await setupGateway({
    projectPath, globalConfig, state, agentConfigs,
    webhookRegistry, webhookSecrets, webhookConfigs: webhookSources, stateStore, statsStore, events, telemetry,
    mkLogger, statusTracker, webUI, expose, logger,
  });

  // Create the container runtime
  const { runtime, agentRuntimeOverrides } = await createContainerRuntime(
    globalConfig, activeAgentConfigs, logger,
  );

  logger.info({ runtime: "local" }, "Container mode enabled — initializing infrastructure");

  // Check for orphan containers from a previous scheduler run
  try {
    const ownAgentNames = new Set(activeAgentConfigs.map((a) => a.name));
    const orphans = (await runtime.listRunningAgents()).filter((o) => ownAgentNames.has(o.agentName));
    if (orphans.length > 0) {
      for (const orphan of orphans) {
        logger.warn({ agent: orphan.agentName, task: orphan.taskId }, "found orphan container");
      }
      for (const orphan of orphans) {
        try { await runtime.kill(orphan.taskId); await runtime.remove(orphan.taskId); } catch {}
      }
      logger.info({ count: orphans.length }, "cleaned up local orphan containers");
    }
  } catch (err) {
    logger.debug({ err }, "orphan detection skipped (runtime does not support listing)");
  }

  // Build base + per-agent images
  const buildSkills: PromptSkills = { locking: true };
  const buildResult = await buildAgentImages({
    projectPath, globalConfig, activeAgentConfigs,
    runtime, statusTracker, logger, skills: buildSkills,
  });
  baseImage = buildResult.baseImage;
  Object.assign(agentImages, buildResult.agentImages);

  // Wire up chat container launcher now that runtime + images are available
  setChatRuntime(runtime, agentImages);

  // Create runner pools
  const { runnerPools, createRunner, actualScales } = await createRunnerPools({
    globalConfig, agentConfigs, runtime, agentRuntimeOverrides,
    agentImages, baseImage, gatewayPort, registerContainer, unregisterContainer,
    statusTracker, mkLogger, projectPath, logger,
  });

  // Sync status tracker with actual pool sizes (may differ from configured scale
  // when a project-wide scale cap throttles individual agents)
  if (statusTracker) {
    for (const [agentName, actualScale] of Object.entries(actualScales)) {
      const registeredScale = statusTracker.getAgentScale(agentName);
      if (registeredScale !== actualScale) {
        statusTracker.updateAgentScale(agentName, actualScale);
        logger.info({ agent: agentName, registeredScale, actualScale }, "synced status tracker scale with actual pool size");
      }
    }
  }

  // Populate late-binding state
  Object.assign(state.runnerPools, runnerPools);

  // Create work queue + scheduler context
  const queueSize = globalConfig.workQueueSize ?? globalConfig.webhookQueueSize ?? 20;
  const workQueue = await createWorkQueue<WorkItem>(queueSize, {
    type: "sqlite",
    path: (await import("path")).resolve(projectPath, ".al", "work-queue.db"),
  });
  const skills: PromptSkills = { locking: true };
  const callStore = gateway.callStore;
  const schedulerCtx: SchedulerContext = {
    runnerPools, agentConfigs, maxReruns, maxTriggerDepth, logger, workQueue,
    shuttingDown: false, skills, useBakedImages: true, events, callStore, statusTracker, statsStore,
    isAgentEnabled: statusTracker ? (name: string) => statusTracker.isAgentEnabled(name) : undefined,
    isPaused: statusTracker ? () => statusTracker.isPaused() : undefined,
  };

  // Populate late-binding state
  state.schedulerCtx = schedulerCtx;

  // Wire up call dispatcher
  wireCallDispatcher(gateway, schedulerCtx, statusTracker);

  // Set up webhook bindings
  if (webhookRegistry) {
    for (const agentConfig of activeAgentConfigs) {
      if (!agentConfig.webhooks?.length) continue;
      registerWebhookBindings({
        agentConfig,
        webhookRegistry,
        webhookSources,
        onTrigger: (config, context) => {
          if (statusTracker && !statusTracker.isAgentEnabled(config.name)) return false;
          if (statusTracker?.isPaused()) {
            logger.info({ agent: config.name, event: context.event }, "scheduler paused, webhook rejected");
            return false;
          }
          const pool = runnerPools[config.name];
          const runner = pool.getAvailableRunner();
          if (!runner) {
            const { dropped } = schedulerCtx.workQueue.enqueue(config.name, { type: 'webhook', context });
            logger.info({ agent: config.name, event: context.event, queueSize: schedulerCtx.workQueue.size(config.name) }, "webhook queued");
            if (dropped) logger.warn({ agent: config.name }, "queue full, oldest event dropped");
            return true;
          }
          logger.info({ agent: config.name, event: context.event, action: context.action }, "webhook triggering agent");
          const prompt = makeWebhookPrompt(config, context, schedulerCtx);
          executeRun(runner, prompt, { type: 'webhook', source: context.event, receiptId: context.receiptId }, config.name, 0, schedulerCtx)
            .then(() => drainQueues(schedulerCtx))
            .catch((err) => logger.error({ err, agent: config.name }, "webhook run failed"));
          return true;
        },
        logger,
      });
    }
  }

  // Set up cron jobs
  const { cronJobs, agentCronJobs, webhookUrls } = setupCronJobs({
    activeAgentConfigs, webhookSources,
    globalConfig, agentConfigs,
    onScheduledRun: async (agentConfig) => {
      const pool = runnerPools[agentConfig.name];
      const availableRunner = pool.getAvailableRunner();
      if (!availableRunner) {
        const { dropped } = schedulerCtx.workQueue.enqueue(agentConfig.name, { type: 'schedule' });
        logger.info({ agent: agentConfig.name, running: pool.runningJobCount, scale: pool.size }, "all runners busy, scheduled run queued");
        if (dropped) logger.warn({ agent: agentConfig.name }, "queue full, oldest event dropped");
        return;
      }
      logger.info({ agent: agentConfig.name, running: pool.runningJobCount, scale: pool.size }, "triggering scheduled run");
      await runWithReruns(availableRunner, agentConfig, 0, schedulerCtx);
    },
    statusTracker, logger, timezone, anyWebhooks,
    gatewayPort: gateway ? gatewayPort : undefined,
  });

  // Populate late-binding state
  state.cronJobs.push(...cronJobs);

  for (const url of webhookUrls) {
    logger.info({ url }, "Webhook endpoint registered");
  }
  logger.info(`Scheduler running with ${cronJobs.length} scheduled jobs`);

  // Handle agent enable/disable events
  if (statusTracker) {
    setupEnableDisableHandlers({ statusTracker, agentCronJobs, logger });
  }

  // Drain persisted queue items
  drainQueues(schedulerCtx).catch((err) => {
    logger.error({ err }, "initial queue drain failed");
  });

  // Start hot-reload watcher
  const { watchAgents } = await import("./watcher.js");
  const watcherHandle = watchAgents({
    projectPath, globalConfig, runtime, agentRuntimeOverrides,
    runnerPools, agentConfigs, agentImages, cronJobs,
    schedulerCtx, webhookRegistry, webhookSources, statusTracker,
    logger, skills, timezone, baseImage, createRunner,
  });
  logger.info("Watching agents/ for changes (hot reload enabled)");

  // Graceful shutdown
  registerShutdownHandlers({
    logger, schedulerCtx, cronJobs, gateway, stateStore, statsStore, telemetry, watcherHandle,
  });

  return { cronJobs, runnerPools, gateway, webhookRegistry, webhookUrls, statusTracker, schedulerCtx, events };
}

