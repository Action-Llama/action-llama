import { loadGlobalConfig } from "../shared/config.js";
import type { GlobalConfig } from "../shared/config.js";
import { createLogger, createFileOnlyLogger } from "../shared/logger.js";
import type { StatusTracker } from "../tui/status-tracker.js";
import { buildTriggerLabels } from "../tui/status-tracker.js";
import { CONSTANTS } from "../shared/constants.js";
import { createContainerRuntime } from "../execution/runtime-factory.js";
import { setupWebhookRegistry, registerWebhookBindings } from "../events/webhook-setup.js";
import type { WorkItem, SchedulerContext } from "../execution/execution.js";
import { drainQueues, makeWebhookPrompt, executeRun, runWithReruns } from "../execution/execution.js";
import { dispatchOrQueue } from "../execution/dispatch-policy.js";
import { SchedulerEventBus } from "./events.js";
import type { SchedulerState } from "./state.js";
import { validateAndDiscover } from "./validation.js";
import { setupGateway } from "./gateway-setup.js";
import { createRunnerPools } from "../execution/runner-setup.js";
import { setupCronJobs, setupEnableDisableHandlers } from "../events/cron-setup.js";
import { registerShutdownHandlers } from "./shutdown.js";
import { loadDependencies } from "./dependencies.js";
import { createPersistence } from "./persistence.js";
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

  const baseImage = globalConfig.local?.image ?? CONSTANTS.DEFAULT_IMAGE;

  // Register agents early so the TUI shows them during startup
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

  // Apply per-agent work queue size overrides
  for (const agentConfig of agentConfigs) {
    if (agentConfig.maxWorkQueueSize !== undefined) {
      workQueue.setAgentMaxSize(agentConfig.name, agentConfig.maxWorkQueueSize);
      logger.info({ agent: agentConfig.name, maxWorkQueueSize: agentConfig.maxWorkQueueSize }, "per-agent work queue size configured");
    }
  }

  // === Phase 3: Create ingress (gateway + webhook bindings) ===

  const { gateway, gatewayPort } = await setupGateway({
    projectPath, globalConfig, state, agentConfigs,
    webhookRegistry, webhookSecrets, webhookConfigs: webhookSources, stateStore, statsStore, events, telemetry,
    statusTracker, webUI, expose, logger,
  });

  // Register webhook bindings early so incoming webhooks are queued
  if (webhookRegistry) {
    for (const agentConfig of activeAgentConfigs) {
      if (!agentConfig.webhooks?.length) continue;
      registerWebhookBindings({
        agentConfig,
        webhookRegistry,
        webhookSources,
        onTrigger: (config, context) => {
          if (!state.schedulerCtx) {
            const { dropped } = workQueue.enqueue(config.name, { type: 'webhook', context });
            statusTracker?.setQueuedWebhooks(config.name, workQueue.size(config.name));
            logger.info({ agent: config.name, event: context.event, queueSize: workQueue.size(config.name) }, "webhook queued (starting up)");
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
          logger.info({ agent: config.name, event: context.event, reason: result.reason }, "webhook rejected");
          return false;
        },
        logger,
      });
    }
  }

  // === Phase 4: Ensure Docker is available and create runner pools ===

  // Verify Docker is running (TransportAgentRunner provisions containers directly)
  const { execFileSync } = await import("child_process");
  try {
    execFileSync("docker", ["info"], { stdio: "pipe", timeout: 10000 });
  } catch {
    logger.error("Docker is not running. Start Docker Desktop (or the Docker daemon) and try again.");
    process.exit(1);
  }

  // Create scheduler tools dependencies (lock/call stores from the gateway)
  const lockStore = gateway.lockStore;
  const callStore = gateway.callStore;

  const schedulerToolsDeps = {
    lockStore,
    callStore,
    dispatchCall: (entry: any) => {
      // Validate and dispatch the call through the scheduler
      if (entry.callerAgent === entry.targetAgent) {
        return { ok: false, reason: "agent cannot call itself" };
      }
      if (entry.depth >= maxTriggerDepth) {
        return { ok: false, reason: "trigger depth limit reached" };
      }
      const targetConfig = agentConfigs.find((a) => a.name === entry.targetAgent);
      if (!targetConfig) {
        return { ok: false, reason: `target agent "${entry.targetAgent}" not found` };
      }
      const pool = state.runnerPools[entry.targetAgent];
      if (!pool || pool.size === 0) {
        return { ok: false, reason: `target agent "${entry.targetAgent}" is disabled` };
      }

      const result = dispatchOrQueue(entry.targetAgent, {
        type: 'agent-trigger',
        sourceAgent: entry.callerAgent,
        context: entry.context,
        depth: entry.depth,
        callId: entry.callId,
      }, {
        pool,
        workQueue,
        isAgentEnabled: statusTracker ? (n: string) => statusTracker.isAgentEnabled(n) : undefined,
      });

      if (result.action === "dispatched") {
        logger.info({ caller: entry.callerAgent, target: entry.targetAgent, depth: entry.depth }, "dispatching call");
        callStore.setRunning(entry.callId);
        const { makeTriggeredPrompt } = require("../execution/execution.js");
        const prompt = makeTriggeredPrompt(targetConfig, entry.callerAgent, entry.context, state.schedulerCtx);
        executeRun(result.runner, prompt, { type: 'agent', source: entry.callerAgent }, entry.targetAgent, entry.depth + 1, state.schedulerCtx!)
          .then(({ result: runResult, returnValue }) => {
            if (runResult === "completed" || runResult === "rerun") {
              callStore.complete(entry.callId, returnValue);
            } else {
              callStore.fail(entry.callId, "agent run failed");
            }
            return drainQueues(state.schedulerCtx!);
          })
          .catch((err) => {
            callStore.fail(entry.callId, err?.message || "unknown error");
            logger.error({ err, target: entry.targetAgent }, "called agent run failed");
          });
        return { ok: true };
      }
      if (result.action === "queued") {
        logger.info({ caller: entry.callerAgent, target: entry.targetAgent }, "all runners busy, call queued");
        drainQueues(state.schedulerCtx!).catch((err) => {
          logger.error({ err }, "drain after call queue failed");
        });
        return { ok: true };
      }
      return { ok: false, reason: result.reason };
    },
    statusTracker,
    logger,
  };

  // Create runner pools with transport-backed runners
  const { runnerPools, createRunner, actualScales } = await createRunnerPools({
    globalConfig, agentConfigs,
    baseImage, statusTracker, mkLogger, projectPath, logger,
    schedulerToolsDeps,
  });

  // Sync status tracker with actual pool sizes
  syncTrackerScales(actualScales, statusTracker, logger);

  // Populate late-binding state
  Object.assign(state.runnerPools, runnerPools);

  // Create scheduler context
  const schedulerCtx: SchedulerContext = {
    runnerPools, agentConfigs, maxReruns, maxTriggerDepth, logger, workQueue,
    shuttingDown: false, skills: { locking: true }, events, callStore, statusTracker, statsStore,
    isAgentEnabled: statusTracker ? (name: string) => statusTracker.isAgentEnabled(name) : undefined,
    isPaused: statusTracker ? () => statusTracker.isPaused() : undefined,
  };

  // Populate late-binding state
  state.schedulerCtx = schedulerCtx;

  // === Phase 5: Wire triggers (cron + webhook) ===

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
    setupEnableDisableHandlers({ statusTracker, agentCronJobs, workQueue, logger });
  }

  // === Phase 6: Start background services (queue drain + watcher + shutdown) ===

  // Drain persisted queue items
  drainQueues(schedulerCtx).catch((err) => {
    logger.error({ err }, "initial queue drain failed");
  });

  // Start hot-reload watcher
  const { watchAgents } = await import("./watcher.js");
  const watcherHandle = watchAgents({
    projectPath, globalConfig,
    runnerPools, agentConfigs,
    cronJobs, schedulerCtx,
    webhookRegistry, webhookSources, statusTracker,
    logger, timezone, baseImage, createRunner,
  });
  logger.info("Watching agents/ for changes (hot reload enabled)");

  // Graceful shutdown
  registerShutdownHandlers({
    logger, schedulerCtx, cronJobs, gateway, stateStore, statsStore, sharedDb, telemetry, watcherHandle,
  });

  return { cronJobs, runnerPools, gateway, webhookRegistry, webhookUrls, statusTracker, schedulerCtx, events };
}
