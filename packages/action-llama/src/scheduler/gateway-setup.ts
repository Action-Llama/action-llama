/**
 * Gateway startup with late-binding controlDeps.
 *
 * The controlDeps closures read from `state.runnerPools`, `state.cronJobs`, and
 * `state.schedulerCtx` at invocation time — not construction time. This
 * preserves the late-binding pattern that allows the gateway to start before
 * runner pools and cron jobs are populated.
 */

import type { GlobalConfig, AgentConfig, WebhookSourceConfig } from "../shared/config.js";
import type { GatewayServer } from "../gateway/index.js";
import type { WebhookRegistry } from "../webhooks/registry.js";
import type { StatusTracker } from "../tui/status-tracker.js";
import type { StateStore } from "../shared/state-store.js";
import type { StatsStore } from "../stats/store.js";
import type { Logger } from "../shared/logger.js";
import { createLogger, createFileOnlyLogger } from "../shared/logger.js";
import { ensureGatewayApiKey } from "../control/api-key.js";
import type { SchedulerEventBus } from "./events.js";
import type { SchedulerState } from "./state.js";
import { runWithReruns } from "../execution/execution.js";
import type { ContainerRuntime } from "../docker/runtime.js";
import { ChatContainerLauncher } from "../chat/container-launcher.js";

export interface GatewaySetupResult {
  gateway: GatewayServer;
  gatewayPort: number;
  registerContainer: (secret: string, reg: any) => Promise<void>;
  unregisterContainer: (secret: string) => Promise<void>;
}

