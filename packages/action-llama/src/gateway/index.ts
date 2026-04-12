import { Hono } from "hono";
import { serve } from "@hono/node-server";
import type { Server } from "http";

// Re-export public API for external consumers (scheduler, tests)
export type { GatewayOptions, GatewayServer } from "./types.js";
export { resolveFrontendDist } from "./frontend.js";

import type { GatewayOptions, GatewayServer } from "./types.js";
import { createGatewayStores } from "./stores.js";
import { applyRequestLoggingMiddleware } from "./middleware/request-logging.js";
import { applyAuthMiddleware } from "./middleware/auth.js";
import { registerSystemRoutes } from "./routes/system.js";
import { registerGatewayWebhookRoutes } from "./routes/webhooks.js";
import { registerDashboardRoutes } from "./routes/dashboard.js";
import { resolveFrontendDist, registerSpaRoutes } from "./frontend.js";
import { registerSessionRoutes } from "../control/routes/sessions.js";
import { applyAttachUpgradeHandler } from "./attach-upgrade.js";

export async function startGateway(opts: GatewayOptions): Promise<GatewayServer> {
  const app = new Hono();

  // 1. Create and hydrate stores
  const { lockStore, callStore, sessionStore } = await createGatewayStores({
    lockTimeout: opts.lockTimeout,
    stateStore: opts.stateStore,
  });

  // 2. Apply middleware
  applyRequestLoggingMiddleware(app, opts.logger);

  // 3. Apply auth (if API key configured)
  if (opts.apiKey) {
    applyAuthMiddleware(app, opts.apiKey, sessionStore, opts.hostname);
  }

  // 4. Register system routes (health, control)
  registerSystemRoutes(app, {
    logger: opts.logger,
    controlDeps: opts.controlDeps,
  });

  // 4c. Session REST routes (GET /sessions, GET /sessions/:id)
  if (opts.statusTracker) {
    registerSessionRoutes(app, { statusTracker: opts.statusTracker });
  }

  // 4b. Lock status endpoint (consumed by CLI `al stat` and dashboard)
  app.get("/locks/status", (c) => {
    const locks = lockStore.list().map((entry) => ({
      resourceKey: entry.resourceKey,
      agentName: entry.holder.replace(/-[a-f0-9]+$/, ""),
      holder: entry.holder,
      heldSince: entry.heldSince,
    }));
    return c.json({ locks });
  });

  // 5. Register webhook routes
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

  // 6. Dashboard routes (requires webUI + statusTracker + apiKey)
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

  // 7. Frontend SPA serving (resolve once, serve everywhere)
  const frontendDist = opts.frontendDistPath ?? resolveFrontendDist();
  if (frontendDist && opts.webUI && opts.apiKey) {
    registerSpaRoutes(app, frontendDist, opts.logger);
  } else if (opts.webUI && opts.apiKey && !frontendDist) {
    opts.logger.warn("@action-llama/frontend not found — dashboard UI will not be served. API routes are still available.");
  }

  // 8. Start HTTP server
  const server = serve({
    fetch: app.fetch,
    port: opts.port,
    hostname: opts.hostname || "127.0.0.1",
  }) as Server;

  await new Promise<void>((resolve) => {
    server.on("listening", resolve);
  });

  // Wire WebSocket attach handler (must be after server is listening)
  if (opts.attachManager && opts.apiKey) {
    applyAttachUpgradeHandler(server, opts.attachManager, opts.apiKey, opts.logger);
  }

  opts.logger.info({ port: opts.port }, "Gateway server listening");

  const close = () =>
    new Promise<void>((resolve) => {
      lockStore.dispose();
      callStore.dispose();
      server.closeAllConnections();
      server.close(() => resolve());
    });

  return {
    server,
    lockStore,
    callStore,
    close,
  };
}
