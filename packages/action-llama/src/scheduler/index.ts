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
    statusTracker?.registerAgent(agentConfig.name, agentConfig.scale ?? 1, agentConfig.description);
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

  // Build base + per-agent images (only for agents using container runtime)
  const containerAgentConfigs = activeAgentConfigs.filter(
    (a) => !agentRuntimeOverrides[a.name] // agents without overrides use the default container runtime
  );
  const buildSkills: PromptSkills = { locking: true };
  if (containerAgentConfigs.length > 0) {
    const buildResult = await buildAgentImages({
      projectPath, globalConfig, activeAgentConfigs: containerAgentConfigs,
      runtime, statusTracker, logger, skills: buildSkills,
    });
    baseImage = buildResult.baseImage;
    Object.assign(agentImages, buildResult.agentImages);
  }

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

  // Re-adopt orphan containers from a previous scheduler run (or clean up stale state)
  try {
    const ownAgentNames = new Set(activeAgentConfigs.map((a) => a.name));
    const orphans = (await runtime.listRunningAgents()).filter((o) => ownAgentNames.has(o.agentName));

    if (orphans.length > 0) {
      const registeredContainers = gateway.containerRegistry.listAll();
      const runningNames = new Set(orphans.map((o) => o.taskId));
      let adopted = 0;
      let killed = 0;

      for (const orphan of orphans) {
        const found = gateway.containerRegistry.findByContainerName(orphan.taskId);

        if (!found) {
          // Container exists but has no registry entry — unknown, kill it
          logger.warn({ agent: orphan.agentName, task: orphan.taskId }, "killing unregistered orphan container");
          try { await runtime.kill(orphan.taskId); await runtime.remove(orphan.taskId); } catch {}
          killed++;
          continue;
        }

        const { secret: oldSecret, reg } = found;
        const pool = runnerPools[orphan.agentName];
        if (!pool) {
          logger.warn({ agent: orphan.agentName, task: orphan.taskId }, "no runner pool for orphan, killing");
          try { await runtime.kill(orphan.taskId); await runtime.remove(orphan.taskId); } catch {}
          gateway.lockStore.releaseAll(reg.instanceId);
          await gateway.containerRegistry.unregister(oldSecret);
          killed++;
          continue;
        }

        // Get shutdown secret from container env vars
        let shutdownSecret: string | undefined;
        if (runtime.inspectContainer) {
          const info = await runtime.inspectContainer(orphan.taskId);
          shutdownSecret = info?.env?.SHUTDOWN_SECRET;
        }

        if (!shutdownSecret) {
          logger.warn({ agent: orphan.agentName, task: orphan.taskId }, "cannot read SHUTDOWN_SECRET from orphan, killing");
          try { await runtime.kill(orphan.taskId); await runtime.remove(orphan.taskId); } catch {}
          gateway.lockStore.releaseAll(reg.instanceId);
          await gateway.containerRegistry.unregister(oldSecret);
          killed++;
          continue;
        }

        const runner = pool.getAvailableRunner();
        if (!runner) {
          logger.warn({ agent: orphan.agentName, task: orphan.taskId }, "no available runner for orphan, killing");
          try { await runtime.kill(orphan.taskId); await runtime.remove(orphan.taskId); } catch {}
          gateway.lockStore.releaseAll(reg.instanceId);
          await gateway.containerRegistry.unregister(oldSecret);
          killed++;
          continue;
        }

        // Unregister old secret mapping — will be re-registered inside adoptContainer
        await gateway.containerRegistry.unregister(oldSecret);

        logger.info({ agent: orphan.agentName, task: orphan.taskId, instance: reg.instanceId }, "re-adopting orphan container");

        const containerRunner = runner as any;
        if (typeof containerRunner.adoptContainer === "function") {
          containerRunner
            .adoptContainer(orphan.taskId, shutdownSecret, reg.instanceId, { type: "schedule" as const, source: "re-adopted" })
            .then(() => { if (state.schedulerCtx) drainQueues(state.schedulerCtx); })
            .catch((err: any) => logger.error({ err, agent: orphan.agentName }, "orphan re-adoption failed"));
          adopted++;
        } else {
          logger.warn({ agent: orphan.agentName }, "runner does not support adoption, killing orphan");
          try { await runtime.kill(orphan.taskId); await runtime.remove(orphan.taskId); } catch {}
          killed++;
        }
      }

      // Clean up registry entries for containers that exited while scheduler was down
      for (const reg of registeredContainers) {
        if (!runningNames.has(reg.containerName)) {
          const found = gateway.containerRegistry.findByContainerName(reg.containerName);
          if (found) {
            gateway.lockStore.releaseAll(reg.instanceId);
            await gateway.containerRegistry.unregister(found.secret);
            logger.info({ agent: reg.agentName, instance: reg.instanceId }, "cleaned up stale registration (container exited while scheduler was down)");
          }
        }
      }

      logger.info({ adopted, killed, total: orphans.length }, "orphan container handling complete");
    } else {
      // No running containers — clean up all stale registry entries
      const staleEntries = gateway.containerRegistry.listAll();
      if (staleEntries.length > 0) {
        let releasedLocks = 0;
        for (const entry of staleEntries) {
          releasedLocks += gateway.lockStore.releaseAll(entry.instanceId);
        }
        await gateway.containerRegistry.clear();
        logger.info(
          { releasedLocks, staleRegistrations: staleEntries.length },
          "cleaned up stale registrations (no running containers)",
        );
      }
    }
  } catch (err) {
    logger.debug({ err }, "orphan detection/re-adoption skipped (runtime does not support listing)");
  }

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

