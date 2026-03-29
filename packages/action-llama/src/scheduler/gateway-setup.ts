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
import { ensureGatewayApiKey, loadGatewayApiKey } from "../control/api-key.js";
import type { SchedulerEventBus } from "./events.js";
import type { SchedulerState } from "./state.js";
import { runWithReruns } from "../execution/execution.js";
import { randomBytes } from "node:crypto";
import type { Runtime } from "../docker/runtime.js";
import { ChatContainerLauncher } from "../chat/container-launcher.js";

export interface GatewaySetupResult {
  gateway: GatewayServer;
  gatewayPort: number;
  registerContainer: (secret: string, reg: any) => Promise<void>;
  unregisterContainer: (secret: string) => Promise<void>;
  /** Wire up the chat container launcher after runtime + images are available. */
  setChatRuntime: (runtime: Runtime, agentImages: Record<string, string>) => void;
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
    if (!chatLauncher) throw new Error("Chat is not available yet — agent images are still building");
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
    // Pass a provider so the key is re-read from disk on every auth check,
    // enabling hot-reload of rotated credentials without restarting the scheduler.
    apiKey: loadGatewayApiKey,
    stateStore,
    statsStore,
    events,
    skipStatusEndpoint: expose,
    maxChatSessions: globalConfig.gateway?.maxChatSessions,
    launchChatContainer,
    stopChatContainer,
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
      triggerAgent: async (name: string, prompt?: string): Promise<{ instanceId: string } | string> => {
        if (statusTracker?.isPaused()) return "Scheduler is paused";
        const pool = state.runnerPools[name];
        if (!pool) return `Agent "${name}" not found`;
        const runner = pool.getAvailableRunner();
        if (!runner) return `Agent "${name}" has no available runners (all busy)`;
        const config = agentConfigs.find((a) => a.name === name);
        if (!config) return `Agent "${name}" config not found`;
        if (!state.schedulerCtx) return "Scheduler is not ready";
        const instanceId = `${name}-${randomBytes(4).toString("hex")}`;
        logger.info({ agent: name, hasPrompt: !!prompt, instanceId }, "manual trigger via control API");
        runWithReruns(runner, config, 0, state.schedulerCtx, prompt, instanceId).catch((err) => {
          logger.error({ err, agent: name }, "manual trigger run failed");
        });
        return { instanceId };
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
        const { updateAgentRuntimeField } = await import("../shared/config.js");
        const config = agentConfigs.find((a) => a.name === name);
        if (!config) return false;
        updateAgentRuntimeField(projectPath, name, "scale", scale);
        if (statusTracker) {
          statusTracker.updateAgentScale(name, scale);
        }
        logger.info({ agent: name, scale }, "agent scale updated via config.toml");
        return true;
      },
      workQueue: {
        size: (agentName: string) => state.schedulerCtx?.workQueue.size(agentName) ?? 0,
      },
    },
  });

  // Wire the stopContainer callback on the WS state for idle cleanup
  if (gateway.chatWebSocketState) {
    gateway.chatWebSocketState.stopContainer = stopChatContainer;
  }

  logger.info({ port: gatewayPort }, "Gateway started early to show build progress");

  const registerContainer = gateway.registerContainer;
  const unregisterContainer = gateway.unregisterContainer;

  const setChatRuntime = (runtime: Runtime, agentImages: Record<string, string>) => {
    if (!gateway.chatSessionManager) return;
    // Wrap the Record in a Map that delegates to the live reference so
    // hot-reloaded images are always visible to the chat launcher.
    const liveImages: Map<string, string> = {
      get: (key: string) => agentImages[key],
      has: (key: string) => key in agentImages,
    } as Map<string, string>;
    chatLauncher = new ChatContainerLauncher({
      runtime,
      globalConfig,
      agentConfigs,
      gatewayUrl,
      logger,
      sessionManager: gateway.chatSessionManager,
      images: liveImages,
      registerContainer,
      unregisterContainer,
    });
  };

  return { gateway, gatewayPort, registerContainer, unregisterContainer, setChatRuntime };
}
