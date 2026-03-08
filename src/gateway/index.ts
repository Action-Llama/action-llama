import { Hono } from "hono";
import { serve } from "@hono/node-server";
import type { Server } from "http";
import { registerShutdownRoute } from "./routes/shutdown.js";
import { registerCredentialRoute } from "./routes/credentials.js";
import { registerLogRoute } from "./routes/logs.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";
import { registerDashboardRoutes } from "./routes/dashboard.js";
import type { ContainerRegistration } from "./types.js";
import type { WebhookRegistry } from "../webhooks/registry.js";
import type { Logger } from "../shared/logger.js";
import type { StatusTracker } from "../tui/status-tracker.js";

export type { ContainerRegistration } from "./types.js";

export interface GatewayOptions {
  port: number;
  logger: Logger;
  killContainer?: (name: string) => Promise<void>;
  webhookRegistry?: WebhookRegistry;
  webhookSecrets?: Record<string, Record<string, string>>;
  statusTracker?: StatusTracker;
  projectPath?: string;
  webUI?: boolean;
}

export interface GatewayServer {
  server: Server;
  registerContainer: (secret: string, reg: ContainerRegistration) => void;
  unregisterContainer: (secret: string) => void;
  close: () => Promise<void>;
}

export async function startGateway(opts: GatewayOptions): Promise<GatewayServer> {
  const { port, logger, killContainer, webhookRegistry, webhookSecrets, statusTracker, projectPath, webUI } = opts;
  const app = new Hono();
  const containerRegistry = new Map<string, ContainerRegistration>();

  // Health check
  app.get("/health", (c) => c.json({ status: "ok" }));

  // Container management routes
  const killFn = killContainer || (async () => {});
  registerShutdownRoute(app, containerRegistry, killFn, logger);
  registerCredentialRoute(app, containerRegistry, logger);
  registerLogRoute(app, containerRegistry, logger);

  // Webhook routes
  if (webhookRegistry) {
    registerWebhookRoutes(app, webhookRegistry, webhookSecrets || {}, logger, statusTracker);
  }

  // Dashboard routes
  if (webUI && statusTracker) {
    registerDashboardRoutes(app, statusTracker, projectPath);
  }

  const server = serve({
    fetch: app.fetch,
    port,
    hostname: "0.0.0.0",
  }) as Server;

  await new Promise<void>((resolve) => {
    server.on("listening", resolve);
  });

  logger.info({ port }, "Gateway server listening");

  const registerContainer = (secret: string, reg: ContainerRegistration) => {
    containerRegistry.set(secret, reg);
  };

  const unregisterContainer = (secret: string) => {
    containerRegistry.delete(secret);
  };

  const close = () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
    });

  return { server, registerContainer, unregisterContainer, close };
}
