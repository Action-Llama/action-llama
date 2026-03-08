import { Cron } from "croner";
import { mkdirSync } from "fs";
import { loadGlobalConfig, loadAgentConfig, discoverAgents, validateAgentConfig } from "../shared/config.js";
import type { GlobalConfig, AgentConfig, WebhookSourceConfig } from "../shared/config.js";
import { requireCredentialRef, loadCredentialField, listCredentialInstances, backendRequireCredentialRef, backendLoadField, backendListInstances } from "../shared/credentials.js";
import { createLogger, createFileOnlyLogger } from "../shared/logger.js";
import { agentDir } from "../shared/paths.js";
import { AgentRunner, type RunOutcome } from "../agents/runner.js";
import type { StatusTracker } from "../tui/status-tracker.js";
import { buildScheduledPrompt, buildWebhookPrompt, buildTriggeredPrompt } from "../agents/prompt.js";
import { WebhookRegistry } from "../webhooks/registry.js";
import { GitHubWebhookProvider } from "../webhooks/providers/github.js";
import { SentryWebhookProvider } from "../webhooks/providers/sentry.js";
import type { GatewayServer } from "../gateway/index.js";
import type { ContainerRuntime } from "../docker/runtime.js";
import { AWS_CONSTANTS } from "../shared/aws-constants.js";
import type { WebhookContext, WebhookFilter, WebhookTrigger, GitHubWebhookFilter, SentryWebhookFilter } from "../webhooks/types.js";
import { WebhookEventQueue } from "./event-queue.js";

interface RunnerLike {
  isRunning: boolean;
  run(prompt: string, triggerInfo?: { type: 'schedule' | 'webhook' | 'agent'; source?: string }): Promise<RunOutcome>;
}

// Provider type → credential type for loading secrets
const PROVIDER_TO_CREDENTIAL: Record<string, string> = {
  github: "github_webhook_secret",
  sentry: "sentry_client_secret",
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
  return undefined;
}

const DEFAULT_MAX_RERUNS = 10;
const DEFAULT_MAX_TRIGGER_DEPTH = 3;

interface SchedulerContext {
  runners: Record<string, RunnerLike>;
  agentConfigs: AgentConfig[];
  maxReruns: number;
  maxTriggerDepth: number;
  logger: ReturnType<typeof createLogger>;
  webhookQueue: WebhookEventQueue<WebhookContext>;
  shuttingDown: boolean;
}

function dispatchTriggers(
  triggers: Array<{ agent: string; context: string }>,
  sourceAgent: string,
  depth: number,
  ctx: SchedulerContext
): void {
  for (const { agent, context } of triggers) {
    if (agent === sourceAgent) {
      ctx.logger.warn({ source: sourceAgent }, "agent cannot trigger itself, skipping");
      continue;
    }
    if (depth >= ctx.maxTriggerDepth) {
      ctx.logger.warn({ source: sourceAgent, target: agent, depth, maxTriggerDepth: ctx.maxTriggerDepth }, "trigger depth limit reached, skipping");
      continue;
    }
    const targetConfig = ctx.agentConfigs.find((a) => a.name === agent);
    if (!targetConfig) {
      ctx.logger.warn({ source: sourceAgent, target: agent }, "trigger target agent not found, skipping");
      continue;
    }
    const runner = ctx.runners[agent];
    if (runner.isRunning) {
      ctx.logger.warn({ source: sourceAgent, target: agent }, "trigger target agent is busy, skipping");
      continue;
    }
    ctx.logger.info({ source: sourceAgent, target: agent, depth }, "agent trigger firing");
    const prompt = buildTriggeredPrompt(targetConfig, sourceAgent, context);
    runTriggered(runner, targetConfig, prompt, sourceAgent, depth + 1, ctx).catch((err) => {
      ctx.logger.error({ err, target: agent }, "triggered run failed");
    });
  }
}

async function runTriggered(
  runner: RunnerLike,
  agentConfig: AgentConfig,
  prompt: string,
  sourceAgent: string,
  depth: number,
  ctx: SchedulerContext
): Promise<void> {
  const { result, triggers } = await runner.run(prompt, { type: 'agent', source: sourceAgent });
  if (triggers.length > 0) {
    dispatchTriggers(triggers, agentConfig.name, depth, ctx);
  }
  // No reruns for triggered runs — they respond to a specific event
  if (result === "completed") {
    ctx.logger.info(`${agentConfig.name} triggered run completed`);
  }
}

