import { Cron } from "croner";
import { mkdirSync } from "fs";
import { loadGlobalConfig, loadAgentConfig, discoverAgents, validateAgentConfig } from "../shared/config.js";
import type { GlobalConfig, AgentConfig, WebhookSourceConfig } from "../shared/config.js";
import { requireCredentialRef, loadCredentialField, listCredentialInstances } from "../shared/credentials.js";
import { createLogger, createFileOnlyLogger } from "../shared/logger.js";
import { agentDir } from "../shared/paths.js";
import { AgentRunner } from "../agents/runner.js";
import type { StatusTracker } from "../tui/status-tracker.js";
import {
  buildScheduledPrompt, buildWebhookPrompt, buildCalledPrompt,
  buildScheduledSuffix, buildWebhookSuffix, buildCalledSuffix,
  type PromptSkills,
} from "../agents/prompt.js";
import { WebhookRegistry } from "../webhooks/registry.js";
import { GitHubWebhookProvider } from "../webhooks/providers/github.js";
import { SentryWebhookProvider } from "../webhooks/providers/sentry.js";
import { LinearWebhookProvider } from "../webhooks/providers/linear.js";
import type { GatewayServer } from "../gateway/index.js";
import type { ContainerRuntime } from "../docker/runtime.js";
import { AWS_CONSTANTS } from "../shared/aws-constants.js";
import { buildAllImages } from "../cloud/image-builder.js";
import type { WebhookContext, WebhookFilter, WebhookTrigger, GitHubWebhookFilter, SentryWebhookFilter, LinearWebhookFilter } from "../webhooks/types.js";
import { WorkQueue } from "./event-queue.js";
import { RunnerPool, type PoolRunner } from "./runner-pool.js";
import type { AgentInstance } from "./types.js";

/** A work item is either a webhook event or an agent call. */
export type WorkItem =
  | { type: "webhook"; webhookContext: WebhookContext }
  | { type: "call"; callId: string; callerAgent: string; context: string };

// Provider type → credential type for loading secrets
const PROVIDER_TO_CREDENTIAL: Record<string, string> = {
  github: "github_webhook_secret",
  sentry: "sentry_client_secret",
  linear: "linear_webhook_secret",
};

function resolveWebhookSource(
  sourceName: string,
  agentName: string,
  webhookSources: Record<string, WebhookSourceConfig>
): WebhookSourceConfig {
  const source = webhookSources[sourceName];
  if (!source) {
    const available = Object.keys(webhookSources).join(", ") || "(none)";
    throw new Error(
      `Agent "${agentName}" references webhook source "${sourceName}" ` +
      `which is not defined in config.toml [webhooks]. Available: ${available}`
    );
  }
  return source;
}

function buildFilterFromTrigger(trigger: WebhookTrigger, providerType: string): WebhookFilter | undefined {
  if (providerType === "github") {
    const f: GitHubWebhookFilter = {};
    if (trigger.events) f.events = trigger.events;
    if (trigger.actions) f.actions = trigger.actions;
    if (trigger.repos) f.repos = trigger.repos;
    if (trigger.labels) f.labels = trigger.labels;
    if (trigger.assignee) f.assignee = trigger.assignee;
    if (trigger.author) f.author = trigger.author;
    if (trigger.branches) f.branches = trigger.branches;
    return Object.keys(f).length > 0 ? f : undefined;
  }
  if (providerType === "sentry") {
    const f: SentryWebhookFilter = {};
    if (trigger.resources) f.resources = trigger.resources;
    return Object.keys(f).length > 0 ? f : undefined;
  }
  if (providerType === "linear") {
    const f: LinearWebhookFilter = {};
    if (trigger.events) f.events = trigger.events;
    if (trigger.actions) f.actions = trigger.actions;
    if (trigger.organizations) f.organizations = trigger.organizations;
    if (trigger.labels) f.labels = trigger.labels;
    if (trigger.assignee) f.assignee = trigger.assignee;
    if (trigger.author) f.author = trigger.author;
    return Object.keys(f).length > 0 ? f : undefined;
  }
  return undefined;
}

