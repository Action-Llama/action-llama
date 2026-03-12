import { Hono } from "hono";
import { serve } from "@hono/node-server";
import type { Server } from "http";
import { registerShutdownRoute } from "./routes/shutdown.js";
import { registerLockRoutes } from "./routes/locks.js";
import { registerCallRoutes, type CallDispatcher } from "./routes/calls.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";
import { registerDashboardRoutes } from "./routes/dashboard.js";
import { registerSignalRoutes, type SignalContext } from "./routes/signals.js";
import { LockStore } from "./lock-store.js";
import { CallStore } from "./call-store.js";
import type { ContainerRegistration } from "./types.js";
import type { WebhookRegistry } from "../webhooks/registry.js";
import type { Logger } from "../shared/logger.js";
import type { StatusTracker } from "../tui/status-tracker.js";
import type { ControlRoutesDeps } from "./routes/control.js";

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
}

export interface GatewayServer {
  server: Server;
  registerContainer: (secret: string, reg: ContainerRegistration) => void;
  unregisterContainer: (secret: string) => void;
  lockStore: LockStore;
  callStore: CallStore;
  setCallDispatcher: (dispatcher: CallDispatcher) => void;
  close: () => Promise<void>;
}

export async function startGateway(opts: GatewayOptions): Promise<GatewayServer> {
  const { port, logger, killContainer, webhookRegistry, webhookSecrets, statusTracker, projectPath, webUI, lockTimeout, signalContext } = opts;
  const app = new Hono();
  const containerRegistry = new Map<string, ContainerRegistration>();
  const lockStore = new LockStore(lockTimeout);
  const callStore = new CallStore();
  let callDispatcher: CallDispatcher | undefined;

  // Health check
  app.get("/health", (c) => c.json({ status: "ok" }));

  // Container management routes
  const killFn = killContainer || (async () => {});
  registerShutdownRoute(app, containerRegistry, killFn, logger);
  const isPublic = opts.hostname === "0.0.0.0";
  registerLockRoutes(app, containerRegistry, lockStore, logger, {
    skipStatusEndpoint: isPublic,
  });
  registerCallRoutes(app, containerRegistry, callStore, () => callDispatcher, logger);

  // Signal routes
  registerSignalRoutes(app, containerRegistry, logger, statusTracker, signalContext);

  // Webhook routes
  if (webhookRegistry) {
    registerWebhookRoutes(app, webhookRegistry, webhookSecrets || {}, logger, statusTracker);
  }

  // Dashboard routes
  if (webUI && statusTracker) {
    registerDashboardRoutes(app, statusTracker, projectPath);
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

  const registerContainer = (secret: string, reg: ContainerRegistration) => {
    containerRegistry.set(secret, reg);
  };

  const unregisterContainer = (secret: string) => {
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
    containerRegistry.delete(secret);
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

  return { server, registerContainer, unregisterContainer, lockStore, callStore, setCallDispatcher, close };
}
