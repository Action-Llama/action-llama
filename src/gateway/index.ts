import { createServer } from "http";
import type { Server } from "http";
import { Router, sendJson, sendError } from "./router.js";
import { registerShutdownRoute } from "./routes/shutdown.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";
import type { WebhookRegistry } from "../webhooks/registry.js";
import type { Logger } from "../shared/logger.js";

export interface GatewayOptions {
  port: number;
  logger: Logger;
  webhookRegistry?: WebhookRegistry;
  webhookSecrets?: Record<string, string | undefined>;
}

export interface GatewayServer {
  server: Server;
  registerContainer: (secret: string, containerName: string) => void;
  close: () => Promise<void>;
}

export async function startGateway(opts: GatewayOptions): Promise<GatewayServer> {
  const { port, logger, webhookRegistry, webhookSecrets } = opts;
  const router = new Router();
  const containerSecrets = new Map<string, string>();

  // Health check
  router.get("/health", async (_req, res) => {
    sendJson(res, 200, { status: "ok" });
  });

  // Shutdown endpoint
  registerShutdownRoute(router, containerSecrets, logger);

  // Webhook routes
  if (webhookRegistry) {
    registerWebhookRoutes(router, webhookRegistry, webhookSecrets || {}, logger);
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

  const registerContainer = (secret: string, containerName: string) => {
    containerSecrets.set(secret, containerName);
  };

  const close = () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
    });

  return { server, registerContainer, close };
}
