import { Cron } from "croner";
import { mkdirSync } from "fs";
import { loadGlobalConfig, loadAgentConfig, discoverAgents, validateAgentConfig } from "../shared/config.js";
import type { GlobalConfig, AgentConfig } from "../shared/config.js";
import { requireCredentialRef, loadCredentialField, listCredentialInstances, backendRequireCredentialRef, backendLoadField, backendListInstances } from "../shared/credentials.js";
import { createLogger, createFileOnlyLogger } from "../shared/logger.js";
import { agentDir } from "../shared/paths.js";
import { AgentRunner } from "../agents/runner.js";
import type { StatusTracker } from "../tui/status-tracker.js";
import { buildScheduledPrompt, buildWebhookPrompt } from "../agents/prompt.js";
import { WebhookRegistry } from "../webhooks/registry.js";
import { GitHubWebhookProvider } from "../webhooks/providers/github.js";
import { SentryWebhookProvider } from "../webhooks/providers/sentry.js";
import type { GatewayServer } from "../gateway/index.js";
import type { ContainerRuntime } from "../docker/runtime.js";
import type { WebhookContext, WebhookFilter, WebhookTrigger, GitHubWebhookFilter, SentryWebhookFilter } from "../webhooks/types.js";

interface RunnerLike {
  isRunning: boolean;
  run(prompt: string): Promise<void>;
}

// Provider type → credential type for loading secrets
const PROVIDER_TO_CREDENTIAL: Record<string, string> = {
  github: "github_webhook_secret",
  sentry: "sentry_client_secret",
};

