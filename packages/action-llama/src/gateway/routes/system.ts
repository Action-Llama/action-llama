import type { Hono } from "hono";
import { registerShutdownRoute } from "../../execution/routes/shutdown.js";
import { registerControlRoutes, type ControlRoutesDeps } from "../../control/routes/control.js";
import type { ContainerRegistry } from "../../execution/container-registry.js";
import type { Logger } from "../../shared/logger.js";

/**
 * Register system-level routes: health check, shutdown, and control routes.
 */
export function registerSystemRoutes(
  app: Hono,
  opts: {
    containerRegistry: ContainerRegistry;
    killContainer?: (name: string) => Promise<void>;
    logger: Logger;
    controlDeps?: ControlRoutesDeps;
  },
): void {
  const { containerRegistry, killContainer, logger, controlDeps } = opts;

  // Health check
  app.get("/health", (c) => c.json({ status: "ok" }));

  // Container shutdown route
  const killFn = killContainer || (async () => {});
  registerShutdownRoute(app, containerRegistry, killFn, logger);

  // Control routes (for kill, pause, resume, trigger commands)
  if (controlDeps) {
    registerControlRoutes(app, controlDeps);
  }
}
