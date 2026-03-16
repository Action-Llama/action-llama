import { Cron } from "croner";
import { loadGlobalConfig, loadAgentConfig, discoverAgents, validateAgentConfig } from "../shared/config.js";
import type { GlobalConfig, AgentConfig } from "../shared/config.js";
import { requireCredentialRef } from "../shared/credentials.js";
import { createLogger, createFileOnlyLogger } from "../shared/logger.js";
import type { StatusTracker } from "../tui/status-tracker.js";
import {
  buildScheduledPrompt, buildWebhookPrompt, buildCalledPrompt,
  buildScheduledSuffix, buildWebhookSuffix, buildCalledSuffix,
  type PromptSkills,
} from "../agents/prompt.js";
import type { GatewayServer } from "../gateway/index.js";
import { CONSTANTS } from "../shared/constants.js";
import { ConfigError, AgentError } from "../shared/errors.js";
import type { WebhookContext } from "../webhooks/types.js";
import { WorkQueue, type QueuedWorkItem } from "./event-queue.js";
import { RunnerPool, type PoolRunner } from "./runner-pool.js";
import { createContainerRuntime, buildAgentImages } from "./runtime-factory.js";
import { resolveWebhookSource, buildFilterFromTrigger, setupWebhookRegistry } from "./webhook-setup.js";
import { initTelemetry } from "../telemetry/index.js";
import { ensureGatewayApiKey } from "../gateway/api-key.js";
import type { StateStore } from "../shared/state-store.js";

const DEFAULT_MAX_RERUNS = 10;
const DEFAULT_MAX_TRIGGER_DEPTH = 3;

type WorkItem =
  | { type: 'webhook'; context: WebhookContext }
  | { type: 'agent-trigger'; sourceAgent: string; context: string; depth: number };

interface SchedulerContext {
  runnerPools: Record<string, RunnerPool>;
  agentConfigs: AgentConfig[];
  maxReruns: number;
  maxTriggerDepth: number;
  logger: ReturnType<typeof createLogger>;
  workQueue: WorkQueue<WorkItem>;
  shuttingDown: boolean;
  skills?: PromptSkills;
  useBakedImages: boolean;
}

// Prompt helpers: when images have baked-in static files, only pass the dynamic suffix.
// Otherwise, pass the full prompt (for non-Docker or legacy images).
function makeScheduledPrompt(agentConfig: AgentConfig, ctx: SchedulerContext): string {
  return ctx.useBakedImages ? buildScheduledSuffix() : buildScheduledPrompt(agentConfig, ctx.skills);
}

function makeWebhookPrompt(agentConfig: AgentConfig, context: WebhookContext, ctx: SchedulerContext): string {
  return ctx.useBakedImages ? buildWebhookSuffix(context) : buildWebhookPrompt(agentConfig, context, ctx.skills);
}

function makeTriggeredPrompt(agentConfig: AgentConfig, sourceAgent: string, context: string, ctx: SchedulerContext): string {
  return ctx.useBakedImages ? buildCalledSuffix(sourceAgent, context) : buildCalledPrompt(agentConfig, sourceAgent, context, ctx.skills);
}

/** Run a single agent and dispatch any resulting triggers. */
async function executeRun(
  runner: PoolRunner, prompt: string,
  triggerInfo: { type: 'schedule' | 'webhook' | 'agent'; source?: string },
  agentName: string, depth: number, ctx: SchedulerContext
): Promise<{ result: string; triggers: Array<{ agent: string; context: string }> }> {
  const outcome = await runner.run(prompt, triggerInfo);
  const triggers = outcome.triggers ?? [];
  if (triggers.length > 0) dispatchTriggers(triggers, agentName, depth, ctx);
  return { result: outcome.result, triggers };
}