function buildFilterFromTrigger(trigger: WebhookTrigger): WebhookFilter | undefined {
  const providerType = trigger.type;
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

export async function startScheduler(projectPath: string, globalConfigOverride?: GlobalConfig, statusTracker?: StatusTracker) {
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

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dockerEnabled = globalConfig.docker?.enabled === true;
  const anyWebhooks = agentConfigs.some((a) => a.webhooks?.length);

  // Validate pi_auth is not used with Docker (containers can't access host auth storage)
  if (dockerEnabled) {
    for (const config of agentConfigs) {
      if (config.model.authType === "pi_auth") {
        throw new Error(
          `Agent "${config.name}" uses pi_auth which is not supported in Docker mode. ` +
          `Either switch to api_key/oauth_token (run 'al setup') or use --dangerous-no-docker.`
        );
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

    // Load all GitHub webhook secrets (instanceName → secret value)
    const ghInstances = await backendListInstances("github_webhook_secret");
    const ghSecrets: Record<string, string> = {};
    for (const inst of ghInstances) {
      const secret = await backendLoadField("github_webhook_secret", inst, "secret");
      if (secret) ghSecrets[inst] = secret;
    }
    if (Object.keys(ghSecrets).length > 0) {
      webhookSecrets.github = ghSecrets;
      logger.info({ count: Object.keys(ghSecrets).length }, "loaded GitHub webhook secrets");
    }

    // Load all Sentry webhook secrets (instanceName → secret value)
    const sentryInstances = await backendListInstances("sentry_client_secret");
    const sentrySecrets: Record<string, string> = {};
    for (const inst of sentryInstances) {
      const secret = await backendLoadField("sentry_client_secret", inst, "secret");
      if (secret) sentrySecrets[inst] = secret;
    }
    if (Object.keys(sentrySecrets).length > 0) {
      webhookSecrets.sentry = sentrySecrets;
      logger.info({ count: Object.keys(sentrySecrets).length }, "loaded Sentry webhook secrets");
    }
  }

  let gateway: GatewayServer | undefined;
  let runtime: ContainerRuntime | undefined;
  let baseImage = "al-agent:latest";
  const agentImages: Record<string, string> = {};

  if (dockerEnabled) {
    logger.info("Docker mode enabled — initializing docker infrastructure");

    // 1. Verify Docker is available and running
    const { execFileSync } = await import("child_process");
    try {
      execFileSync("docker", ["info"], { stdio: "pipe", timeout: 10000 });
    } catch {
      throw new Error(
        "Docker is not running. Start Docker Desktop (or the Docker daemon) and try again, " +
        "or use --dangerous-no-docker to run without container isolation."
      );
    }

    // 2. Create the container runtime
    const { LocalDockerRuntime } = await import("../docker/local-runtime.js");
    runtime = new LocalDockerRuntime();

    // 3. Ensure Docker network exists
    logger.info("Ensuring Docker network...");
    const { ensureNetwork } = await import("../docker/network.js");
    ensureNetwork();

    // 4. Ensure base Docker image is built (may take a while on first run)
    baseImage = globalConfig.docker?.image || "al-agent:latest";
    logger.info({ image: baseImage }, "Ensuring base Docker image (this may take a few minutes on first run)...");
    const { ensureImage, ensureAgentImage } = await import("../docker/image.js");
    ensureImage(baseImage);

    // 5. Build per-agent images for agents with a custom Dockerfile
    for (const agentConfig of agentConfigs) {
      const image = ensureAgentImage(agentConfig.name, projectPath, baseImage);
      agentImages[agentConfig.name] = image;
      if (image !== baseImage) {
        logger.info({ agent: agentConfig.name, image }, "Built custom agent image");
      }
    }

    logger.info("Docker infrastructure ready");

    // 6. Start gateway (with webhook registry and kill function for shutdown)
    const { startGateway } = await import("../gateway/index.js");
    const gatewayPort = globalConfig.gateway?.port || 8080;
    gateway = await startGateway({
      port: gatewayPort,
      logger: mkLogger(projectPath, "gateway"),
      killContainer: (name) => runtime!.kill(name),
      webhookRegistry,
      webhookSecrets,
      statusTracker,
    });
  } else if (anyWebhooks) {
    // Start gateway even without docker when webhooks are configured
    logger.info("Starting gateway for webhook support (no docker)");
    const { startGateway } = await import("../gateway/index.js");
    const gatewayPort = globalConfig.gateway?.port || 8080;
    gateway = await startGateway({
      port: gatewayPort,
      logger: mkLogger(projectPath, "gateway"),
      webhookRegistry,
      webhookSecrets,
      statusTracker,
    });
  }

  // Create runners for each agent
  const runners: Record<string, RunnerLike> = {};

  if (dockerEnabled && gateway && runtime) {
    const { ContainerAgentRunner } = await import("../agents/container-runner.js");
    const gatewayPort = globalConfig.gateway?.port || 8080;
    const gatewayUrl = `http://host.docker.internal:${gatewayPort}`;

    for (const agentConfig of agentConfigs) {
      statusTracker?.registerAgent(agentConfig.name);
      runners[agentConfig.name] = new ContainerAgentRunner(
        runtime,
        globalConfig,
        agentConfig,
        mkLogger(projectPath, agentConfig.name),
        gateway.registerContainer,
        gateway.unregisterContainer,
        gatewayUrl,
        projectPath,
        agentImages[agentConfig.name] || baseImage,
        statusTracker
      );
    }
  } else {
    for (const agentConfig of agentConfigs) {
      mkdirSync(agentDir(projectPath, agentConfig.name), { recursive: true });
      statusTracker?.registerAgent(agentConfig.name);
      runners[agentConfig.name] = new AgentRunner(
        agentConfig,
        mkLogger(projectPath, agentConfig.name),
        projectPath,
        statusTracker
      );
    }
  }

  // Set up webhook bindings
  if (webhookRegistry) {
    for (const agentConfig of agentConfigs) {
      if (!agentConfig.webhooks?.length) continue;

      const runner = runners[agentConfig.name];

      for (const trigger of agentConfig.webhooks) {
        const filter = buildFilterFromTrigger(trigger);
        webhookRegistry.addBinding({
          agentName: agentConfig.name,
          source: trigger.source,
          type: trigger.type,
          filter,
          trigger: (context: WebhookContext) => {
            if (runner.isRunning) {
              logger.warn(`${agentConfig.name} is busy, skipping webhook trigger`);
              return;
            }
            logger.info(
              { agent: agentConfig.name, event: context.event, action: context.action },
              "webhook triggering agent"
            );
            const prompt = buildWebhookPrompt(agentConfig, context);
            runner.run(prompt).catch((err) => {
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
      await runner.run(buildScheduledPrompt(agentConfig));
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
      agentConfigs.flatMap((a) => a.webhooks?.map((t) => t.type) || [])
    );
    for (const pt of providerTypes) {
      webhookUrls.push(`http://localhost:${gatewayPort}/webhooks/${pt}`);
    }
  }

  logger.info(`Scheduler running with ${cronJobs.length} scheduled jobs`);

  // Fire initial run for scheduled agents
  for (const agentConfig of agentConfigs) {
    if (!agentConfig.schedule) continue;

    const runner = runners[agentConfig.name];
    logger.info(`Initial run for ${agentConfig.name}`);
    runner.run(buildScheduledPrompt(agentConfig)).catch((err) => {
      logger.error({ err }, `Initial ${agentConfig.name} run failed`);
    });
  }

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down scheduler...");
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