export async function setupGateway(opts: {
  projectPath: string;
  globalConfig: GlobalConfig;
  state: SchedulerState;
  agentConfigs: AgentConfig[];
  webhookRegistry?: WebhookRegistry;
  webhookSecrets: Record<string, Record<string, string>>;
  webhookConfigs?: Record<string, WebhookSourceConfig>;
  stateStore?: StateStore;
  statsStore?: StatsStore;
  events: SchedulerEventBus;
  telemetry?: any;
  mkLogger: typeof createLogger | typeof createFileOnlyLogger;
  statusTracker?: StatusTracker;
  webUI?: boolean;
  expose?: boolean;
  logger: Logger;
  /** Container runtime for launching chat containers. */
  runtime?: ContainerRuntime;
  /** Map of agent name → built image tag (populated after image builds). */
  agentImages?: Map<string, string>;
}): Promise<GatewaySetupResult> {
  const {
    projectPath, globalConfig, state, agentConfigs,
    webhookRegistry, webhookSecrets, webhookConfigs, stateStore, statsStore, events, telemetry,
    mkLogger, statusTracker, webUI, expose, logger,
  } = opts;

  // Ensure gateway API key exists (fallback generation if doctor wasn't run)
  const { key: gatewayApiKey, generated } = await ensureGatewayApiKey();
  if (generated) {
    logger.info("Generated gateway API key (run 'al doctor' to view it)");
    if (webUI || expose) {
      logger.warn("Security: API key authentication is now required for --web-ui and --expose modes");
    }
  }

  const { startGateway } = await import("../gateway/index.js");
  const gatewayPort = globalConfig.gateway?.port || 8080;
  const gatewayUrl = globalConfig.gateway?.url || `http://localhost:${gatewayPort}`;

  // Chat launcher — created lazily after gateway starts (needs chatSessionManager)
  let chatLauncher: ChatContainerLauncher | undefined;

  const launchChatContainer = async (agentName: string, sessionId: string) => {
    if (!chatLauncher) throw new Error("Chat container launcher not ready");
    await chatLauncher.launchChatContainer(agentName, sessionId);
  };

  const stopChatContainer = async (sessionId: string) => {
    if (!chatLauncher) return;
    await chatLauncher.stopChatContainer(sessionId);
  };

  const gateway = await startGateway({
    port: gatewayPort,
    hostname: expose ? "0.0.0.0" : "127.0.0.1",
    logger: mkLogger(projectPath, "gateway"),
    killContainer: undefined,
    webhookRegistry,
    webhookSecrets,
    webhookConfigs,
    statusTracker,
    projectPath,
    webUI,
    lockTimeout: globalConfig.resourceLockTimeout,
    apiKey: gatewayApiKey,
    stateStore,
    statsStore,
    events,
    skipStatusEndpoint: expose,
    maxChatSessions: globalConfig.gateway?.maxChatSessions,
    launchChatContainer: opts.runtime ? launchChatContainer : undefined,
    stopChatContainer: opts.runtime ? stopChatContainer : undefined,
    controlDeps: {
      statusTracker,
      logger,
      killInstance: async (instanceId: string) => {
        for (const pool of Object.values(state.runnerPools)) {
          if (pool.killInstance(instanceId)) return true;
        }
        return false;
      },
      killAgent: async (name: string) => {
        const pool = state.runnerPools[name];
        if (!pool) return null;
        const killed = pool.killAll();
        logger.info({ agent: name, killed }, "kill all instances requested via control API");
        return { killed };
      },
      pauseScheduler: async () => {
        for (const job of state.cronJobs) {
          job.pause();
        }
        statusTracker?.setPaused(true);
        logger.info("Scheduler paused via control API");
      },
      resumeScheduler: async () => {
        for (const job of state.cronJobs) {
          job.resume();
        }
        statusTracker?.setPaused(false);
        logger.info("Scheduler resumed via control API");
      },
      triggerAgent: async (name: string, prompt?: string): Promise<true | string> => {
        if (statusTracker?.isPaused()) return "Scheduler is paused";
        const pool = state.runnerPools[name];
        if (!pool) return `Agent "${name}" not found`;
        const runner = pool.getAvailableRunner();
        if (!runner) return `Agent "${name}" has no available runners (all busy)`;
        const config = agentConfigs.find((a) => a.name === name);
        if (!config) return `Agent "${name}" config not found`;
        if (!state.schedulerCtx) return "Scheduler is not ready";
        logger.info({ agent: name, hasPrompt: !!prompt }, "manual trigger via control API");
        runWithReruns(runner, config, 0, state.schedulerCtx, prompt).catch((err) => {
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
        if (state.schedulerCtx) {
          state.schedulerCtx.shuttingDown = true;
          state.schedulerCtx.workQueue.clearAll();
          state.schedulerCtx.workQueue.close();
        }
        for (const job of state.cronJobs) job.stop();
        await gateway.close();
        if (stateStore) await stateStore.close();
        if (telemetry) {
          try { await telemetry.shutdown(); } catch {}
        }
        process.exit(0);
      },
      updateProjectScale: async (scale: number) => {
        const { updateProjectScale } = await import("../shared/config.js");
        updateProjectScale(projectPath, scale);
        logger.info({ scale }, "project scale updated");
        return true;
      },
      updateAgentScale: async (name: string, scale: number) => {
        const { updateAgentRuntimeOverride } = await import("../shared/environment.js");
        const config = agentConfigs.find((a) => a.name === name);
        if (!config) return false;
        updateAgentRuntimeOverride(projectPath, name, { scale });
        if (statusTracker) {
          statusTracker.updateAgentScale(name, scale);
        }
        logger.info({ agent: name, scale }, "agent scale updated via .env.toml");
        return true;
      },
      workQueue: {
        size: (agentName: string) => state.schedulerCtx?.workQueue.size(agentName) ?? 0,
      },
    },
  });

  // Wire up chat container launcher if runtime is available
  if (opts.runtime && gateway.chatSessionManager) {
    chatLauncher = new ChatContainerLauncher({
      runtime: opts.runtime,
      globalConfig,
      agentConfigs,
      gatewayUrl,
      logger,
      sessionManager: gateway.chatSessionManager,
      images: opts.agentImages || new Map(),
    });

    // Wire the stopContainer callback on the WS state for idle cleanup
    if (gateway.chatWebSocketState) {
      gateway.chatWebSocketState.stopContainer = stopChatContainer;
    }
  }

  logger.info({ port: gatewayPort }, "Gateway started early to show build progress");

  const registerContainer = gateway.registerContainer;
  const unregisterContainer = gateway.unregisterContainer;

  return { gateway, gatewayPort, registerContainer, unregisterContainer };
}
