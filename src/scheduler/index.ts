import { mkdirSync } from "fs";
import { Cron } from "croner";
import { loadGlobalConfig, loadAgentConfig, discoverAgents, validateAgentConfig } from "../shared/config.js";
import type { GlobalConfig, AgentConfig } from "../shared/config.js";
import { createLogger, createFileOnlyLogger } from "../shared/logger.js";
import { agentDir } from "../shared/paths.js";
import { AgentRunner, type RunOutcome } from "../agents/runner.js";
import type { StatusTracker } from "../tui/status-tracker.js";
import {
  buildScheduledPrompt, buildWebhookPrompt, buildTriggeredPrompt,
  buildScheduledSuffix, buildWebhookSuffix, buildTriggeredSuffix,
  type PromptSkills,
} from "../agents/prompt.js";
import type { GatewayServer } from "../gateway/index.js";
import { WebhookEventQueue } from "./event-queue.js";
import { RunnerPool, type PoolRunner } from "./runner-pool.js";
import { 
  validateAgentConfigs, 
  validateCredentials, 
  validateEcsRolesIfNeeded, 
  validateDockerCompatibility 
} from "./config-validator.js";
import { 
  setupWebhookRegistry, 
  bindWebhooksToAgents,
  resolveWebhookSource,
  type SchedulerContext
} from "./webhook-setup.js";
import { CronManager } from "./cron-manager.js";
import { createRuntime, buildAgentImages } from "./runtime-factory.js";
import { TriggerDispatcher } from "./trigger-dispatcher.js";
import { ShutdownHandler } from "./shutdown-handler.js";
import type { WebhookContext } from "../webhooks/types.js";



const DEFAULT_MAX_RERUNS = 10;
const DEFAULT_MAX_TRIGGER_DEPTH = 3;

// Prompt helpers: when images have baked-in static files, only pass the dynamic suffix.
// Otherwise, pass the full prompt (for non-Docker or legacy images).
function makeScheduledPrompt(agentConfig: AgentConfig, ctx: SchedulerContext): string {
  return ctx.useBakedImages ? buildScheduledSuffix() : buildScheduledPrompt(agentConfig, ctx.skills);
}

function makeWebhookPrompt(agentConfig: AgentConfig, context: WebhookContext, ctx: SchedulerContext): string {
  return ctx.useBakedImages ? buildWebhookSuffix(context) : buildWebhookPrompt(agentConfig, context, ctx.skills);
}

function makeTriggeredPrompt(agentConfig: AgentConfig, sourceAgent: string, context: string, ctx: SchedulerContext): string {
  return ctx.useBakedImages ? buildTriggeredSuffix(sourceAgent, context) : buildTriggeredPrompt(agentConfig, sourceAgent, context, ctx.skills);
}



async function drainWebhookQueue(
  agentConfig: AgentConfig,
  ctx: SchedulerContext
): Promise<void> {
  const pool = ctx.runnerPools[agentConfig.name];
  let event;
  while (!ctx.shuttingDown && (event = ctx.webhookQueue.dequeue(agentConfig.name)) !== undefined) {
    const runner = pool.getAvailableRunner();
    if (!runner) {
      // Put the event back in the queue if no runners are available
      ctx.webhookQueue.enqueue(agentConfig.name, event.context, event.receivedAt);
      break;
    }
    const ageMs = Date.now() - event.receivedAt.getTime();
    ctx.logger.info(
      { agent: agentConfig.name, event: event.context.event, ageMs, remaining: ctx.webhookQueue.size(agentConfig.name), running: pool.runningJobCount, scale: pool.size },
      "processing queued webhook event"
    );
    try {
      const prompt = makeWebhookPrompt(agentConfig, event.context, ctx);
      const { triggers } = await runner.run(prompt, { type: 'webhook', source: event.context.event });
      if (triggers.length > 0) {
        ctx.triggerDispatcher.dispatchTriggers(triggers, agentConfig.name, 0, ctx, makeTriggeredPrompt);
      }
    } catch (err) {
      ctx.logger.error({ err, agent: agentConfig.name }, "queued webhook run failed");
    }
  }
}

