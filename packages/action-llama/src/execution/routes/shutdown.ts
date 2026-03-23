import type { Hono } from "hono";
import type { ContainerRegistry } from "../container-registry.js";
import type { Logger } from "../../shared/logger.js";

export function registerShutdownRoute(
  app: Hono,
  containerRegistry: ContainerRegistry,
  killContainer: (name: string) => Promise<void>,
  logger: Logger
): void {
  app.post("/shutdown", async (c) => {
    let body: { secret?: string; reason?: string; details?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }

    const { secret, reason, details } = body;
    if (!secret || typeof secret !== "string") {
      return c.json({ error: "missing secret" }, 400);
    }

    const reg = containerRegistry.get(secret);
    if (!reg) {
      return c.json({ error: "invalid secret" }, 403);
    }

    logger.error(
      { container: reg.containerName, reason, details },
      "shutdown requested — killing container"
    );

    await killContainer(reg.containerName);

    await containerRegistry.unregister(secret);
    return c.json({ killed: true, container: reg.containerName });
  });
}
