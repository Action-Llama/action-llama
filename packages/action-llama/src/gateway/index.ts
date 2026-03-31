import { Hono } from "hono";
import { serve } from "@hono/node-server";
import type { Server } from "http";

// Re-export public API for external consumers (scheduler, tests)
export type { GatewayOptions, GatewayServer, ContainerRegistration } from "./types.js";
export { resolveFrontendDist } from "./frontend.js";

import type { GatewayOptions, GatewayServer } from "./types.js";
import { createGatewayStores } from "./stores.js";
import { applyTelemetryMiddleware } from "./middleware/telemetry.js";
import { applyRequestLoggingMiddleware } from "./middleware/request-logging.js";
import { applyAuthMiddleware } from "./middleware/auth.js";
import { registerSystemRoutes } from "./routes/system.js";
import { registerExecutionRoutes } from "./routes/execution.js";
import { registerGatewayWebhookRoutes } from "./routes/webhooks.js";
import { registerDashboardRoutes } from "./routes/dashboard.js";
import { registerChatRoutes, attachChatWebSocketToServer } from "./routes/chat.js";
import { resolveFrontendDist, registerSpaRoutes } from "./frontend.js";
import type { CallDispatcher } from "../execution/routes/calls.js";
import type { ContainerRegistration } from "../execution/types.js";
import type { ChatWebSocketState } from "../chat/ws-handler.js";
import type { ChatSessionManager } from "../chat/session-manager.js";

export async function startGateway(opts: GatewayOptions): Promise<GatewayServer> {
  const app = new Hono();
  let callDispatcher: CallDispatcher | undefined;

  // 1. Create and hydrate stores
  const { containerRegistry, lockStore, callStore, sessionStore } = await createGatewayStores({
    lockTimeout: opts.lockTimeout,
    stateStore: opts.stateStore,
  });

  // 2. Apply middleware (order matters: telemetry → logging)
  applyTelemetryMiddleware(app);
  applyRequestLoggingMiddleware(app, opts.logger);

  // 3. Apply auth (if API key configured)
  if (opts.apiKey) {
    applyAuthMiddleware(app, opts.apiKey, sessionStore, opts.hostname);
  }

  // 4. Register system routes (health, shutdown, control)
  registerSystemRoutes(app, {
    containerRegistry,
    killContainer: opts.killContainer,
    logger: opts.logger,
    controlDeps: opts.controlDeps,
  });

  // 5. Register execution routes (locks, calls, signals)
  registerExecutionRoutes(app, {
    containerRegistry,
    lockStore,
    callStore,
    callDispatcherProvider: () => callDispatcher,
    logger: opts.logger,
    statusTracker: opts.statusTracker,
    signalContext: opts.signalContext,
    skipStatusEndpoint: opts.skipStatusEndpoint,
    events: opts.events,
  });

  // 6. Register webhook routes
  if (opts.webhookRegistry) {
    registerGatewayWebhookRoutes(app, {
      webhookRegistry: opts.webhookRegistry,
      webhookSecrets: opts.webhookSecrets || {},
      webhookConfigs: opts.webhookConfigs || {},
      logger: opts.logger,
      statusTracker: opts.statusTracker,
      statsStore: opts.statsStore,
    });
  }

  // 7. Dashboard routes (requires webUI + statusTracker + apiKey)
  if (opts.webUI && opts.statusTracker) {
    if (!opts.apiKey) {
      opts.logger.error("Dashboard UI requested but no API key configured. Dashboard will not be enabled for security.");
    } else {
      await registerDashboardRoutes(app, {
        statusTracker: opts.statusTracker,
        projectPath: opts.projectPath,
        apiKey: opts.apiKey,
        statsStore: opts.statsStore,
        logger: opts.logger,
        controlDeps: opts.controlDeps,
      });
    }
  } else if (opts.projectPath && opts.apiKey) {
    // Log + stats routes without dashboard UI (edge case: apiKey but no webUI)
    const { registerLogRoutes } = await import("../control/routes/logs.js");
    registerLogRoutes(app, opts.projectPath);
    const { registerStatsRoutes } = await import("../control/routes/stats.js");
    registerStatsRoutes(app, opts.statsStore, opts.statusTracker);
  } else if (opts.projectPath && !opts.apiKey) {
    opts.logger.warn("Log API routes disabled — gateway API key required for security.");
  }

  // 8. Chat routes (requires webUI + apiKey)
  let chatSessionManager: ChatSessionManager | undefined;
  if (opts.webUI && opts.apiKey) {
    const chatSetup = registerChatRoutes(app, {
      maxChatSessions: opts.maxChatSessions,
      launchChatContainer: opts.launchChatContainer,
      stopChatContainer: opts.stopChatContainer,
      logger: opts.logger,
    });
    chatSessionManager = chatSetup.chatSessionManager;
  }

  // 9. Frontend SPA serving (resolve once, serve everywhere)
  const frontendDist = opts.frontendDistPath ?? resolveFrontendDist();
  if (frontendDist && opts.webUI && opts.apiKey) {
    registerSpaRoutes(app, frontendDist, opts.logger);
  } else if (opts.webUI && opts.apiKey && !frontendDist) {
    opts.logger.warn("@action-llama/frontend not found — dashboard UI will not be served. API routes are still available.");
  }

  // 10. Start HTTP server
  const server = serve({
    fetch: app.fetch,
    port: opts.port,
    hostname: opts.hostname || "127.0.0.1",
  }) as Server;

  await new Promise<void>((resolve) => {
    server.on("listening", resolve);
  });

  // 11. Attach chat WebSocket to the raw HTTP server (needs live server)
  let chatWsState: ChatWebSocketState | undefined;
  if (chatSessionManager && opts.apiKey) {
    chatWsState = attachChatWebSocketToServer(server, {
      chatSessionManager,
      apiKey: opts.apiKey,
      sessionStore,
      logger: opts.logger,
    });
  }

  opts.logger.info({ port: opts.port }, "Gateway server listening");

  // Closures over local state for container/call management
  const registerContainer = async (secret: string, reg: ContainerRegistration) => {
    await containerRegistry.register(secret, reg);
  };

  const unregisterContainer = async (secret: string) => {
    const reg = containerRegistry.get(secret);
    if (reg) {
      const released = lockStore.releaseAll(reg.instanceId);
      if (released > 0) {
        opts.logger.info(
          { agent: reg.agentName, instance: reg.instanceId, released },
          "released locks on container cleanup",
        );
      }
      const failedCalls = callStore.failAllByCaller(reg.instanceId);
      if (failedCalls > 0) {
        opts.logger.info(
          { agent: reg.agentName, instance: reg.instanceId, failedCalls },
          "failed pending calls on container cleanup",
        );
      }
    }
    await containerRegistry.unregister(secret);
  };

  const setCallDispatcher = (dispatcher: CallDispatcher) => {
    callDispatcher = dispatcher;
  };

  const close = () =>
    new Promise<void>((resolve) => {
      if (chatWsState) {
        clearInterval(chatWsState.cleanupInterval);
      }
      lockStore.dispose();
      callStore.dispose();
      server.close(() => resolve());
    });

  return {
    server,
    containerRegistry,
    registerContainer,
    unregisterContainer,
    lockStore,
    callStore,
    setCallDispatcher,
    close,
    chatSessionManager,
    chatWebSocketState: chatWsState,
  };
}