async function runWithReruns(
  runner: PoolRunner,
  agentConfig: AgentConfig,
  depth: number,
  ctx: SchedulerContext
): Promise<void> {
  const triggerDispatcher = ctx.triggerDispatcher;
  
  let { result, triggers } = await runner.run(makeScheduledPrompt(agentConfig, ctx), { type: 'schedule' });
  if (triggers.length > 0) {
    triggerDispatcher.dispatchTriggers(triggers, agentConfig.name, depth, ctx, makeTriggeredPrompt);
  }
  let reruns = 0;
  while (result === "rerun" && reruns < ctx.maxReruns) {
    reruns++;
    ctx.logger.info({ rerun: reruns, maxReruns: ctx.maxReruns }, `${agentConfig.name} requested rerun, re-running immediately`);
    ({ result, triggers } = await runner.run(makeScheduledPrompt(agentConfig, ctx), { type: 'schedule', source: `rerun ${reruns}/${ctx.maxReruns}` }));
    if (triggers.length > 0) {
      triggerDispatcher.dispatchTriggers(triggers, agentConfig.name, depth, ctx, makeTriggeredPrompt);
    }
  }
  if (result === "rerun" && reruns >= ctx.maxReruns) {
    ctx.logger.warn({ maxReruns: ctx.maxReruns }, `${agentConfig.name} hit max reruns limit`);
  }

  // Drain any webhook events that arrived during the rerun cycle
  await drainWebhookQueue(agentConfig, ctx);
}

