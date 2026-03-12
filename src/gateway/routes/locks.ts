import type { Hono } from "hono";
import type { ContainerRegistration } from "../types.js";
import type { LockStore } from "../lock-store.js";
import type { Logger } from "../../shared/logger.js";

export function registerLockRoutes(
  app: Hono,
  containerRegistry: Map<string, ContainerRegistration>,
  lockStore: LockStore,
  logger: Logger,
  opts?: { skipStatusEndpoint?: boolean }
): void {
  app.post("/locks/acquire", async (c) => {
    let body: { secret?: string; resourceKey?: string; ttl?: number };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }

    const { secret, resourceKey, ttl } = body;
    if (!secret || typeof secret !== "string") {
      return c.json({ error: "missing secret" }, 400);
    }
    if (!resourceKey || typeof resourceKey !== "string") {
      return c.json({ error: "missing resourceKey" }, 400);
    }

    const reg = containerRegistry.get(secret);
    if (!reg) {
      return c.json({ error: "invalid secret" }, 403);
    }

    const result = lockStore.acquire(resourceKey, reg.instanceId, ttl);

    if (result.ok) {
      logger.debug({ agent: reg.agentName, resourceKey }, "lock acquired");
      return c.json({ ok: true, resourceKey });
    }

    // Distinguish "already holding another lock" from "someone else holds this lock"
    if (result.reason) {
      logger.debug({ agent: reg.agentName, resourceKey }, "lock rejected: " + result.reason);
      return c.json({ ok: false, reason: result.reason }, 409);
    }

    logger.debug(
      { agent: reg.agentName, resourceKey, holder: result.holder },
      "lock conflict"
    );
    return c.json(
      { ok: false, holder: result.holder, heldSince: result.heldSince },
      409
    );
  });

  app.post("/locks/release", async (c) => {
    let body: { secret?: string; resourceKey?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }

    const { secret, resourceKey } = body;
    if (!secret || typeof secret !== "string") {
      return c.json({ error: "missing secret" }, 400);
    }
    if (!resourceKey || typeof resourceKey !== "string") {
      return c.json({ error: "missing resourceKey" }, 400);
    }

    const reg = containerRegistry.get(secret);
    if (!reg) {
      return c.json({ error: "invalid secret" }, 403);
    }

    const result = lockStore.release(resourceKey, reg.instanceId);

    if (result.ok) {
      logger.debug({ agent: reg.agentName, resourceKey }, "lock released");
      return c.json({ ok: true });
    }

    const status = result.reason === "lock not found" ? 404 : 409;
    return c.json({ ok: false, reason: result.reason }, status);
  });

  app.post("/locks/heartbeat", async (c) => {
    let body: { secret?: string; resourceKey?: string; ttl?: number };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }

    const { secret, resourceKey, ttl } = body;
    if (!secret || typeof secret !== "string") {
      return c.json({ error: "missing secret" }, 400);
    }
    if (!resourceKey || typeof resourceKey !== "string") {
      return c.json({ error: "missing resourceKey" }, 400);
    }

    const reg = containerRegistry.get(secret);
    if (!reg) {
      return c.json({ error: "invalid secret" }, 403);
    }

    const result = lockStore.heartbeat(resourceKey, reg.instanceId, ttl);

    if (result.ok) {
      logger.debug({ agent: reg.agentName, resourceKey }, "lock heartbeat");
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

    // Only return locks held by the requesting agent's instance
    return c.json(lockStore.list(reg.instanceId));
  });

  // /locks/status is local-only — not registered in cloud mode where the
  // gateway is publicly reachable and this endpoint has no authentication.
  if (!opts?.skipStatusEndpoint) {
    app.get("/locks/status", (c) => {
      const locks = lockStore.list().map((lock) => {
        // Extract agent name from holder (typically "agentName-instanceNumber")
        const agentName = lock.holder.split("-").slice(0, -1).join("-") || lock.holder;
        return {
          resourceKey: lock.resourceKey,
          agentName,
          heldSince: lock.heldSince,
        };
      });
      return c.json({ locks });
    });
  }
}