async function drainWebhookQueue(
  runner: RunnerLike,
  agentConfig: AgentConfig,
  ctx: SchedulerContext
): Promise<void> {
  let event;
  while (!ctx.shuttingDown && (event = ctx.webhookQueue.dequeue(agentConfig.name)) !== undefined) {
    const ageMs = Date.now() - event.receivedAt.getTime();
    ctx.logger.info(
      { agent: agentConfig.name, event: event.context.event, ageMs, remaining: ctx.webhookQueue.size(agentConfig.name) },
      "processing queued webhook event"
    );
    try {
      const prompt = buildWebhookPrompt(agentConfig, event.context);
      const { triggers } = await runner.run(prompt, { type: 'webhook', source: event.context.event });
      if (triggers.length > 0) {
        dispatchTriggers(triggers, agentConfig.name, 0, ctx);
      }
    } catch (err) {
      ctx.logger.error({ err, agent: agentConfig.name }, "queued webhook run failed");
    }
  }
}

async function runWithReruns(
  runner: RunnerLike,
  agentConfig: AgentConfig,
  depth: number,
  ctx: SchedulerContext
): Promise<void> {
  let { result, triggers } = await runner.run(buildScheduledPrompt(agentConfig), { type: 'schedule' });
  if (triggers.length > 0) {
    dispatchTriggers(triggers, agentConfig.name, depth, ctx);
  }
  let reruns = 0;
  while (result === "completed" && reruns < ctx.maxReruns) {
    reruns++;
    ctx.logger.info({ rerun: reruns, maxReruns: ctx.maxReruns }, `${agentConfig.name} did work, re-running immediately`);
    ({ result, triggers } = await runner.run(buildScheduledPrompt(agentConfig), { type: 'schedule' }));
    if (triggers.length > 0) {
      dispatchTriggers(triggers, agentConfig.name, depth, ctx);
    }
  }
  if (result === "completed" && reruns >= ctx.maxReruns) {
    ctx.logger.warn({ maxReruns: ctx.maxReruns }, `${agentConfig.name} hit max reruns limit`);
  }

  // Drain any webhook events that arrived during the rerun cycle
  await drainWebhookQueue(runner, agentConfig, ctx);
}