export async function startScheduler(projectPath: string, globalConfigOverride?: GlobalConfig, statusTracker?: StatusTracker, cloudMode?: boolean, gatewayEnabled?: boolean, webUI?: boolean) {
  const mkLogger = statusTracker ? createFileOnlyLogger : createLogger;
  const logger = mkLogger(projectPath, "scheduler");
  logger.info("Starting scheduler...");

  const globalConfig = globalConfigOverride || loadGlobalConfig(projectPath);

  // Discover all agents in the project
  const agentNames = discoverAgents(projectPath);
  if (agentNames.length === 0) {
    throw new Error("No agents found. Run 'al new' to create a project with agents.");
  }

  const agentConfigs: AgentConfig[] = agentNames.map((name) => loadAgentConfig(projectPath, name));

  // Validate each agent has schedule, webhooks, or both
  for (const config of agentConfigs) {
    validateAgentConfig(config);
  }

  const activeAgentConfigs = agentConfigs.filter((a) => (a.scale ?? 1) > 0);

  // Validate credentials exist for each active agent
  await validateCredentials(activeAgentConfigs);

  // Validate ECS IAM roles exist if using cloud ECS mode
  if (cloudMode) {
    logger.info("Validating ECS IAM task roles...");
    await validateEcsRolesIfNeeded(globalConfig, projectPath);
    logger.info("All ECS IAM task roles validated successfully");
  }

  const maxReruns = globalConfig.maxReruns ?? DEFAULT_MAX_RERUNS;
  const maxTriggerDepth = globalConfig.maxTriggerDepth ?? DEFAULT_MAX_TRIGGER_DEPTH;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dockerEnabled = globalConfig.local?.enabled === true;
  const anyWebhooks = activeAgentConfigs.some((a) => a.webhooks?.length);

  // Validate pi_auth is not used with Docker (containers can't access host auth storage)
  validateDockerCompatibility(activeAgentConfigs, dockerEnabled);

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
  const { registry: webhookRegistry, secrets: webhookSecrets } = await setupWebhookRegistry(globalConfig, activeAgentConfigs, logger);

  // Register agents early so the TUI shows them during image builds
  for (const agentConfig of agentConfigs) {
    statusTracker?.registerAgent(agentConfig.name, agentConfig.scale ?? 1);
  }

  // Validate: webhooks require the gateway
  if (anyWebhooks && !gatewayEnabled) {
    logger.warn("Agents have webhook triggers but --gateway (-g) was not passed — webhooks will not be received. Use -g to enable.");
  }

  // Start gateway early if needed (before Docker builds) so users can see build status
  let gateway: GatewayServer | undefined;

  if (gatewayEnabled) {
    const { startGateway } = await import("../gateway/index.js");
    const gatewayPort = globalConfig.gateway?.port || 8080;
    gateway = await startGateway({
      port: gatewayPort,
      logger: mkLogger(projectPath, "gateway"),
      killContainer: undefined, // Runtime not ready yet, will handle container ops later
      webhookRegistry,
      webhookSecrets,
      statusTracker,
      projectPath,
      webUI,
      lockTimeout: globalConfig.gateway?.lockTimeout,
    });
    logger.info({ port: gatewayPort }, "Gateway started early to show build progress");
  }

  // Determine runtime mode early
  const useCloudRuntime = cloudMode && globalConfig.cloud;
  
  // Create container runtime and build images
  let runtime = await createRuntime(globalConfig, cloudMode || false, logger);
  let agentRuntimeOverrides: Record<string, any> = {};
  let baseImage = "action-llama"; // Default fallback
  const agentImages: Record<string, string> = {};

  if (runtime && dockerEnabled) {
    const buildResult = await buildAgentImages(
      runtime, 
      projectPath, 
      globalConfig, 
      activeAgentConfigs, 
      cloudMode || false, 
      statusTracker, 
      logger
    );
    baseImage = buildResult.baseImage;
    Object.assign(agentImages, buildResult.agentImages);

    // Handle ECS Lambda runtime selection
    if (useCloudRuntime && globalConfig.cloud?.provider === "ecs") {
      const cc = globalConfig.cloud;
      const { LambdaRuntime } = await import("../docker/lambda-runtime.js");
      const lambdaRuntime = new LambdaRuntime({
        awsRegion: cc.awsRegion!,
        ecrRepository: cc.ecrRepository!,
        secretPrefix: cc.awsSecretPrefix,
        buildBucket: cc.buildBucket,
        lambdaRoleArn: cc.lambdaRoleArn,
        lambdaSubnets: cc.lambdaSubnets,
        lambdaSecurityGroups: cc.lambdaSecurityGroups,
      });

      for (const ac of activeAgentConfigs) {
        const effectiveTimeout = ac.timeout ?? globalConfig.local?.timeout ?? 900;
        if (effectiveTimeout <= 900) { // AWS_CONSTANTS.LAMBDA_MAX_TIMEOUT
          agentRuntimeOverrides[ac.name] = lambdaRuntime;
          logger.info({ agent: ac.name, timeout: effectiveTimeout }, "Routing to Lambda (timeout <= 900s)");
        }
      }
    }
  }

  // Create runner pools for each agent with configurable scale
  const runnerPools: Record<string, RunnerPool> = {};

  // Import necessary classes once if docker is enabled
  const ContainerAgentRunnerClass = dockerEnabled && runtime ? (await import("../agents/container-runner.js")).ContainerAgentRunner : null;
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

  // Gateway callbacks — no-ops if gateway isn't running (remote runtimes)
  const registerContainer = gateway
    ? gateway.registerContainer
    : (_secret: string, _reg: any) => {};
  const unregisterContainer = gateway
    ? gateway.unregisterContainer
    : (_secret: string) => {};

  for (const agentConfig of agentConfigs) {
    const scale = agentConfig.scale ?? 1;
    const runners: PoolRunner[] = [];

    if (!dockerEnabled && scale > 1) {
      logger.warn({ agent: agentConfig.name, scale }, "scale > 1 has no effect without Docker — only one instance will run at a time");
    }

    for (let i = 0; i < scale; i++) {
      const instanceId = scale >= 2 ? `${agentConfig.name}(${i + 1})` : agentConfig.name;
      if (dockerEnabled && runtime && ContainerAgentRunnerClass) {
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
      } else {
        mkdirSync(agentDir(projectPath, agentConfig.name), { recursive: true });
        runners.push(new AgentRunner(
          agentConfig,
          mkLogger(projectPath, instanceId),
          projectPath,
          statusTracker
        ));
      }
    }

    runnerPools[agentConfig.name] = new RunnerPool(runners);
    logger.info({ agent: agentConfig.name, scale }, "Created runner pool");
  }

  const webhookQueueSize = globalConfig.webhookQueueSize ?? 20;
  const webhookQueue = new WebhookEventQueue<WebhookContext>(webhookQueueSize);
  const skills: PromptSkills | undefined = dockerEnabled ? { locking: true } : undefined;
  // Initialize helper classes
  const triggerDispatcher = new TriggerDispatcher();
  
  const schedulerCtx: SchedulerContext = { 
    runnerPools, 
    agentConfigs, 
    maxReruns, 
    maxTriggerDepth, 
    logger, 
    webhookQueue, 
    shuttingDown: false, 
    skills, 
    useBakedImages: dockerEnabled,
    triggerDispatcher
  };
  const cronManager = new CronManager();
  const shutdownHandler = new ShutdownHandler(logger);

  // Set up webhook bindings (only when gateway is enabled)
  if (webhookRegistry && gatewayEnabled) {
    bindWebhooksToAgents(
      webhookRegistry,
      agentConfigs,
      runnerPools,
      webhookSources,
      schedulerCtx,
      makeWebhookPrompt,
(triggers: Array<{ agent: string; context: string }>, sourceAgent: string, depth: number) => 
        schedulerCtx.triggerDispatcher.dispatchTriggers(triggers, sourceAgent, depth, schedulerCtx, makeTriggeredPrompt),
      drainWebhookQueue,
      statusTracker
    );
  }

  // Set up cron jobs (only for agents with a schedule)
  const cronJobs: Cron[] = [];
  
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
    for (let i = 0; i < activeAgentConfigs.length; i++) {
      const config = activeAgentConfigs[i];
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

  // Register shutdown handling
  shutdownHandler.register(cronJobs, gateway, webhookQueue);

  // Also mark context as shutting down when shutdown starts
  const originalShutdown = shutdownHandler.triggerShutdown.bind(shutdownHandler);
  shutdownHandler.triggerShutdown = async () => {
    schedulerCtx.shuttingDown = true;
    return originalShutdown();
  };

  return { cronJobs, runnerPools, gateway, webhookRegistry, webhookUrls, statusTracker };
}
