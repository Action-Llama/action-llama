import type { Hono } from "hono";
import type { ContainerRegistration } from "../types.js";
import type { LockStore } from "../lock-store.js";
import type { Logger } from "../../shared/logger.js";

export function registerLockRoutes(
  app: Hono,
  containerRegistry: Map<string, ContainerRegistration>,
  lockStore: LockStore,
  logger: Logger
): void {
  app.post("/locks/acquire", async (c) => {
    let body: { secret?: string; resource?: string; key?: string; ttl?: number };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }

    const { secret, resource, key, ttl } = body;
    if (!secret || typeof secret !== "string") {
      return c.json({ error: "missing secret" }, 400);
    }
    if (!resource || typeof resource !== "string") {
      return c.json({ error: "missing resource" }, 400);
    }
    if (!key || typeof key !== "string") {
      return c.json({ error: "missing key" }, 400);
    }

    const reg = containerRegistry.get(secret);
    if (!reg) {
      return c.json({ error: "invalid secret" }, 403);
    }

    const result = lockStore.acquire(resource, key, reg.agentName, ttl);

    if (result.ok) {
      logger.debug({ agent: reg.agentName, resource, key }, "lock acquired");
      return c.json({ ok: true, resource, key });
    }

    // Distinguish "already holding another lock" from "someone else holds this lock"
    if (result.reason) {
      logger.debug({ agent: reg.agentName, resource, key }, "lock rejected: " + result.reason);
      return c.json({ ok: false, reason: result.reason }, 409);
    }

    logger.debug(
      { agent: reg.agentName, resource, key, holder: result.holder },
      "lock conflict"
    );
    return c.json(
      { ok: false, holder: result.holder, heldSince: result.heldSince },
      409
    );
  });

  app.post("/locks/release", async (c) => {
    let body: { secret?: string; resource?: string; key?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }

    const { secret, resource, key } = body;
    if (!secret || typeof secret !== "string") {
      return c.json({ error: "missing secret" }, 400);
    }
    if (!resource || typeof resource !== "string") {
      return c.json({ error: "missing resource" }, 400);
    }
    if (!key || typeof key !== "string") {
      return c.json({ error: "missing key" }, 400);
    }

    const reg = containerRegistry.get(secret);
    if (!reg) {
      return c.json({ error: "invalid secret" }, 403);
    }

    const result = lockStore.release(resource, key, reg.agentName);

    if (result.ok) {
      logger.debug({ agent: reg.agentName, resource, key }, "lock released");
      return c.json({ ok: true });
    }

    const status = result.reason === "lock not found" ? 404 : 409;
    return c.json({ ok: false, reason: result.reason }, status);
  });

  app.post("/locks/heartbeat", async (c) => {
    let body: { secret?: string; resource?: string; key?: string; ttl?: number };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }

    const { secret, resource, key, ttl } = body;
    if (!secret || typeof secret !== "string") {
      return c.json({ error: "missing secret" }, 400);
    }
    if (!resource || typeof resource !== "string") {
      return c.json({ error: "missing resource" }, 400);
    }
    if (!key || typeof key !== "string") {
      return c.json({ error: "missing key" }, 400);
    }

    const reg = containerRegistry.get(secret);
    if (!reg) {
      return c.json({ error: "invalid secret" }, 403);
    }

    const result = lockStore.heartbeat(resource, key, reg.agentName, ttl);

    if (result.ok) {
      logger.debug({ agent: reg.agentName, resource, key }, "lock heartbeat");
      return c.json({ ok: true, expiresAt: result.expiresAt });
    }

    const status = result.reason === "lock not found" ? 404 : 409;
    return c.json({ ok: false, reason: result.reason }, status);
  });

  app.get("/locks/list", (c) => {
    const secret = c.req.query("secret");
    if (!secret) {
      return c.json({ error: "missing secret" }, 400);
    }

    const reg = containerRegistry.get(secret);
    if (!reg) {
      return c.json({ error: "invalid secret" }, 403);
    }

    return c.json(lockStore.list());
  });
}