function dispatchTriggers(
  triggers: Array<{ agent: string; context: string }>,
  sourceAgent: string, depth: number, ctx: SchedulerContext
): void {
  for (const { agent, context } of triggers) {
    if (agent === sourceAgent) {
      ctx.logger.warn({ source: sourceAgent }, "agent cannot trigger itself, skipping");
      continue;
    }
    if (depth >= ctx.maxTriggerDepth) {
      ctx.logger.warn({ source: sourceAgent, target: agent, depth }, "trigger depth limit reached, skipping");
      continue;
    }
    const targetConfig = ctx.agentConfigs.find((a) => a.name === agent);
    if (!targetConfig) {
      ctx.logger.warn({ source: sourceAgent, target: agent }, "trigger target not found, skipping");
      continue;
    }
    const pool = ctx.runnerPools[agent];
    if (pool.size === 0) {
      ctx.logger.info({ source: sourceAgent, target: agent }, "target disabled (scale=0), skipping");
      continue;
    }
    const runner = pool.getAvailableRunner();
    if (!runner) {
      ctx.workQueue.enqueue(agent, { type: 'agent-trigger', sourceAgent, context, depth });
      ctx.logger.info({ source: sourceAgent, target: agent }, "all runners busy, trigger queued");
      continue;
    }
    ctx.logger.info({ source: sourceAgent, target: agent, depth }, "agent trigger firing");
    const prompt = makeTriggeredPrompt(targetConfig, sourceAgent, context, ctx);
    executeRun(runner, prompt, { type: 'agent', source: sourceAgent }, agent, depth + 1, ctx)
      .then(() => drainQueues(ctx))
      .catch((err) => ctx.logger.error({ err, target: agent }, "triggered run failed"));
  }
}

/** Drain all agents' work queues, processing items in parallel batches. */
async function drainQueues(ctx: SchedulerContext): Promise<void> {
  while (!ctx.shuttingDown) {
    const batch: Array<{ item: QueuedWorkItem<WorkItem>; runner: PoolRunner; agentConfig: AgentConfig }> = [];
    for (const agentConfig of ctx.agentConfigs) {
      const pool = ctx.runnerPools[agentConfig.name];
      if (!pool || ctx.workQueue.size(agentConfig.name) === 0) continue;
      for (const runner of pool.getAllAvailableRunners()) {
        const item = ctx.workQueue.dequeue(agentConfig.name);
        if (!item) break;
        batch.push({ item, runner, agentConfig });
      }
    }
    if (batch.length === 0) break;

    await Promise.all(batch.map(({ item, runner, agentConfig }) => {
      const work = item.context;
      const ageMs = Date.now() - item.receivedAt.getTime();

      if (work.type === 'webhook') {
        ctx.logger.info({ agent: agentConfig.name, event: work.context.event, ageMs }, "draining queued webhook");
        const prompt = makeWebhookPrompt(agentConfig, work.context, ctx);
        return executeRun(runner, prompt, { type: 'webhook', source: work.context.event }, agentConfig.name, 0, ctx)
          .catch((err) => ctx.logger.error({ err, agent: agentConfig.name }, "queued webhook failed"));
      } else {
        if (work.depth >= ctx.maxTriggerDepth) return Promise.resolve();
        ctx.logger.info({ source: work.sourceAgent, target: agentConfig.name, depth: work.depth, ageMs }, "draining queued trigger");
        const prompt = makeTriggeredPrompt(agentConfig, work.sourceAgent, work.context, ctx);
        return executeRun(runner, prompt, { type: 'agent', source: work.sourceAgent }, agentConfig.name, work.depth + 1, ctx)
          .catch((err) => ctx.logger.error({ err, agent: agentConfig.name }, "queued trigger failed"));
      }
    }));
  }
}

async function runWithReruns(
  runner: PoolRunner, agentConfig: AgentConfig, depth: number, ctx: SchedulerContext
): Promise<void> {
  let { result } = await executeRun(
    runner, makeScheduledPrompt(agentConfig, ctx), { type: 'schedule' }, agentConfig.name, depth, ctx
  );

  let reruns = 0;
  while (result === "rerun" && reruns < ctx.maxReruns) {
    reruns++;
    ctx.logger.info({ rerun: reruns, maxReruns: ctx.maxReruns }, `${agentConfig.name} requested rerun`);
    ({ result } = await executeRun(
      runner, makeScheduledPrompt(agentConfig, ctx),
      { type: 'schedule', source: `rerun ${reruns}/${ctx.maxReruns}` }, agentConfig.name, depth, ctx
    ));
  }

  if (result === "rerun" && reruns >= ctx.maxReruns) {
    ctx.logger.warn({ maxReruns: ctx.maxReruns }, `${agentConfig.name} hit max reruns limit`);
  }

  await drainQueues(ctx);
}