const DEFAULT_MAX_RERUNS = 10;
const DEFAULT_MAX_CALL_DEPTH = 3;

import type { CallStore } from "../gateway/call-store.js";

function generateInstanceId(agentName: string): string {
  const timestamp = Date.now();
  const randomHex = Math.random().toString(16).slice(2, 8);
  return `${agentName}-${timestamp}-${randomHex}`;
}

interface SchedulerContext {
  runnerPools: Record<string, RunnerPool>;
  agentConfigs: AgentConfig[];
  maxReruns: number;
  maxCallDepth: number;
  logger: ReturnType<typeof createLogger>;
  workQueue: WorkQueue<WorkItem>;
  shuttingDown: boolean;
  skills?: PromptSkills;
  /** When true, images have baked-in static files; only pass dynamic suffix as prompt. */
  useBakedImages: boolean;
  paused: boolean;
  runningInstances: Map<string, AgentInstance>;
  statusTracker?: StatusTracker;
  callStore?: CallStore;
}

// Prompt helpers: when images have baked-in static files, only pass the dynamic suffix.
// Otherwise, pass the full prompt (for non-Docker or legacy images).
function makeScheduledPrompt(agentConfig: AgentConfig, ctx: SchedulerContext): string {
  return ctx.useBakedImages ? buildScheduledSuffix() : buildScheduledPrompt(agentConfig, ctx.skills);
}

function makeWebhookPrompt(agentConfig: AgentConfig, context: WebhookContext, ctx: SchedulerContext): string {
  return ctx.useBakedImages ? buildWebhookSuffix(context) : buildWebhookPrompt(agentConfig, context, ctx.skills);
}

function makeCalledPrompt(agentConfig: AgentConfig, callerAgent: string, context: string, ctx: SchedulerContext): string {
  return ctx.useBakedImages ? buildCalledSuffix(callerAgent, context) : buildCalledPrompt(agentConfig, callerAgent, context, ctx.skills);
}

import type { CallEntry } from "../gateway/call-store.js";

function dispatchCall(
  entry: CallEntry,
  ctx: SchedulerContext
): { ok: boolean; reason?: string } {
  const { callerAgent, targetAgent, callId } = entry;

  if (targetAgent === callerAgent) {
    return { ok: false, reason: "agent cannot call itself" };
  }

  if (entry.depth >= ctx.maxCallDepth) {
    return { ok: false, reason: `call depth limit reached (max ${ctx.maxCallDepth})` };
  }

  const targetConfig = ctx.agentConfigs.find((a) => a.name === targetAgent);
  if (!targetConfig) {
    return { ok: false, reason: `target agent "${targetAgent}" not found` };
  }

  const pool = ctx.runnerPools[targetAgent];
  if (!pool || pool.size === 0) {
    return { ok: false, reason: `agent "${targetAgent}" is disabled (scale=0)` };
  }

  const availableRunner = pool.getAvailableRunner();
  if (!availableRunner) {
    // Queue the call — it will be picked up when a runner frees up
    const { dropped } = ctx.workQueue.enqueue(targetAgent, { type: "call", callId, callerAgent, context: entry.context });
    if (dropped && dropped.context.type === "call" && ctx.callStore) {
      ctx.callStore.fail(dropped.context.callId, "evicted from work queue");
    }
    ctx.logger.info({ caller: callerAgent, target: targetAgent, callId, queueSize: ctx.workQueue.size(targetAgent), running: pool.runningJobCount, scale: pool.size }, "all runners busy, call queued");
    return { ok: true };
  }

  ctx.logger.info({ caller: callerAgent, target: targetAgent, callId, depth: entry.depth, running: pool.runningJobCount, scale: pool.size }, "agent call dispatching");

  const callStore = ctx.callStore!;
  callStore.setRunning(callId);

  const prompt = makeCalledPrompt(targetConfig, callerAgent, entry.context, ctx);
  runCalled(availableRunner, targetConfig, prompt, callId, ctx).catch((err) => {
    ctx.logger.error({ err, target: targetAgent, callId }, "called run failed");
    callStore.fail(callId, String(err?.message || err));
  });

  return { ok: true };
}

