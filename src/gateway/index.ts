import { createServer } from "http";
import type { Server } from "http";
import { Router, sendJson, sendError } from "./router.js";
import { registerShutdownRoute } from "./routes/shutdown.js";
import { registerCredentialRoute } from "./routes/credentials.js";
import { registerLogRoute } from "./routes/logs.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";
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
}

export interface GatewayServer {
  server: Server;
  registerContainer: (secret: string, reg: ContainerRegistration) => void;
  unregisterContainer: (secret: string) => void;
  close: () => Promise<void>;
}

export async function startGateway(opts: GatewayOptions): Promise<GatewayServer> {
  const { port, logger, killContainer, webhookRegistry, webhookSecrets, statusTracker } = opts;
  const router = new Router();
  const containerRegistry = new Map<string, ContainerRegistration>();

  // Health check
  router.get("/health", async (_req, res) => {
    sendJson(res, 200, { status: "ok" });
  });

  // Container management routes
  const killFn = killContainer || (async () => {});
  registerShutdownRoute(router, containerRegistry, killFn, logger);
  registerCredentialRoute(router, containerRegistry, logger);
  registerLogRoute(router, containerRegistry, logger);

  // Webhook routes
  if (webhookRegistry) {
    registerWebhookRoutes(router, webhookRegistry, webhookSecrets || {}, logger, statusTracker);
  }

  const server = createServer(async (req, res) => {
    const startTime = Date.now();
    try {
      logger.info({ method: req.method, url: req.url }, "gateway req");

      const handled = await router.handle(req, res);
      if (!handled) {
        sendError(res, 404, "Not found");
      }
    } catch (err: any) {
      logger.error({ err, url: req.url }, "gateway request error");
      if (!res.headersSent) {
        sendError(res, 500, "Internal server error");
      }
    } finally {
      const elapsed = Date.now() - startTime;
      logger.info(
        { method: req.method, url: req.url, status: res.statusCode, ms: elapsed },
        "gateway res"
      );
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(port, "0.0.0.0", () => {
      logger.info({ port }, "Gateway server listening");
      resolve();
    });
  });

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
