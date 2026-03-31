import { loadGlobalConfig } from "../shared/config.js";
import type { GlobalConfig } from "../shared/config.js";
import { createLogger, createFileOnlyLogger } from "../shared/logger.js";
import type { StatusTracker } from "../tui/status-tracker.js";
import { buildTriggerLabels } from "../tui/status-tracker.js";
import type { PromptSkills } from "../agents/prompt.js";
import { CONSTANTS } from "../shared/constants.js";
import { createContainerRuntime, buildAgentImages } from "../execution/runtime-factory.js";
import { setupWebhookRegistry, registerWebhookBindings } from "../events/webhook-setup.js";
import type { WorkItem, SchedulerContext } from "../execution/execution.js";
import { drainQueues, makeWebhookPrompt, executeRun, runWithReruns } from "../execution/execution.js";
import { dispatchOrQueue } from "../execution/dispatch-policy.js";
import { SchedulerEventBus } from "./events.js";
import type { SchedulerState } from "./state.js";
import { validateAndDiscover } from "./validation.js";
import { setupGateway } from "./gateway-setup.js";
import { createRunnerPools } from "../execution/runner-setup.js";
import { wireCallDispatcher } from "../execution/call-dispatcher.js";
import { setupCronJobs, setupEnableDisableHandlers } from "../events/cron-setup.js";
import { registerShutdownHandlers } from "./shutdown.js";
import { loadDependencies } from "./dependencies.js";
import { createPersistence } from "./persistence.js";
import { recoverOrphanContainers } from "./orphan-recovery.js";
import { syncTrackerScales } from "./policies/index.js";

export type { SchedulerContext, WorkItem } from "../execution/execution.js";
export { SchedulerEventBus } from "./events.js";