async function runCalled(
  runner: PoolRunner,
  agentConfig: AgentConfig,
  prompt: string,
  callId: string,
  ctx: SchedulerContext
): Promise<void> {
  // Create and register instance
  const instanceId = generateInstanceId(agentConfig.name);
  const instance: AgentInstance = {
    id: instanceId,
    agentName: agentConfig.name,
    status: 'running',
    startedAt: new Date(),
    trigger: `call:${callId}`,
    runner
  };

  ctx.runningInstances.set(instanceId, instance);
  ctx.statusTracker?.registerInstance(instance);

  const callStore = ctx.callStore!;
  try {
    const { result, returnValue } = await runner.run(prompt, { type: 'agent', source: `call:${callId}` });
    if (result === "error") {
      callStore.fail(callId, "agent run failed");
      instance.status = 'error';
    } else {
      callStore.complete(callId, returnValue);
      instance.status = 'completed';
    }
    ctx.logger.info({ agent: agentConfig.name, callId, result, hasReturn: !!returnValue }, "called run completed");
  } catch (err: any) {
    callStore.fail(callId, String(err?.message || err));
    instance.status = 'error';
    throw err;
  } finally {
    ctx.runningInstances.delete(instanceId);
    ctx.statusTracker?.unregisterInstance(instanceId);
  }
  // Runner is now free — drain any queued work for this agent
  await drainWorkQueue(agentConfig, ctx);
}

async function drainWorkQueue(
  agentConfig: AgentConfig,
  ctx: SchedulerContext
): Promise<void> {
  const pool = ctx.runnerPools[agentConfig.name];
  let item;
  while (!ctx.shuttingDown && (item = ctx.workQueue.dequeue(agentConfig.name)) !== undefined) {
    const runner = pool.getAvailableRunner();
    if (!runner) {
      // Put the item back in the queue if no runners are available
      ctx.workQueue.enqueue(agentConfig.name, item.context, item.receivedAt);
      break;
    }
    const ageMs = Date.now() - item.receivedAt.getTime();

    if (item.context.type === "webhook") {
      const webhookCtx = item.context.webhookContext;
      ctx.logger.info(
        { agent: agentConfig.name, event: webhookCtx.event, ageMs, remaining: ctx.workQueue.size(agentConfig.name), running: pool.runningJobCount, scale: pool.size },
        "processing queued webhook event"
      );
      try {
        const prompt = makeWebhookPrompt(agentConfig, webhookCtx, ctx);
        await runner.run(prompt, { type: 'webhook', source: webhookCtx.event });
      } catch (err) {
        ctx.logger.error({ err, agent: agentConfig.name }, "queued webhook run failed");
      }
    } else if (item.context.type === "call") {
      const { callId, callerAgent, context } = item.context;
      ctx.logger.info(
        { agent: agentConfig.name, callId, caller: callerAgent, ageMs, remaining: ctx.workQueue.size(agentConfig.name), running: pool.runningJobCount, scale: pool.size },
        "processing queued call"
      );
      const callStore = ctx.callStore!;
      callStore.setRunning(callId);
      const prompt = makeCalledPrompt(agentConfig, callerAgent, context, ctx);
      try {
        await runCalled(runner, agentConfig, prompt, callId, ctx);
      } catch (err) {
        ctx.logger.error({ err, agent: agentConfig.name, callId }, "queued call run failed");
      }
    }
  }
}

