import type { Hono } from "hono";
import type { Logger } from "../../shared/logger.js";

/**
 * Apply request/response logging middleware to the Hono app.
 * Skips /health to avoid noise; logs method, path, status, and duration.
 * Uses warn for 4xx+ responses, debug otherwise.
 */
export function applyRequestLoggingMiddleware(app: Hono, logger: Logger): void {
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
}
