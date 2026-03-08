import type { Hono } from "hono";
import type { ContainerRegistration } from "../types.js";
import type { Logger } from "../../shared/logger.js";

export function registerLogRoute(
  app: Hono,
  containerRegistry: Map<string, ContainerRegistration>,
  logger: Logger
): void {
  app.post("/logs/:secret", async (c) => {
    const secret = c.req.param("secret");
    const reg = containerRegistry.get(secret);
    if (!reg) {
      return c.json({ error: "invalid secret" }, 403);
    }

    if (!reg.onLogLine) {
      return c.json({ ok: true, forwarded: 0 });
    }

    let body: string;
    try {
      body = await c.req.text();
    } catch {
      return c.json({ error: "failed to read request body" }, 400);
    }

    let forwarded = 0;
    for (const line of body.split("\n")) {
      if (line.trim()) {
        reg.onLogLine(line);
        forwarded++;
      }
    }

    return c.json({ ok: true, forwarded });
  });
}
