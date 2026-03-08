import type { Hono } from "hono";
import type { ContainerRegistration } from "../types.js";
import type { Logger } from "../../shared/logger.js";

export function registerCredentialRoute(
  app: Hono,
  containerRegistry: Map<string, ContainerRegistration>,
  logger: Logger
): void {
  app.get("/credentials/:secret", (c) => {
    const secret = c.req.param("secret");
    const reg = containerRegistry.get(secret);
    if (!reg) {
      return c.json({ error: "invalid secret" }, 403);
    }

    if (!reg.credentials) {
      return c.json({ error: "no credentials registered for this container" }, 404);
    }

    logger.debug({ container: reg.containerName }, "serving credentials");
    return c.json(reg.credentials);
  });
}
