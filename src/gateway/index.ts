import { Hono } from "hono";
import { serve } from "@hono/node-server";
import type { Server } from "http";
import { registerShutdownRoute } from "./routes/shutdown.js";
import { registerLockRoutes } from "./routes/locks.js";
import { registerCallRoutes, type CallDispatcher } from "./routes/calls.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";
import { registerDashboardRoutes, registerLoginRoutes } from "./routes/dashboard.js";
import { registerSignalRoutes, type SignalContext } from "./routes/signals.js";
import { LockStore } from "./lock-store.js";
import { CallStore } from "./call-store.js";
import { ContainerRegistry } from "./container-registry.js";
import type { ContainerRegistration } from "./types.js";
import type { StateStore } from "../shared/state-store.js";
import type { WebhookRegistry } from "../webhooks/registry.js";
import type { Logger } from "../shared/logger.js";
import type { StatusTracker } from "../tui/status-tracker.js";
import type { ControlRoutesDeps } from "./routes/control.js";
import { withSpan, getTelemetry } from "../telemetry/index.js";
import { SpanKind } from "@opentelemetry/api";
import { authMiddleware } from "./auth.js";
import type { SchedulerEventBus } from "../scheduler/events.js";

export type { ContainerRegistration } from "./types.js";

export interface GatewayOptions {
  port: number;
  hostname?: string;
  logger: Logger;
  killContainer?: (name: string) => Promise<void>;
  webhookRegistry?: WebhookRegistry;
  webhookSecrets?: Record<string, Record<string, string>>;
  statusTracker?: StatusTracker;
  projectPath?: string;
  webUI?: boolean;
  lockTimeout?: number;
  signalContext?: SignalContext;
  controlDeps?: ControlRoutesDeps;
  apiKey?: string;
  stateStore?: StateStore;
  /** Optional event bus for lifecycle instrumentation. */
  events?: SchedulerEventBus;
}

export interface GatewayServer {
  server: Server;
  containerRegistry: ContainerRegistry;
  registerContainer: (secret: string, reg: ContainerRegistration) => Promise<void>;
  unregisterContainer: (secret: string) => Promise<void>;
  lockStore: LockStore;
  callStore: CallStore;
  setCallDispatcher: (dispatcher: CallDispatcher) => void;
  close: () => Promise<void>;
}

