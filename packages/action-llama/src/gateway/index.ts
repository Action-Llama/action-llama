import { Hono } from "hono";
import { serve } from "@hono/node-server";
import type { Server } from "http";
import { createRequire } from "module";
import { dirname, resolve, extname } from "path";
import { fileURLToPath } from "url";
import { existsSync, readFileSync } from "fs";
import { registerShutdownRoute } from "../execution/routes/shutdown.js";
import { registerLockRoutes } from "../execution/routes/locks.js";
import { registerCallRoutes, type CallDispatcher } from "../execution/routes/calls.js";
import { registerWebhookRoutes } from "../events/routes/webhooks.js";
import { registerDashboardDataRoutes } from "../control/routes/dashboard.js";
import { registerAuthApiRoutes, registerDashboardApiRoutes } from "../control/routes/dashboard-api.js";
import { registerSignalRoutes, type SignalContext } from "../execution/routes/signals.js";
import { LockStore } from "../execution/lock-store.js";
import { CallStore } from "../execution/call-store.js";
import { ContainerRegistry } from "../execution/container-registry.js";
import { SessionStore } from "../control/session-store.js";
import type { ContainerRegistration } from "../execution/types.js";
import type { StateStore } from "../shared/state-store.js";
import type { WebhookRegistry } from "../webhooks/registry.js";
import type { Logger } from "../shared/logger.js";
import type { StatusTracker } from "../tui/status-tracker.js";
import type { WebhookSourceConfig } from "../shared/config.js";
import type { ControlRoutesDeps } from "../control/routes/control.js";
import { withSpan, getTelemetry } from "../telemetry/index.js";
import { SpanKind } from "@opentelemetry/api";
import { authMiddleware } from "../control/auth.js";
import type { SchedulerEventBus } from "../scheduler/events.js";
import type { StatsStore } from "../stats/store.js";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".map": "application/json",
};

/**
 * Attempt to resolve the @action-llama/frontend dist directory.
 * Checks (in order):
 *  1. Bundled frontend at dist/frontend/ (works after npm install)
 *  2. Workspace-linked @action-llama/frontend package (works in monorepo)
 */
export function resolveFrontendDist(): string | null {
  // Check bundled frontend (copied during build:assets)
  const bundled = resolve(dirname(fileURLToPath(import.meta.url)), "..", "frontend");
  if (existsSync(resolve(bundled, "index.html"))) {
    return bundled;
  }
  // Fall back to workspace-linked package
  try {
    const require = createRequire(import.meta.url);
    const pkgPath = require.resolve("@action-llama/frontend/package.json");
    const distDir = resolve(dirname(pkgPath), "dist");
    if (existsSync(resolve(distDir, "index.html"))) {
      return distDir;
    }
  } catch {
    // Package not available
  }
  return null;
}

export type { ContainerRegistration } from "../execution/types.js";

export interface GatewayOptions {
  port: number;
  hostname?: string;
  logger: Logger;
  killContainer?: (name: string) => Promise<void>;
  webhookRegistry?: WebhookRegistry;
  webhookSecrets?: Record<string, Record<string, string>>;
  webhookConfigs?: Record<string, WebhookSourceConfig>;
  statusTracker?: StatusTracker;
  projectPath?: string;
  webUI?: boolean;
  lockTimeout?: number;
  signalContext?: SignalContext;
  controlDeps?: ControlRoutesDeps;
  apiKey?: string;
  stateStore?: StateStore;
  skipStatusEndpoint?: boolean;
  /** Optional event bus for lifecycle instrumentation. */
  events?: SchedulerEventBus;
  /** Optional stats store for dashboard aggregate stats. */
  statsStore?: StatsStore;
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
    const sessionStore = stateStore ? new SessionStore(stateStore) : undefined;
    const auth = authMiddleware(opts.apiKey, sessionStore);
    app.use("/control/*", auth);
    app.use("/dashboard/api/*", auth);
    app.use("/locks/status", auth);
    app.use("/api/logs/*", auth);
    app.use("/api/stats/*", auth);
    app.use("/api/dashboard/*", auth);
    app.use("/api/auth/check", auth);
    app.use("/api/webhooks/*", auth);

    // JSON auth endpoints for the SPA (login is unprotected, check is protected)
    registerAuthApiRoutes(app, opts.apiKey, sessionStore, opts.hostname);
  }

  registerLockRoutes(app, containerRegistry, lockStore, logger, { skipStatusEndpoint: opts.skipStatusEndpoint, events: opts.events });
  registerCallRoutes(app, containerRegistry, callStore, () => callDispatcher, logger, opts.events);

  // Signal routes
  registerSignalRoutes(app, containerRegistry, logger, statusTracker, signalContext, opts.events);

  // Webhook routes
  if (webhookRegistry) {
    registerWebhookRoutes(app, webhookRegistry, webhookSecrets || {}, opts.webhookConfigs || {}, logger, statusTracker, opts.statsStore);
  }

  // Dashboard routes
  if (webUI && statusTracker) {
    if (!opts.apiKey) {
      logger.error("Dashboard UI requested but no API key configured. Dashboard will not be enabled for security.");
    } else {
      // Data routes (SSE stream, locks)
      registerDashboardDataRoutes(app, statusTracker);

      // JSON API routes for the React SPA
      registerDashboardApiRoutes(app, statusTracker, projectPath, opts.statsStore);

      // Serve the React SPA frontend
      const frontendDist = resolveFrontendDist();
      if (frontendDist) {
        logger.info({ path: frontendDist }, "Serving frontend from @action-llama/frontend");
        const indexHtml = readFileSync(resolve(frontendDist, "index.html"), "utf-8");

        // Serve Vite-built assets (JS, CSS, images) with long-term caching
        app.get("/assets/*", (c) => {
          const filePath = resolve(frontendDist, c.req.path.slice(1));
          if (!filePath.startsWith(frontendDist + "/")) return c.notFound();
          try {
            const content = readFileSync(filePath);
            const mime = MIME_TYPES[extname(filePath)] || "application/octet-stream";
            return new Response(content, {
              headers: { "Content-Type": mime, "Cache-Control": "public, max-age=31536000, immutable" },
            });
          } catch {
            return c.notFound();
          }
        });

        // SPA fallback: serve index.html for all frontend routes
        app.get("/login", (c) => c.html(indexHtml));
        app.get("/dashboard", (c) => c.html(indexHtml));
        app.get("/dashboard/*", (c) => c.html(indexHtml));
      } else {
        logger.warn("@action-llama/frontend not found — dashboard UI will not be served. API routes are still available.");
      }

      app.get("/", (c) => c.redirect("/dashboard"));
    }
  }

  // Log API routes — only register if auth is configured for security
  if (projectPath && opts.apiKey) {
    const { registerLogRoutes } = await import("../control/routes/logs.js");
    registerLogRoutes(app, projectPath);
  } else if (projectPath && !opts.apiKey) {
    logger.warn("Log API routes disabled — gateway API key required for security.");
  }

  // Stats API routes — only register if auth is configured for security
  if (opts.apiKey) {
    const { registerStatsRoutes } = await import("../control/routes/stats.js");
    registerStatsRoutes(app, opts.statsStore);
  }

  // Control routes (for kill, pause, resume commands)
  if (opts.controlDeps) {
    const { registerControlRoutes } = await import("../control/routes/control.js");
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
