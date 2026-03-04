import { Cron } from "croner";
import { mkdirSync } from "fs";
import { loadGlobalConfig, loadAgentConfig, discoverAgents, validateAgentConfig } from "../shared/config.js";
import type { GlobalConfig, AgentConfig } from "../shared/config.js";
import { requireCredential, loadCredential } from "../shared/credentials.js";
import { createLogger, createFileOnlyLogger } from "../shared/logger.js";
import { agentDir } from "../shared/paths.js";
import { AgentRunner } from "../agents/runner.js";
import type { StatusTracker } from "../tui/status-tracker.js";
import { buildScheduledPrompt, buildWebhookPrompt } from "../agents/prompt.js";
import { WebhookRegistry } from "../webhooks/registry.js";
import { GitHubWebhookProvider } from "../webhooks/providers/github.js";
import type { BrokerServer } from "../broker/index.js";
import type { WebhookContext } from "../webhooks/types.js";

interface RunnerLike {
  isRunning: boolean;
  run(prompt: string): Promise<void>;
}

export async function startScheduler(projectPath: string, globalConfigOverride?: GlobalConfig, statusTracker?: StatusTracker) {
  const mkLogger = statusTracker ? createFileOnlyLogger : createLogger;
  const logger = mkLogger(projectPath, "scheduler");
  logger.info("Starting scheduler...");

  const globalConfig = globalConfigOverride || loadGlobalConfig(projectPath);

  // Discover all agents in the project
  const agentNames = discoverAgents(projectPath);
  if (agentNames.length === 0) {
    throw new Error("No agents found. Run 'al init' to create a project with agents.");
  }

  const agentConfigs: AgentConfig[] = agentNames.map((name) => loadAgentConfig(projectPath, name));

  // Validate each agent has schedule, webhooks, or both
  for (const config of agentConfigs) {
    validateAgentConfig(config);
  }

  // Validate credentials exist for each agent
  const allCredentials = new Set(agentConfigs.flatMap((a) => a.credentials));
  for (const cred of allCredentials) {
    requireCredential(cred);
  }

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dockerEnabled = globalConfig.docker?.enabled === true;
  const anyWebhooks = agentConfigs.some((a) => a.webhooks?.filters?.length);

  // Set up webhook registry if any agents use webhooks
  let webhookRegistry: WebhookRegistry | undefined;
  let webhookSecrets: Record<string, string | undefined> = {};

  if (anyWebhooks) {
    webhookRegistry = new WebhookRegistry(logger);

    // Register GitHub provider
    webhookRegistry.registerProvider(new GitHubWebhookProvider());

    // Load GitHub webhook secret from credentials (if configured)
    const secretCredName = globalConfig.webhooks?.githubSecretCredential || "github-webhook-secret";
    const githubSecret = loadCredential(secretCredName);
    if (githubSecret) {
      webhookSecrets.github = githubSecret;
    }
  }

  let broker: BrokerServer | undefined;

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

    // 2. Ensure Docker network exists
    logger.info("Ensuring Docker network...");
    const { ensureNetwork } = await import("../docker/network.js");
    ensureNetwork();

    // 3. Ensure Docker image is built (may take a while on first run)
    const image = globalConfig.docker?.image || "al-agent:latest";
    logger.info({ image }, "Ensuring Docker image (this may take a few minutes on first run)...");
    const { ensureImage } = await import("../docker/image.js");
    ensureImage(image);

    logger.info("Docker infrastructure ready");

    // 4. Start broker (with webhook registry if configured)
    const { startBroker } = await import("../broker/index.js");
    const brokerPort = globalConfig.broker?.port || 8080;
    broker = await startBroker({
      port: brokerPort,
      logger: mkLogger(projectPath, "broker"),
      webhookRegistry,
      webhookSecrets,
    });
  } else if (anyWebhooks) {
    // Start broker even without docker when webhooks are configured
    logger.info("Starting broker for webhook support (no docker)");
    const { startBroker } = await import("../broker/index.js");
    const brokerPort = globalConfig.broker?.port || 8080;
    broker = await startBroker({
      port: brokerPort,
      logger: mkLogger(projectPath, "broker"),
      webhookRegistry,
      webhookSecrets,
    });
  }

  // Create runners for each agent
  const runners: Record<string, RunnerLike> = {};

  if (dockerEnabled && broker) {
    const { ContainerAgentRunner } = await import("../agents/container-runner.js");
    const brokerPort = globalConfig.broker?.port || 8080;
    const brokerUrl = `http://host.docker.internal:${brokerPort}`;

    for (const agentConfig of agentConfigs) {
      statusTracker?.registerAgent(agentConfig.name);
      runners[agentConfig.name] = new ContainerAgentRunner(
        globalConfig,
        agentConfig,
        mkLogger(projectPath, agentConfig.name),
        broker.registerContainer,
        brokerUrl,
        projectPath,
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
      if (!agentConfig.webhooks?.filters?.length) continue;

      const runner = runners[agentConfig.name];

      for (const filter of agentConfig.webhooks.filters) {
        webhookRegistry.addBinding({
          agentName: agentConfig.name,
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
      logger.info(`Triggering ${agentConfig.name}: ${agentConfig.prompt}`);
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
  if (anyWebhooks && broker) {
    const brokerPort = globalConfig.broker?.port || 8080;
    const sources = new Set(
      agentConfigs.flatMap((a) => a.webhooks?.filters?.map((f) => f.source) || [])
    );
    for (const source of sources) {
      webhookUrls.push(`http://localhost:${brokerPort}/webhooks/${source}`);
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
    if (broker) {
      await broker.close();
      logger.info("Broker server stopped");
    }
    logger.info("All cron jobs stopped");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return { cronJobs, runners, broker, webhookRegistry, webhookUrls, statusTracker };
}