export async function startScheduler(projectPath: string, globalConfigOverride?: GlobalConfig, statusTracker?: StatusTracker, cloudMode?: boolean, gatewayEnabled?: boolean, webUI?: boolean, expose?: boolean) {
  const mkLogger = statusTracker ? createFileOnlyLogger : createLogger;
  const logger = mkLogger(projectPath, "scheduler");
  logger.info("Starting scheduler...");

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

  // Discover all agents in the project
  const agentNames = discoverAgents(projectPath);
  if (agentNames.length === 0) {
    throw new ConfigError("No agents found. Run 'al new' to create a project with agents.");
  }

  const agentConfigs: AgentConfig[] = agentNames.map((name) => loadAgentConfig(projectPath, name));

  // Validate each agent has schedule, webhooks, or both
  for (const config of agentConfigs) {
    validateAgentConfig(config);
  }

  const activeAgentConfigs = agentConfigs.filter((a) => (a.scale ?? 1) > 0);

  // Validate credentials exist for each active agent
  const allCredentials = new Set(activeAgentConfigs.flatMap((a) => a.credentials));
  for (const credRef of allCredentials) {
    await requireCredentialRef(credRef);
  }

  // Validate IAM roles exist if using cloud mode
  if (cloudMode && globalConfig.cloud) {
    logger.info("Validating cloud IAM roles...");
    const { createCloudProvider } = await import("../cloud/provider.js");
    try {
      const provider = await createCloudProvider(globalConfig.cloud);
      await provider.validateRoles(projectPath);
      logger.info("All cloud IAM roles validated successfully");
    } catch (err: any) {
      logger.error("Cloud IAM role validation failed");
      throw new Error(
        `❌ Cloud IAM role validation failed\n\n` +
        `${err.message}\n\n` +
        `This validation prevents runtime failures when agents try to start.\n` +
        `Fix the IAM roles before starting the scheduler.`
      );
    }
  }

  const maxReruns = globalConfig.maxReruns ?? DEFAULT_MAX_RERUNS;
  const maxTriggerDepth = globalConfig.maxCallDepth ?? globalConfig.maxTriggerDepth ?? DEFAULT_MAX_TRIGGER_DEPTH;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dockerEnabled = true;
  const anyWebhooks = activeAgentConfigs.some((a) => a.webhooks?.length);

  // Validate pi_auth is not used with Docker (containers can't access host auth storage)
  for (const config of activeAgentConfigs) {
    if (config.model.authType === "pi_auth") {
      throw new ConfigError(
        `Agent "${config.name}" uses pi_auth which is not supported in container mode. ` +
        `Switch to api_key/oauth_token (run 'al doctor').`
      );
    }
  }

  // Resolve webhook sources from global config
  const webhookSources = globalConfig.webhooks ?? {};

  // Validate all agent webhook sources reference valid global config entries
  if (anyWebhooks) {
    for (const config of activeAgentConfigs) {
      for (const trigger of config.webhooks ?? []) {
        resolveWebhookSource(trigger.source, config.name, webhookSources);
      }
    }
  }

  // Set up webhook registry if any agents use webhooks
  const { registry: webhookRegistry, secrets: webhookSecrets } = anyWebhooks
    ? await setupWebhookRegistry(globalConfig, logger)
    : { registry: undefined, secrets: {} };

  let baseImage = CONSTANTS.DEFAULT_IMAGE;
  const agentImages: Record<string, string> = {};
  const useCloudRuntime = cloudMode && globalConfig.cloud;

  // Register agents early so the TUI shows them during image builds
  for (const agentConfig of agentConfigs) {
    statusTracker?.registerAgent(agentConfig.name, agentConfig.scale ?? 1);
  }

  // Validate: webhooks require the gateway
  if (anyWebhooks && !gatewayEnabled) {
    logger.warn("Agents have webhook triggers but --gateway (-g) was not passed — webhooks will not be received. Use -g to enable.");
  }

  // Declare runner pools and cron jobs early so control route closures can reference them.
  // They are populated after image builds complete.
  const runnerPools: Record<string, RunnerPool> = {};
  let cronJobs: Cron[] = [];

  // Create persistent state store (SQLite locally, DynamoDB in cloud).
  let stateStore: StateStore | undefined;
  if (gatewayEnabled) {
    const { createStateStore } = await import("../shared/state-store.js");
    const useCloudStore = cloudMode && globalConfig.cloud;
    if (useCloudStore && globalConfig.cloud?.provider === "ecs") {
      stateStore = await createStateStore({
        type: "dynamodb",
        region: globalConfig.cloud.awsRegion!,
        tableName: "al-state",
      });
      logger.info("State store: DynamoDB (al-state)");
    } else {
      const { resolve: resolvePath } = await import("path");
      stateStore = await createStateStore({
        type: "sqlite",
        path: resolvePath(projectPath, ".al", "state.db"),
      });
      logger.info("State store: SQLite (.al/state.db)");
    }
  }

  // Start gateway early if needed (before Docker builds) so users can see build status
  let gateway: GatewayServer | undefined;

  if (gatewayEnabled) {
    // Ensure gateway API key exists (fallback generation if doctor wasn't run)
    const { key: gatewayApiKey, generated } = await ensureGatewayApiKey();
    if (generated) {
      logger.info("Generated gateway API key (run 'al doctor' to view it)");
    }

    const { startGateway } = await import("../gateway/index.js");
    const gatewayPort = globalConfig.gateway?.port || 8080;
    gateway = await startGateway({
      port: gatewayPort,
      hostname: (cloudMode || expose) ? "0.0.0.0" : "127.0.0.1",
      logger: mkLogger(projectPath, "gateway"),
      killContainer: undefined, // Runtime not ready yet, will handle container ops later
      webhookRegistry,
      webhookSecrets,
      statusTracker,
      projectPath,
      webUI: cloudMode ? false : webUI,
      lockTimeout: globalConfig.gateway?.lockTimeout,
      apiKey: gatewayApiKey,
      stateStore,
      // Control routes, dashboard, and lock status are local-only.
      // In cloud mode, use cloud-native tools (console, CLI) for these operations.
      controlDeps: cloudMode ? undefined : {
        statusTracker,
        killInstance: async (instanceId: string) => {
          for (const pool of Object.values(runnerPools)) {
            if (pool.killInstance(instanceId)) return true;
          }
          return false;
        },
        killAgent: async (name: string) => {
          const pool = runnerPools[name];
          if (!pool) return null;
          const killed = pool.killAll();
          logger.info({ agent: name, killed }, "kill all instances requested via control API");
          return { killed };
        },
        pauseScheduler: async () => {
          for (const job of cronJobs) {
            job.pause();
          }
          statusTracker?.setPaused(true);
          logger.info("Scheduler paused via control API");
        },
        resumeScheduler: async () => {
          for (const job of cronJobs) {
            job.resume();
          }
          statusTracker?.setPaused(false);
          logger.info("Scheduler resumed via control API");
        },
        triggerAgent: async (name: string) => {
          const pool = runnerPools[name];
          if (!pool) return false;
          const runner = pool.getAvailableRunner();
          if (!runner) return false;
          const config = agentConfigs.find((a) => a.name === name);
          if (!config) return false;
          logger.info({ agent: name }, "manual trigger via control API");
          runWithReruns(runner, config, 0, schedulerCtx).catch((err) => {
            logger.error({ err, agent: name }, "manual trigger run failed");
          });
          return true;
        },
        enableAgent: async (name: string) => {
          if (!statusTracker) return false;
          const config = agentConfigs.find((a) => a.name === name);
          if (!config) return false;
          statusTracker.enableAgent(name);
          return true;
        },
        disableAgent: async (name: string) => {
          if (!statusTracker) return false;
          const config = agentConfigs.find((a) => a.name === name);
          if (!config) return false;
          statusTracker.disableAgent(name);
          return true;
        },
        stopScheduler: async () => {
          logger.info("Stop requested via control API");
          schedulerCtx.shuttingDown = true;
          schedulerCtx.workQueue.clearAll();
          for (const job of cronJobs) job.stop();
          if (gateway) await gateway.close();
          if (stateStore) await stateStore.close();
          if (telemetry) {
            try { await telemetry.shutdown(); } catch {}
          }
          process.exit(0);
        },
      },
    });
    logger.info({ port: gatewayPort }, "Gateway started early to show build progress");
  }

  // 1. Create the container runtime
  const { runtime, agentRuntimeOverrides, runtimeType } = await createContainerRuntime(
    globalConfig, activeAgentConfigs, cloudMode, logger,
  );
  logger.info({ runtime: runtimeType }, "Container mode enabled — initializing infrastructure");

  // Check for orphan containers from a previous scheduler run
  try {
    const orphans = await runtime.listRunningAgents();
    if (orphans.length > 0) {
      for (const orphan of orphans) {
        logger.warn({ agent: orphan.agentName, task: orphan.taskId }, "found orphan container");
      }
      if (runtimeType === "local") {
        for (const orphan of orphans) {
          try { await runtime.kill(orphan.taskId); await runtime.remove(orphan.taskId); } catch {}
        }
        logger.info({ count: orphans.length }, "cleaned up local orphan containers");
      }
    }
  } catch (err) {
    logger.debug({ err }, "orphan detection skipped (runtime does not support listing)");
  }

  // 2. Build base + per-agent images via shared image builder
  const buildSkills: PromptSkills = { locking: true };
  const buildResult = await buildAgentImages({
    projectPath, globalConfig, activeAgentConfigs,
    runtime, runtimeType, statusTracker, logger, skills: buildSkills,
  });
  baseImage = buildResult.baseImage;
  Object.assign(agentImages, buildResult.agentImages);

  // Import necessary classes for container runners
  const { ContainerAgentRunner: ContainerAgentRunnerClass } = await import("../agents/container-runner.js");
  const gatewayPort = globalConfig.gateway?.port || 8080;
  const gatewayUrl = gatewayEnabled
    ? (process.env.GATEWAY_URL
      || (useCloudRuntime
        ? (globalConfig.gateway?.url || "")
        : `http://host.docker.internal:${gatewayPort}`))
    : "";

  if (gatewayEnabled && useCloudRuntime && !gatewayUrl) {
    logger.warn("Cloud mode is active but gateway URL is not set (via GATEWAY_URL env or gateway.url config) — resource locking and shutdown will not work for cloud containers");
  }

  // Gateway callbacks — no-ops if gateway isn't running (remote runtimes).
  // Both are async (ContainerRegistry persists to StateStore).
  const registerContainer = gateway
    ? gateway.registerContainer
    : async (_secret: string, _reg: any) => {};
  const unregisterContainer = gateway
    ? gateway.unregisterContainer
    : async (_secret: string) => {};

  for (const agentConfig of agentConfigs) {
    const scale = agentConfig.scale ?? 1;
    const runners: PoolRunner[] = [];



    for (let i = 0; i < scale; i++) {
      const instanceId = scale >= 2 ? `${agentConfig.name}(${i + 1})` : agentConfig.name;
      const agentRuntime = agentRuntimeOverrides[agentConfig.name] || runtime;
      runners.push(new ContainerAgentRunnerClass(
        agentRuntime,
        globalConfig,
        agentConfig,
        mkLogger(projectPath, instanceId),
        registerContainer,
        unregisterContainer,
        gatewayUrl,
        projectPath,
        agentImages[agentConfig.name] || baseImage,
        statusTracker,
        instanceId
      ));
    }

    runnerPools[agentConfig.name] = new RunnerPool(runners);
    logger.info({ agent: agentConfig.name, scale }, "Created runner pool");
  }

  const queueSize = globalConfig.workQueueSize ?? globalConfig.webhookQueueSize ?? 20;
  const workQueue = new WorkQueue<WorkItem>(queueSize, stateStore);
  await workQueue.init();
  const skills: PromptSkills = { locking: true };
  const schedulerCtx: SchedulerContext = { runnerPools, agentConfigs, maxReruns, maxTriggerDepth, logger, workQueue, shuttingDown: false, skills, useBakedImages: true };

  // Set up webhook bindings (only when gateway is enabled)
  if (webhookRegistry && gatewayEnabled) {
    for (const agentConfig of activeAgentConfigs) {
      if (!agentConfig.webhooks?.length) continue;

      const pool = runnerPools[agentConfig.name];

      for (const trigger of agentConfig.webhooks) {
        const sourceConfig = webhookSources[trigger.source];
        const providerType = sourceConfig.type;
        const filter = buildFilterFromTrigger(trigger, providerType);
        webhookRegistry.addBinding({
          agentName: agentConfig.name,
          source: sourceConfig.credential,
          type: providerType,
          filter,
          trigger: (context: WebhookContext) => {
            if (statusTracker && !statusTracker.isAgentEnabled(agentConfig.name)) return;

            const runner = pool.getAvailableRunner();
            if (!runner) {
              const { dropped } = schedulerCtx.workQueue.enqueue(agentConfig.name, { type: 'webhook', context });
              logger.info({ agent: agentConfig.name, event: context.event, queueSize: schedulerCtx.workQueue.size(agentConfig.name) }, "webhook queued");
              if (dropped) logger.warn({ agent: agentConfig.name }, "queue full, oldest event dropped");
              return;
            }

            logger.info({ agent: agentConfig.name, event: context.event, action: context.action }, "webhook triggering agent");
            const prompt = makeWebhookPrompt(agentConfig, context, schedulerCtx);
            executeRun(runner, prompt, { type: 'webhook', source: context.event }, agentConfig.name, 0, schedulerCtx)
              .then(() => drainQueues(schedulerCtx))
              .catch((err) => logger.error({ err, agent: agentConfig.name }, "webhook run failed"));
          },
        });
      }
    }
  }

  // Set up cron jobs (only for agents with a schedule)
  cronJobs = [];

  for (const agentConfig of activeAgentConfigs) {
    if (!agentConfig.schedule) continue;

    const pool = runnerPools[agentConfig.name];

    const job = new Cron(agentConfig.schedule, { timezone }, async () => {
      // Skip if agent is disabled
      if (statusTracker && !statusTracker.isAgentEnabled(agentConfig.name)) {
        logger.info({ agent: agentConfig.name }, "agent is disabled, skipping scheduled run");
        return;
      }

      const availableRunner = pool.getAvailableRunner();
      if (!availableRunner) {
        logger.warn({ agent: agentConfig.name, running: pool.runningJobCount, scale: pool.size }, "all agent runners busy, skipping scheduled run");
        return;
      }
      logger.info({ agent: agentConfig.name, running: pool.runningJobCount, scale: pool.size }, "triggering scheduled run");
      await runWithReruns(availableRunner, agentConfig, 0, schedulerCtx);
    });

    cronJobs.push(job);
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

  for (const url of webhookUrls) {
    logger.info({ url }, "Webhook endpoint registered");
  }
  logger.info(`Scheduler running with ${cronJobs.length} scheduled jobs`);

  // Handle agent enable/disable events
  if (statusTracker) {
    // Create a map of agent name to cron job for easy lookup
    const agentCronJobs = new Map<string, Cron>();
    for (let i = 0; i < agentConfigs.length; i++) {
      const config = agentConfigs[i];
      if (config.schedule && cronJobs[i]) {
        agentCronJobs.set(config.name, cronJobs[i]);
      }
    }

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

  // Fire initial run for scheduled agents
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

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down scheduler...");
    schedulerCtx.shuttingDown = true;
    schedulerCtx.workQueue.clearAll();
    for (const job of cronJobs) {
      job.stop();
    }
    if (gateway) {
      await gateway.close();
      logger.info("Gateway server stopped");
    }
    if (stateStore) {
      await stateStore.close();
    }

    // Shutdown telemetry
    if (telemetry) {
      try {
        await telemetry.shutdown();
        logger.info("Telemetry shutdown completed");
      } catch (error: any) {
        logger.warn({ error: error.message }, "Error during telemetry shutdown");
      }
    }
    
    logger.info("All cron jobs stopped");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return { cronJobs, runnerPools, gateway, webhookRegistry, webhookUrls, statusTracker };
}