export async function startScheduler(projectPath: string, globalConfigOverride?: GlobalConfig, statusTracker?: StatusTracker, cloudMode?: boolean, webUI?: boolean) {
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

  // Validate credentials exist for each agent
  const allCredentials = new Set(agentConfigs.flatMap((a) => a.credentials));
  for (const credRef of allCredentials) {
    await backendRequireCredentialRef(credRef);
  }

  const maxReruns = globalConfig.maxReruns ?? DEFAULT_MAX_RERUNS;
  const maxTriggerDepth = globalConfig.maxTriggerDepth ?? DEFAULT_MAX_TRIGGER_DEPTH;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dockerEnabled = globalConfig.local?.enabled === true;
  const anyWebhooks = agentConfigs.some((a) => a.webhooks?.length);

  // Validate pi_auth is not used with Docker (containers can't access host auth storage)
  if (dockerEnabled) {
    for (const config of agentConfigs) {
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
    for (const config of agentConfigs) {
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

    // Load secrets for each provider type referenced by webhook sources
    const providerTypes = new Set(Object.values(webhookSources).map(s => s.type));

    for (const providerType of providerTypes) {
      const credType = PROVIDER_TO_CREDENTIAL[providerType];
      if (!credType) continue;

      const instances = await backendListInstances(credType);
      const secrets: Record<string, string> = {};
      for (const inst of instances) {
        const secret = await backendLoadField(credType, inst, "secret");
        if (secret) secrets[inst] = secret;
      }
      if (Object.keys(secrets).length > 0) {
        webhookSecrets[providerType] = secrets;
        logger.info({ providerType, count: Object.keys(secrets).length }, "loaded webhook secrets");
      }
    }
  }

  let gateway: GatewayServer | undefined;
  let runtime: ContainerRuntime | undefined;
  let baseImage = AWS_CONSTANTS.DEFAULT_IMAGE;
  const agentImages: Record<string, string> = {};

  // Determine runtime type from cloud mode or local
  const useCloudRuntime = cloudMode && globalConfig.cloud;
  const runtimeType = useCloudRuntime ? globalConfig.cloud!.provider : "local";

  // Register agents early so the TUI shows them during image builds
  for (const agentConfig of agentConfigs) {
    statusTracker?.registerAgent(agentConfig.name);
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
      });
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
    }

    // 2. Build base image via the runtime
    const { resolve: resolvePath, dirname } = await import("path");
    const { fileURLToPath } = await import("url");
    const packageRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");

    baseImage = globalConfig.local?.image || AWS_CONSTANTS.DEFAULT_IMAGE;
    logger.info({ image: baseImage }, "Building base image (this may take a few minutes on first run)...");

    // Show all agents as "building" during the base image build
    const setBuildProgress = (message: string) => {
      for (const ac of agentConfigs) {
        statusTracker?.setAgentStatusText(ac.name, message);
      }
    };
    for (const ac of agentConfigs) {
      statusTracker?.setAgentState(ac.name, "building");
    }

    if (runtimeType === "local") {
      // Local: only build if image doesn't exist yet
      const { imageExists } = await import("../docker/image.js");
      if (!imageExists(baseImage)) {
        setBuildProgress("Building base image");
        await runtime.buildImage({
          tag: baseImage, dockerfile: "docker/Dockerfile", contextDir: packageRoot,
          onProgress: setBuildProgress,
        });
      }
    } else {
      // Cloud: always build (Cloud Build handles caching)
      baseImage = await runtime.buildImage({
        tag: baseImage, dockerfile: "docker/Dockerfile", contextDir: packageRoot,
        onProgress: setBuildProgress,
      });
    }

    // 3. Build per-agent custom images in parallel
    const { existsSync } = await import("fs");
    const agentsWithCustomImages = agentConfigs.filter(ac =>
      existsSync(resolvePath(projectPath, ac.name, "Dockerfile"))
    );
    const totalCustomImages = agentsWithCustomImages.length;

    // Agents without custom Dockerfiles use the base image
    for (const ac of agentConfigs) {
      if (!agentsWithCustomImages.includes(ac)) {
        agentImages[ac.name] = baseImage;
      }
    }

    // Build all custom images concurrently
    if (totalCustomImages > 0) {
      await Promise.all(agentsWithCustomImages.map(async (agentConfig, idx) => {
        const customImageIndex = idx + 1;
        const progressIndicator = totalCustomImages > 1 ? ` (${customImageIndex}/${totalCustomImages})` : "";

        statusTracker?.setAgentState(agentConfig.name, "building");
        statusTracker?.setAgentStatusText(agentConfig.name, `Building custom image${progressIndicator}`);

        const agentDockerfile = resolvePath(projectPath, agentConfig.name, "Dockerfile");
        const agentImageTag = AWS_CONSTANTS.agentImage(agentConfig.name);
        const image = await runtime!.buildImage({
          tag: agentImageTag,
          dockerfile: agentDockerfile,
          contextDir: packageRoot,
          baseImage,
          onProgress: (msg) => statusTracker?.setAgentStatusText(agentConfig.name, `${msg}${progressIndicator}`),
        });
        agentImages[agentConfig.name] = image;
        logger.info({ agent: agentConfig.name, image, progress: `${customImageIndex}/${totalCustomImages}` }, "Built custom agent image");
      }));
    }

    // 4. Push images to remote registry in parallel (no-op for local, tags+pushes for cloud)
    if (runtimeType !== "local") {
      const imagesToPush = agentConfigs.filter(ac => {
        const currentImage = agentImages[ac.name] || baseImage;
        return !currentImage.includes("/");
      });

      if (imagesToPush.length > 0) {
        await Promise.all(imagesToPush.map(async (agentConfig, idx) => {
          const currentImage = agentImages[agentConfig.name] || baseImage;
          const progressIndicator = imagesToPush.length > 1 ? ` (${idx + 1}/${imagesToPush.length})` : "";
          statusTracker?.setAgentStatusText(agentConfig.name, `Pushing image to registry${progressIndicator}`);
          const remoteImage = await runtime!.pushImage(currentImage);
          agentImages[agentConfig.name] = remoteImage;
          logger.info({ agent: agentConfig.name, image: remoteImage, progress: `${idx + 1}/${imagesToPush.length}` }, "Pushed image to registry");
        }));
      }
    }

    // Reset all agents back to idle after builds complete
    for (const ac of agentConfigs) {
      statusTracker?.setAgentState(ac.name, "idle");
    }

    logger.info("Docker infrastructure ready");

    // 6. Start gateway if the runtime needs it, webhooks are configured, or web UI is enabled
    if (runtime.needsGateway || anyWebhooks || webUI) {
      const { startGateway } = await import("../gateway/index.js");
      const gatewayPort = globalConfig.gateway?.port || 8080;
      gateway = await startGateway({
        port: gatewayPort,
        logger: mkLogger(projectPath, "gateway"),
        killContainer: (name) => runtime!.kill(name),
        webhookRegistry,
        webhookSecrets,
        statusTracker,
        projectPath,
        webUI,
      });
    }
  } else if (anyWebhooks || webUI) {
    // Start gateway even without docker when webhooks are configured or web UI is enabled
    logger.info("Starting gateway for webhook support (no docker)");
    const { startGateway } = await import("../gateway/index.js");
    const gatewayPort = globalConfig.gateway?.port || 8080;
    gateway = await startGateway({
      port: gatewayPort,
      logger: mkLogger(projectPath, "gateway"),
      webhookRegistry,
      webhookSecrets,
      statusTracker,
      projectPath,
      webUI,
    });
  }

  // Create runners for each agent
  const runners: Record<string, RunnerLike> = {};

  if (dockerEnabled && runtime) {
    const { ContainerAgentRunner } = await import("../agents/container-runner.js");
    const gatewayPort = globalConfig.gateway?.port || 8080;
    const gatewayUrl = `http://host.docker.internal:${gatewayPort}`;

    // Gateway callbacks — no-ops if gateway isn't running (remote runtimes)
    const registerContainer = gateway
      ? gateway.registerContainer
      : (_secret: string, _reg: any) => {};
    const unregisterContainer = gateway
      ? gateway.unregisterContainer
      : (_secret: string) => {};

    for (const agentConfig of agentConfigs) {
      runners[agentConfig.name] = new ContainerAgentRunner(
        runtime,
        globalConfig,
        agentConfig,
        mkLogger(projectPath, agentConfig.name),
        registerContainer,
        unregisterContainer,
        gatewayUrl,
        projectPath,
        agentImages[agentConfig.name] || baseImage,
        statusTracker
      );
    }
  } else {
    for (const agentConfig of agentConfigs) {
      mkdirSync(agentDir(projectPath, agentConfig.name), { recursive: true });
      runners[agentConfig.name] = new AgentRunner(
        agentConfig,
        mkLogger(projectPath, agentConfig.name),
        projectPath,
        statusTracker
      );
    }
  }

  const webhookQueueSize = globalConfig.webhookQueueSize ?? 20;
  const webhookQueue = new WebhookEventQueue<WebhookContext>(webhookQueueSize);
  const schedulerCtx: SchedulerContext = { runners, agentConfigs, maxReruns, maxTriggerDepth, logger, webhookQueue, shuttingDown: false };

  // Set up webhook bindings
  if (webhookRegistry) {
    for (const agentConfig of agentConfigs) {
      if (!agentConfig.webhooks?.length) continue;

      const runner = runners[agentConfig.name];

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
            if (runner.isRunning) {
              const { accepted, dropped } = webhookQueue.enqueue(agentConfig.name, context);
              if (accepted) {
                logger.info(
                  { agent: agentConfig.name, event: context.event, queueSize: webhookQueue.size(agentConfig.name) },
                  "agent busy, webhook event queued"
                );
              }
              if (dropped) {
                logger.warn(
                  { agent: agentConfig.name, droppedEvent: dropped.context.event },
                  "webhook queue full, oldest event dropped"
                );
              }
              return;
            }
            logger.info(
              { agent: agentConfig.name, event: context.event, action: context.action },
              "webhook triggering agent"
            );
            const prompt = buildWebhookPrompt(agentConfig, context);
            runner.run(prompt, { type: 'webhook', source: context.event }).then(({ triggers }) => {
              if (triggers.length > 0) {
                dispatchTriggers(triggers, agentConfig.name, 0, schedulerCtx);
              }
              // Drain any events that queued while this webhook run was executing
              return drainWebhookQueue(runner, agentConfig, schedulerCtx);
            }).catch((err) => {
              logger.error({ err }, `${agentConfig.name} webhook run failed`);
            });
          },
        });
      }
    }
  }

  // Set up cron jobs (only for agents with a schedule)
  const cronJobs: Cron[] = [];

  for (const agentConfig of agentConfigs) {
    if (!agentConfig.schedule) continue;

    const runner = runners[agentConfig.name];

    const job = new Cron(agentConfig.schedule, { timezone }, async () => {
      if (runner.isRunning) {
        logger.warn(`${agentConfig.name} is busy, skipping scheduled run`);
        return;
      }
      logger.info(`Triggering ${agentConfig.name} (scheduled)`);
      await runWithReruns(runner, agentConfig, 0, schedulerCtx);
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

  // Fire initial run for scheduled agents
  for (const agentConfig of agentConfigs) {
    if (!agentConfig.schedule) continue;

    const runner = runners[agentConfig.name];
    logger.info(`Initial run for ${agentConfig.name}`);
    runWithReruns(runner, agentConfig, 0, schedulerCtx).catch((err) => {
      logger.error({ err }, `Initial ${agentConfig.name} run failed`);
    });
  }

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down scheduler...");
    schedulerCtx.shuttingDown = true;
    webhookQueue.clearAll();
    for (const job of cronJobs) {
      job.stop();
    }
    if (gateway) {
      await gateway.close();
      logger.info("Gateway server stopped");
    }
    logger.info("All cron jobs stopped");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return { cronJobs, runners, gateway, webhookRegistry, webhookUrls, statusTracker };
}
