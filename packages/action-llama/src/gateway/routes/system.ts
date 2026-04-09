import type { Hono } from "hono";
import { registerControlRoutes, type ControlRoutesDeps } from "../../control/routes/control.js";
import type { Logger } from "../../shared/logger.js";

/**
 * Register system-level routes: health check and control routes.
 */
export function registerSystemRoutes(
  app: Hono,
  opts: {
    logger: Logger;
    controlDeps?: ControlRoutesDeps;
  },
): void {
  // Health check
  app.get("/health", (c) => c.json({ status: "ok" }));

  // Control routes (for kill, pause, resume, trigger commands)
  if (opts.controlDeps) {
    registerControlRoutes(app, opts.controlDeps);
  }
}