export async function startScheduler(projectPath: string, globalConfigOverride?: GlobalConfig, statusTracker?: StatusTracker, webUI?: boolean, expose?: boolean) {
  const mkLogger = statusTracker ? createFileOnlyLogger : createLogger;
  const logger = mkLogger(projectPath, "scheduler");
  logger.info("Starting scheduler...");

  const globalConfig = globalConfigOverride || loadGlobalConfig(projectPath);

  // === Phase 1: Load dependencies (extensions + telemetry) ===
  const { telemetry } = await loadDependencies(globalConfig, logger);

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
    statusTracker?.setAgentTriggers(agentConfig.name, buildTriggerLabels(agentConfig));
  }

  // === Phase 2: Create persistence layer (database, stores, work queue) ===
  const { sharedDb, stateStore, statsStore, workQueue } = await createPersistence(projectPath, globalConfig, logger);

  // Create the lifecycle event bus
  const events = new SchedulerEventBus();

  // Create the shared mutable state container for late-binding closures
  const state: SchedulerState = {
    runnerPools: {},
    cronJobs: [],
    schedulerCtx: null,
    workQueue: null,
  };
  state.workQueue = workQueue;

  // === Phase 3: Create ingress (gateway + webhook bindings) ===

  // Start gateway early (before Docker builds) so users can see build status
  const { gateway, gatewayPort, registerContainer, unregisterContainer, setChatRuntime } = await setupGateway({
    projectPath, globalConfig, state, agentConfigs,
    webhookRegistry, webhookSecrets, webhookConfigs: webhookSources, stateStore, statsStore, events, telemetry,
    mkLogger, statusTracker, webUI, expose, logger,
  });

  // Register webhook bindings early (before Docker builds) so incoming webhooks are queued
  if (webhookRegistry) {
    for (const agentConfig of activeAgentConfigs) {
      if (!agentConfig.webhooks?.length) continue;
      registerWebhookBindings({
        agentConfig,
        webhookRegistry,
        webhookSources,
        onTrigger: (config, context) => {
          // Early exit: if scheduler context is not ready, queue directly
          if (!state.schedulerCtx) {
            const { dropped } = workQueue.enqueue(config.name, { type: 'webhook', context });
            statusTracker?.setQueuedWebhooks(config.name, workQueue.size(config.name));
            logger.info({ agent: config.name, event: context.event, queueSize: workQueue.size(config.name) }, "webhook queued (agents building)");
            if (dropped) logger.warn({ agent: config.name }, "queue full, oldest event dropped");
            return true;
          }

          const result = dispatchOrQueue(config.name, { type: 'webhook', context } as WorkItem, {
            pool: state.runnerPools[config.name],
            workQueue,
            isPaused: () => !!statusTracker?.isPaused(),
            isAgentEnabled: statusTracker ? (n) => statusTracker.isAgentEnabled(n) : undefined,
          });

          if (result.action === "dispatched") {
            logger.info({ agent: config.name, event: context.event, action: context.action }, "webhook triggering agent");
            const prompt = makeWebhookPrompt(config, context, state.schedulerCtx);
            executeRun(result.runner, prompt, { type: 'webhook', source: context.source, receiptId: context.receiptId }, config.name, 0, state.schedulerCtx)
              .then(() => drainQueues(state.schedulerCtx!))
              .catch((err) => logger.error({ err, agent: config.name }, "webhook run failed"));
            return true;
          }
          if (result.action === "queued") {
            statusTracker?.setQueuedWebhooks(config.name, workQueue.size(config.name));
            logger.info({ agent: config.name, event: context.event, queueSize: workQueue.size(config.name) }, "webhook queued");
            if (result.dropped) logger.warn({ agent: config.name }, "queue full, oldest event dropped");
            return true;
          }
          // rejected (paused or agent disabled)
          logger.info({ agent: config.name, event: context.event, reason: result.reason }, "webhook rejected");
          return false;
        },
        logger,
      });
    }
  }

  // === Phase 4: Create execution runtime (container runtime + images + runner pools) ===

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
  syncTrackerScales(actualScales, statusTracker, logger);

  // Populate late-binding state
  Object.assign(state.runnerPools, runnerPools);

  // === Phase 5: Recover previous state (orphan containers) ===
  await recoverOrphanContainers({
    runtime, gateway, runnerPools, activeAgentConfigs,
    schedulerState: state, logger,
  });

  // Create scheduler context (work queue was already created early above)
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

  // === Phase 6: Wire triggers (cron + webhook + call dispatcher) ===

  // Wire up call dispatcher
  wireCallDispatcher(gateway, schedulerCtx, statusTracker);

  // Set up cron jobs
  const { cronJobs, agentCronJobs, webhookUrls } = setupCronJobs({
    activeAgentConfigs, webhookSources,
    globalConfig, agentConfigs,
    onScheduledRun: async (agentConfig) => {
      const result = dispatchOrQueue(agentConfig.name, { type: 'schedule' } as WorkItem, {
        pool: runnerPools[agentConfig.name],
        workQueue: schedulerCtx.workQueue,
        isPaused: schedulerCtx.isPaused,
        isAgentEnabled: schedulerCtx.isAgentEnabled,
      });

      if (result.action === "dispatched") {
        const pool = runnerPools[agentConfig.name];
        logger.info({ agent: agentConfig.name, running: pool.runningJobCount, scale: pool.size }, "triggering scheduled run");
        await runWithReruns(result.runner, agentConfig, 0, schedulerCtx);
      } else if (result.action === "queued") {
        const pool = runnerPools[agentConfig.name];
        schedulerCtx.statusTracker?.setQueuedWebhooks(agentConfig.name, schedulerCtx.workQueue.size(agentConfig.name));
        logger.info({ agent: agentConfig.name, running: pool?.runningJobCount, scale: pool?.size }, "all runners busy, work queued");
        if (result.dropped) logger.warn({ agent: agentConfig.name }, "queue full, oldest event dropped");
      }
      // rejected case: paused or disabled — cron-setup already handles paused check before calling onScheduledRun
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

  // === Phase 7: Start background services (queue drain + watcher + shutdown) ===

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
    logger, schedulerCtx, cronJobs, gateway, stateStore, statsStore, sharedDb, telemetry, watcherHandle, runtime,
  });

  return { cronJobs, runnerPools, gateway, webhookRegistry, webhookUrls, statusTracker, schedulerCtx, events };
}
