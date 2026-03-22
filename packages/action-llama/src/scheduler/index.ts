import { loadGlobalConfig } from "../shared/config.js";
import type { GlobalConfig } from "../shared/config.js";
import { createLogger, createFileOnlyLogger } from "../shared/logger.js";
import type { StatusTracker } from "../tui/status-tracker.js";
import type { PromptSkills } from "../agents/prompt.js";
import { CONSTANTS } from "../shared/constants.js";
import { createWorkQueue } from "./event-queue.js";
import { createContainerRuntime, buildAgentImages } from "./runtime-factory.js";
import { setupWebhookRegistry, registerWebhookBindings } from "./webhook-setup.js";
import { initTelemetry } from "../telemetry/index.js";
import type { StateStore } from "../shared/state-store.js";
import type { StatsStore } from "../stats/index.js";
import type { WorkItem, SchedulerContext } from "./execution.js";
import { drainQueues } from "./execution.js";
import { SchedulerEventBus } from "./events.js";
import type { SchedulerState } from "./state.js";
import { validateAndDiscover } from "./validation.js";
import { setupGateway } from "./gateway-setup.js";
import { createRunnerPools } from "./runner-setup.js";
import { wireCallDispatcher } from "./call-dispatcher.js";
import { setupCronJobs, setupEnableDisableHandlers } from "./cron-setup.js";
import { registerShutdownHandlers } from "./shutdown.js";
import { loadBuiltinExtensions } from "../extensions/loader.js";

export type { SchedulerContext, WorkItem } from "./execution.js";
export { SchedulerEventBus } from "./events.js";

export async function startScheduler(projectPath: string, globalConfigOverride?: GlobalConfig, statusTracker?: StatusTracker, webUI?: boolean, expose?: boolean) {
  const mkLogger = statusTracker ? createFileOnlyLogger : createLogger;
  const logger = mkLogger(projectPath, "scheduler");
  logger.info("Starting scheduler...");

  // Load built-in extensions before everything else
  try {
    await loadBuiltinExtensions();
    logger.info("Extensions loaded successfully");
  } catch (error: any) {
    logger.warn({ error: error.message }, "Failed to load extensions");
  }

  const globalConfig = globalConfigOverride || loadGlobalConfig(projectPath);

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
    const pruned = statsStore.prune(90);
    if (pruned.runs > 0 || pruned.callEdges > 0) {
      logger.info({ prunedRuns: pruned.runs, prunedCallEdges: pruned.callEdges }, "Pruned old stats data (>90 days)");
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
  const { gateway, gatewayPort, registerContainer, unregisterContainer } = await setupGateway({
    projectPath, globalConfig, state, agentConfigs,
    webhookRegistry, webhookSecrets, webhookConfigs: webhookSources, stateStore, statsStore, events, telemetry,
    mkLogger, statusTracker, webUI, expose, logger,
  });

  // Create the container runtime
  const { runtime, agentRuntimeOverrides } = await createContainerRuntime(
    globalConfig, activeAgentConfigs, logger,
  );

  // Initialize feedback monitor if enabled
  let feedbackMonitor: any;
  if (globalConfig.feedback?.enabled) {
    const { FeedbackMonitor } = await import("../agents/feedback-monitor.js");
    feedbackMonitor = new FeedbackMonitor(globalConfig, logger, statusTracker);
    logger.info("Feedback monitoring enabled");
  }
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

  // Create runner pools
  const { runnerPools, createRunner } = await createRunnerPools({
    globalConfig, agentConfigs, runtime, agentRuntimeOverrides,
    agentImages, baseImage, gatewayPort, registerContainer, unregisterContainer,
    statusTracker, mkLogger, projectPath, logger,
  });

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
        pool: runnerPools[agentConfig.name],
        webhookRegistry,
        webhookSources,
        schedulerCtx,
        statusTracker,
        logger,
      });
    }
  }

  // Set up cron jobs
  const { cronJobs, agentCronJobs, webhookUrls } = setupCronJobs({
    activeAgentConfigs, runnerPools, schedulerCtx, webhookSources,
    globalConfig, agentConfigs, gateway, statusTracker, logger, timezone, anyWebhooks,
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

  // Set up feedback event handling
  if (feedbackMonitor) {
    await setupFeedbackHandling(feedbackMonitor, globalConfig, schedulerCtx, projectPath, logger);
    
    // Start monitoring all active agents
    for (const agentConfig of activeAgentConfigs) {
      feedbackMonitor.watchAgent(agentConfig.name);
    }
    
    feedbackMonitor.start(projectPath);
    logger.info("Feedback monitor started");
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

/**
 * Set up feedback event handling
 */
async function setupFeedbackHandling(
  feedbackMonitor: any,
  globalConfig: GlobalConfig,
  schedulerCtx: SchedulerContext,
  projectPath: string,
  logger: any,
): Promise<void> {
  // Listen for feedback trigger events
  feedbackMonitor.on("feedback-trigger", async (event: any) => {
    try {
      // Get or create feedback agent
      const feedbackAgent = await getOrCreateFeedbackAgent(globalConfig, projectPath, logger);
      
      // Create feedback runner
      const { FeedbackRunner } = await import("../agents/feedback-runner.js");
      const feedbackRunner = new FeedbackRunner(
        feedbackAgent,
        logger.child({ agent: "feedback" }),
        projectPath,
        schedulerCtx.statusTracker,
      );

      // Run feedback agent directly (not through work queue)
      setImmediate(async () => {
        try {
          logger.info({ triggerAgent: event.agentName }, "Starting feedback agent run");
          const outcome = await feedbackRunner.runWithFeedback(event, projectPath);
          logger.info({ 
            triggerAgent: event.agentName,
            result: outcome.result,
          }, "Feedback agent run completed");
        } catch (err) {
          logger.error({ err, triggerAgent: event.agentName }, "Feedback agent run failed");
        }
      });
      
    } catch (err) {
      logger.error({ err, event }, "Error setting up feedback agent run");
    }
  });
}

/**
 * Get or create the feedback agent configuration
 */
async function getOrCreateFeedbackAgent(
  globalConfig: GlobalConfig,
  projectPath: string,
  logger: any,
): Promise<any> {
  const feedbackConfig = globalConfig.feedback;
  if (!feedbackConfig) {
    throw new Error("Feedback configuration missing");
  }

  // If a custom feedback agent is specified, try to load it
  if (feedbackConfig.agent) {
    try {
      const { loadAgentConfig } = await import("../shared/config.js");
      return loadAgentConfig(projectPath, feedbackConfig.agent);
    } catch (err) {
      logger.warn({ 
        configuredAgent: feedbackConfig.agent,
        err: err,
      }, "Failed to load configured feedback agent, falling back to default");
    }
  }

  // Use default feedback agent
  const { getDefaultFeedbackAgent } = await import("../shared/default-feedback-agent.js");
  return getDefaultFeedbackAgent(globalConfig);
}