async function runWithReruns(
  runner: PoolRunner,
  agentConfig: AgentConfig,
  ctx: SchedulerContext
): Promise<void> {
  // Create and register instance
  const instanceId = generateInstanceId(agentConfig.name);
  const instance: AgentInstance = {
    id: instanceId,
    agentName: agentConfig.name,
    status: 'running',
    startedAt: new Date(),
    trigger: 'schedule',
    runner
  };

  ctx.runningInstances.set(instanceId, instance);
  ctx.statusTracker?.registerInstance(instance);

  try {
    let { result } = await runner.run(makeScheduledPrompt(agentConfig, ctx), { type: 'schedule' });
    let reruns = 0;
    while (result === "rerun" && reruns < ctx.maxReruns) {
      reruns++;
      ctx.logger.info({ rerun: reruns, maxReruns: ctx.maxReruns }, `${agentConfig.name} requested rerun, re-running immediately`);
      ({ result } = await runner.run(makeScheduledPrompt(agentConfig, ctx), { type: 'schedule', source: `rerun ${reruns}/${ctx.maxReruns}` }));
    }
    if (result === "rerun" && reruns >= ctx.maxReruns) {
      ctx.logger.warn({ maxReruns: ctx.maxReruns }, `${agentConfig.name} hit max reruns limit`);
    }

    // Drain any work items that arrived during the rerun cycle
    await drainWorkQueue(agentConfig, ctx);

    instance.status = result === 'error' ? 'error' : 'completed';
  } catch (err) {
    instance.status = 'error';
    throw err;
  } finally {
    ctx.runningInstances.delete(instanceId);
    ctx.statusTracker?.unregisterInstance(instanceId);
  }
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
  const allCredentials = new Set(activeAgentConfigs.flatMap((a) => a.credentials));
  for (const credRef of allCredentials) {
    await requireCredentialRef(credRef);
  }

  // Validate ECS IAM roles exist if using cloud ECS mode
  if (cloudMode && globalConfig.cloud?.provider === "ecs") {
    logger.info("Validating ECS IAM task roles...");
    const { validateEcsRoles } = await import("../cli/commands/doctor.js");
    try {
      await validateEcsRoles(projectPath, globalConfig.cloud);
      logger.info("All ECS IAM task roles validated successfully");
    } catch (err: any) {
      logger.error("ECS IAM role validation failed");
      throw new Error(
        `❌ ECS IAM role validation failed\n\n` +
        `${err.message}\n\n` +
        `This validation prevents runtime failures when agents try to start.\n` +
        `Fix the IAM roles before starting the scheduler.`
      );
    }
  }

  const maxReruns = globalConfig.maxReruns ?? DEFAULT_MAX_RERUNS;
  const maxCallDepth = globalConfig.maxCallDepth ?? globalConfig.maxTriggerDepth ?? DEFAULT_MAX_CALL_DEPTH;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dockerEnabled = globalConfig.local?.enabled === true;
  const anyWebhooks = activeAgentConfigs.some((a) => a.webhooks?.length);

  // Validate pi_auth is not used with Docker (containers can't access host auth storage)
  if (dockerEnabled) {
    for (const config of activeAgentConfigs) {
      if (config.model.authType === "pi_auth") {
        throw new Error(
          `Agent "${config.name}" uses pi_auth which is not supported in Docker mode. ` +
          `Either switch to api_key/oauth_token (run 'al doctor') or use --no-docker.`
        );
      }
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
  let webhookRegistry: WebhookRegistry | undefined;
  let webhookSecrets: Record<string, Record<string, string>> = {};

  if (anyWebhooks) {
    webhookRegistry = new WebhookRegistry(logger);

    // Register providers
    webhookRegistry.registerProvider(new GitHubWebhookProvider());
    webhookRegistry.registerProvider(new SentryWebhookProvider());
    webhookRegistry.registerProvider(new LinearWebhookProvider());

    // Load secrets for each provider type referenced by webhook sources
    const providerTypes = new Set(Object.values(webhookSources).map(s => s.type));

    for (const providerType of providerTypes) {
      const credType = PROVIDER_TO_CREDENTIAL[providerType];
      if (!credType) continue;

      const instances = await listCredentialInstances(credType);
      const secrets: Record<string, string> = {};
      for (const inst of instances) {
        const secret = await loadCredentialField(credType, inst, "secret");
        if (secret) secrets[inst] = secret;
      }
      if (Object.keys(secrets).length > 0) {
        webhookSecrets[providerType] = secrets;
        logger.info({ providerType, count: Object.keys(secrets).length }, "loaded webhook secrets");
      }
    }
  }

  let runtime: ContainerRuntime | undefined;
  let agentRuntimeOverrides: Record<string, ContainerRuntime> = {};
  let baseImage = AWS_CONSTANTS.DEFAULT_IMAGE;
  const agentImages: Record<string, string> = {};

  // Determine runtime type from cloud mode or local
  const useCloudRuntime = cloudMode && globalConfig.cloud;
  const runtimeType = useCloudRuntime ? globalConfig.cloud!.provider : "local";

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

  // Define control functions early for gateway
  let gatewayControlDeps: any = {};
  
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
      controlDeps: gatewayControlDeps, // will be populated later
    });
    logger.info({ port: gatewayPort }, "Gateway started early to show build progress");
  }

  if (dockerEnabled) {
    logger.info({ runtime: runtimeType }, "Docker mode enabled — initializing infrastructure");

    // 1. Create the container runtime
    if (useCloudRuntime && globalConfig.cloud!.provider === "cloud-run") {
      const { CloudRunJobRuntime } = await import("../docker/cloud-run-runtime.js");
      const { gcpProject, region, artifactRegistry, serviceAccount, secretPrefix } = globalConfig.cloud!;
      if (!gcpProject || !region || !artifactRegistry || !serviceAccount) {
        throw new Error(
          "Cloud Run runtime requires cloud.gcpProject, cloud.region, " +
          "cloud.artifactRegistry, and cloud.serviceAccount in config.toml"
        );
      }
      runtime = new CloudRunJobRuntime({ gcpProject, region, artifactRegistry, serviceAccount, secretPrefix });
      logger.info({ gcpProject, region }, "Using Cloud Run Jobs runtime");
    } else if (useCloudRuntime && globalConfig.cloud!.provider === "ecs") {
      const { ECSFargateRuntime } = await import("../docker/ecs-runtime.js");
      const cc = globalConfig.cloud!;
      if (!cc.awsRegion || !cc.ecsCluster || !cc.ecrRepository || !cc.executionRoleArn || !cc.taskRoleArn || !cc.subnets?.length) {
        throw new Error(
          "ECS runtime requires cloud.awsRegion, cloud.ecsCluster, cloud.ecrRepository, " +
          "cloud.executionRoleArn, cloud.taskRoleArn, and cloud.subnets in config.toml"
        );
      }
      runtime = new ECSFargateRuntime({
        awsRegion: cc.awsRegion,
        ecsCluster: cc.ecsCluster,
        ecrRepository: cc.ecrRepository,
        executionRoleArn: cc.executionRoleArn,
        taskRoleArn: cc.taskRoleArn,
        subnets: cc.subnets,
        securityGroups: cc.securityGroups,
        secretPrefix: cc.awsSecretPrefix,
        buildBucket: cc.buildBucket,
      });

      // Create Lambda runtime for short-running agents (timeout <= 900s)
      const { LambdaRuntime } = await import("../docker/lambda-runtime.js");
      const lambdaRuntime = new LambdaRuntime({
        awsRegion: cc.awsRegion,
        ecrRepository: cc.ecrRepository,
        secretPrefix: cc.awsSecretPrefix,
        buildBucket: cc.buildBucket,
        lambdaRoleArn: cc.lambdaRoleArn,
        lambdaSubnets: cc.lambdaSubnets,
        lambdaSecurityGroups: cc.lambdaSecurityGroups,
      });

      // Per-agent runtime selection: Lambda for short agents, ECS for long ones
      agentRuntimeOverrides = {};
      for (const ac of activeAgentConfigs) {
        const effectiveTimeout = ac.timeout ?? globalConfig.local?.timeout ?? 900;
        if (effectiveTimeout <= AWS_CONSTANTS.LAMBDA_MAX_TIMEOUT) {
          agentRuntimeOverrides[ac.name] = lambdaRuntime;
          logger.info({ agent: ac.name, timeout: effectiveTimeout }, "Routing to Lambda (timeout <= 900s)");
        }
      }

      logger.info({ region: cc.awsRegion, cluster: cc.ecsCluster }, "Using ECS Fargate runtime");
    } else {
      // Local runtime needs Docker running
      const { execFileSync } = await import("child_process");
      try {
        execFileSync("docker", ["info"], { stdio: "pipe", timeout: 10000 });
      } catch {
        throw new Error(
          "Docker is not running. Start Docker Desktop (or the Docker daemon) and try again, " +
          "or use --no-docker to run without container isolation."
        );
      }

      const { LocalDockerRuntime } = await import("../docker/local-runtime.js");
      runtime = new LocalDockerRuntime();

      // Local-only: ensure Docker network
      logger.info("Ensuring Docker network...");
      const { ensureNetwork } = await import("../docker/network.js");
      ensureNetwork();

      // Start gateway proxy container if gateway is enabled
      if (gatewayEnabled && runtime.startGatewayProxy) {
        const gatewayPort = globalConfig.gateway?.port || 8080;
        logger.info({ port: gatewayPort }, "Starting gateway proxy container for local Docker runtime");
        await runtime.startGatewayProxy(gatewayPort);
      }
    }

    // 2. Build base + per-agent images via shared image builder
    const buildSkills: PromptSkills | undefined = dockerEnabled ? { locking: true, calling: true } : undefined;

    const buildResult = await buildAllImages({
      projectPath,
      globalConfig,
      activeAgentConfigs,
      runtime: runtime!,
      runtimeType,
      statusTracker,
      logger,
      skills: buildSkills,
    });

    baseImage = buildResult.baseImage;
    Object.assign(agentImages, buildResult.agentImages);
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
        : `http://gateway:${gatewayPort}`))
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
          statusTracker,
          instanceId
        ));
      }
    }

    runnerPools[agentConfig.name] = new RunnerPool(runners);
    logger.info({ agent: agentConfig.name, scale }, "Created runner pool");
  }

  const workQueueSize = globalConfig.workQueueSize ?? globalConfig.webhookQueueSize ?? 100;
  const workQueue = new WorkQueue<WorkItem>(workQueueSize);
  const skills: PromptSkills | undefined = dockerEnabled ? { locking: true, calling: true } : undefined;
  const schedulerCtx: SchedulerContext = {
    runnerPools, agentConfigs, maxReruns, maxCallDepth, logger, workQueue,
    shuttingDown: false, skills, useBakedImages: dockerEnabled,
    paused: false,
    runningInstances: new Map(),
    statusTracker,
    callStore: gateway?.callStore,
  };

  // Control functions for management
  const killInstance = async (instanceId: string): Promise<boolean> => {
    const instance = schedulerCtx.runningInstances.get(instanceId);
    if (!instance) {
      return false;
    }

    if (instance.runner && typeof instance.runner.abort === 'function') {
      instance.runner.abort();
    }

    instance.status = 'killed';
    logger.info({ instanceId, agent: instance.agentName }, "Instance killed");
    return true;
  };

  const pauseScheduler = async (): Promise<void> => {
    schedulerCtx.paused = true;
    statusTracker?.setPaused(true);
    logger.info("Scheduler paused");
  };

  const resumeScheduler = async (): Promise<void> => {
    schedulerCtx.paused = false;
    statusTracker?.setPaused(false);
    logger.info("Scheduler resumed");
  };

  // Update gateway control dependencies and wire call dispatcher
  if (gatewayEnabled && gateway) {
    Object.assign(gatewayControlDeps, {
      statusTracker,
      killInstance,
      pauseScheduler,
      resumeScheduler,
    });
    gateway.setCallDispatcher((entry) => dispatchCall(entry as CallEntry, schedulerCtx));
  }

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
            // Skip if scheduler is paused
            if (schedulerCtx.paused) {
              logger.info({ agent: agentConfig.name, event: context.event }, "scheduler is paused, ignoring webhook event");
              return;
            }
            
            // Skip if agent is disabled
            if (statusTracker && !statusTracker.isAgentEnabled(agentConfig.name)) {
              logger.info({ agent: agentConfig.name, event: context.event }, "agent is disabled, ignoring webhook event");
              return;
            }

            const availableRunner = pool.getAvailableRunner();
            if (!availableRunner) {
              const workItem: WorkItem = { type: "webhook", webhookContext: context };
              const { accepted, dropped } = workQueue.enqueue(agentConfig.name, workItem);
              if (accepted) {
                logger.info(
                  { agent: agentConfig.name, event: context.event, queueSize: workQueue.size(agentConfig.name), running: pool.runningJobCount, scale: pool.size },
                  "all agent runners busy, webhook event queued"
                );
              }
              if (dropped) {
                const droppedDesc = dropped.context.type === "webhook" ? dropped.context.webhookContext.event : `call:${dropped.context.callId}`;
                logger.warn(
                  { agent: agentConfig.name, droppedItem: droppedDesc },
                  "work queue full, oldest item dropped"
                );
                if (dropped.context.type === "call" && gateway?.callStore) {
                  gateway.callStore.fail(dropped.context.callId, "evicted from work queue");
                }
              }
              return;
            }
            logger.info(
              { agent: agentConfig.name, event: context.event, action: context.action, running: pool.runningJobCount, scale: pool.size },
              "webhook triggering agent"
            );
            
            // Create and register instance
            const instanceId = generateInstanceId(agentConfig.name);
            const instance: AgentInstance = {
              id: instanceId,
              agentName: agentConfig.name,
              status: 'running',
              startedAt: new Date(),
              trigger: `webhook:${context.event}`,
              runner: availableRunner
            };
            
            schedulerCtx.runningInstances.set(instanceId, instance);
            schedulerCtx.statusTracker?.registerInstance(instance);
            
            const prompt = makeWebhookPrompt(agentConfig, context, schedulerCtx);
            availableRunner.run(prompt, { type: 'webhook', source: context.event }).then(() => {
              instance.status = 'completed';
              // Drain any work items that queued while this webhook run was executing
              return drainWorkQueue(agentConfig, schedulerCtx);
            }).catch((err) => {
              instance.status = 'error';
              logger.error({ err }, `${agentConfig.name} webhook run failed`);
            }).finally(() => {
              // Unregister instance
              schedulerCtx.runningInstances.delete(instanceId);
              schedulerCtx.statusTracker?.unregisterInstance(instanceId);
            });
          },
        });
      }
    }
  }

  // Set up cron jobs (only for agents with a schedule)
  const cronJobs: Cron[] = [];

  for (const agentConfig of activeAgentConfigs) {
    if (!agentConfig.schedule) continue;

    const pool = runnerPools[agentConfig.name];

    const job = new Cron(agentConfig.schedule, { timezone }, async () => {
      // Skip if scheduler is paused
      if (schedulerCtx.paused) {
        logger.info({ agent: agentConfig.name }, "scheduler is paused, skipping scheduled run");
        return;
      }
      
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
      await runWithReruns(availableRunner, agentConfig, schedulerCtx);
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
      runWithReruns(availableRunner, agentConfig, schedulerCtx).catch((err) => {
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
    workQueue.clearAll();
    for (const job of cronJobs) {
      job.stop();
    }
    if (gateway) {
      await gateway.close();
      logger.info("Gateway server stopped");
    }
    // Stop gateway proxy if running local Docker
    if (dockerEnabled && !useCloudRuntime && runtime && runtime.stopGatewayProxy) {
      await runtime.stopGatewayProxy();
      logger.info("Gateway proxy container stopped");
    }
    logger.info("All cron jobs stopped");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);



  return { 
    cronJobs, 
    runnerPools, 
    gateway, 
    webhookRegistry, 
    webhookUrls, 
    statusTracker,
    killInstance,
    pauseScheduler,
    resumeScheduler
  };
}