export async function startGateway(opts: GatewayOptions): Promise<GatewayServer> {
  const { port, logger, killContainer, webhookRegistry, webhookSecrets, statusTracker, projectPath, webUI, lockTimeout, signalContext, stateStore } = opts;
  const app = new Hono();

  // Create stores backed by the persistent StateStore (if provided).
  const containerRegistry = new ContainerRegistry(stateStore);
  const lockStore = new LockStore(lockTimeout, undefined, stateStore);
  const callStore = new CallStore(undefined, stateStore);
  let callDispatcher: CallDispatcher | undefined;

  // Hydrate in-memory caches from the persistent store.
  await containerRegistry.init();
  await lockStore.init();
  await callStore.init();

  // Add telemetry middleware for HTTP requests
  const telemetry = getTelemetry();
  if (telemetry) {
    app.use("*", async (c, next) => {
      const spanName = `gateway.${c.req.method.toLowerCase()}_${c.req.path.replace(/\/+/g, "_").replace(/^_|_$/g, "") || "root"}`;

      await withSpan(
        spanName,
        async (span) => {
          span.setAttributes({
            "http.method": c.req.method,
            "http.url": c.req.url,
            "http.path": c.req.path,
            "http.user_agent": c.req.header("user-agent") || "",
            "gateway.component": "http_server",
          });

          await next();

          span.setAttributes({
            "http.status_code": c.res.status,
          });
        },
        {},
        SpanKind.SERVER
      );
    });
  }

  // Request/response logging middleware for command routes.
  // Skips /health to avoid noise; logs method, path, status, and duration.
  app.use("*", async (c, next) => {
    if (c.req.path === "/health") {
      await next();
      return;
    }
    const start = Date.now();
    logger.debug({ method: c.req.method, path: c.req.path }, "request received");
    await next();
    const duration = Date.now() - start;
    const status = c.res.status;
    const logData = { method: c.req.method, path: c.req.path, status, duration };
    if (status >= 400) {
      logger.warn(logData, "request completed with error");
    } else {
      logger.debug(logData, "request completed");
    }
  });

  // Health check
  app.get("/health", (c) => c.json({ status: "ok" }));

  // Container management routes
  const killFn = killContainer || (async () => {});
  registerShutdownRoute(app, containerRegistry, killFn, logger);
  // Apply auth middleware to protected routes when an API key is configured
  if (opts.apiKey) {
    const auth = authMiddleware(opts.apiKey);
    app.use("/control/*", auth);
    app.use("/dashboard/*", auth);
    app.use("/dashboard", auth);
    app.use("/locks/status", auth);
    app.use("/api/logs/*", auth);

    // Always register login/logout so the auth redirect has a target
    registerLoginRoutes(app, opts.apiKey);
  }

  registerLockRoutes(app, containerRegistry, lockStore, logger, { events: opts.events });
  registerCallRoutes(app, containerRegistry, callStore, () => callDispatcher, logger, opts.events);

  // Signal routes
  registerSignalRoutes(app, containerRegistry, logger, statusTracker, signalContext, opts.events);

  // Webhook routes
  if (webhookRegistry) {
    registerWebhookRoutes(app, webhookRegistry, webhookSecrets || {}, logger, statusTracker);
  }

  // Dashboard routes (login/logout are unprotected; dashboard pages are behind authMiddleware above)
  if (webUI && statusTracker) {
    registerDashboardRoutes(app, statusTracker, projectPath, opts.apiKey);
    app.get("/", (c) => c.redirect("/dashboard"));
  }

  // Log API routes — available regardless of webUI flag (CLI needs them)
  if (projectPath) {
    const { registerLogRoutes } = await import("./routes/logs.js");
    registerLogRoutes(app, projectPath);
    
    // Warn if log endpoints are exposed without authentication
    if (!opts.apiKey) {
      logger.warn("Log endpoints are exposed without authentication. Consider setting up a gateway API key for security.");
    }
  }

  // Control routes (for kill, pause, resume commands)
  if (opts.controlDeps) {
    const { registerControlRoutes } = await import("./routes/control.js");
    registerControlRoutes(app, opts.controlDeps);
  }

  const server = serve({
    fetch: app.fetch,
    port,
    hostname: opts.hostname || "127.0.0.1",
  }) as Server;

  await new Promise<void>((resolve) => {
    server.on("listening", resolve);
  });

  logger.info({ port }, "Gateway server listening");

  const registerContainer = async (secret: string, reg: ContainerRegistration) => {
    await containerRegistry.register(secret, reg);
  };

  const unregisterContainer = async (secret: string) => {
    const reg = containerRegistry.get(secret);
    if (reg) {
      const released = lockStore.releaseAll(reg.instanceId);
      if (released > 0) {
        logger.info({ agent: reg.agentName, instance: reg.instanceId, released }, "released locks on container cleanup");
      }
      const failedCalls = callStore.failAllByCaller(reg.instanceId);
      if (failedCalls > 0) {
        logger.info({ agent: reg.agentName, instance: reg.instanceId, failedCalls }, "failed pending calls on container cleanup");
      }
    }
    await containerRegistry.unregister(secret);
  };

  const setCallDispatcher = (dispatcher: CallDispatcher) => {
    callDispatcher = dispatcher;
  };

  const close = () =>
    new Promise<void>((resolve) => {
      lockStore.dispose();
      callStore.dispose();
      server.close(() => resolve());
    });

  return { server, containerRegistry, registerContainer, unregisterContainer, lockStore, callStore, setCallDispatcher, close };
}
