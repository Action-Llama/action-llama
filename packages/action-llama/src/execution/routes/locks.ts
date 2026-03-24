import type { Hono } from "hono";
import type { ContainerRegistry } from "../container-registry.js";
import type { LockStore } from "../lock-store.js";
import type { Logger } from "../../shared/logger.js";
import type { SchedulerEventBus } from "../../scheduler/events.js";

export function registerLockRoutes(
  app: Hono,
  containerRegistry: ContainerRegistry,
  lockStore: LockStore,
  logger: Logger,
  opts?: { skipStatusEndpoint?: boolean; events?: SchedulerEventBus }
): void {
  const events = opts?.events;
  app.post("/locks/acquire", async (c) => {
    let body: { secret?: string; resourceKey?: string; ttl?: number };
    try {
      body = await c.req.json();
    } catch {
      logger.warn({ route: "/locks/acquire" }, "invalid JSON body");
      return c.json({ error: "invalid JSON body" }, 400);
    }

    const { secret, resourceKey, ttl } = body;
    if (!secret || typeof secret !== "string") {
      logger.warn({ route: "/locks/acquire" }, "missing secret");
      return c.json({ error: "missing secret" }, 400);
    }
    if (!resourceKey || typeof resourceKey !== "string") {
      logger.warn({ route: "/locks/acquire" }, "missing resourceKey");
      return c.json({ error: "missing resourceKey" }, 400);
    }

    // Validate that resourceKey is a valid URI
    try {
      const url = new URL(resourceKey);
      const validSchemePattern = /^[a-z][a-z0-9+.-]*$/;
      if (!validSchemePattern.test(url.protocol.slice(0, -1))) {
        logger.warn({ route: "/locks/acquire", resourceKey }, "invalid URI scheme");
        return c.json({ error: `Invalid URI scheme '${url.protocol}'. URI schemes must match pattern [a-z][a-z0-9+.-]*:` }, 400);
      }
    } catch (error) {
      logger.warn({ route: "/locks/acquire", resourceKey }, "invalid URI format");
      return c.json({ error: `Invalid URI format: ${error instanceof Error ? error.message : 'unknown error'}` }, 400);
    }

    const reg = containerRegistry.get(secret);
    if (!reg) {
      logger.warn({ route: "/locks/acquire", resourceKey }, "invalid secret");
      return c.json({ error: "invalid secret" }, 403);
    }

    const result = lockStore.acquire(resourceKey, reg.instanceId, ttl);

    if (result.ok) {
      logger.debug({ agent: reg.agentName, resourceKey }, "lock acquired");
      events?.emit("lock", { agentName: reg.agentName, instanceId: reg.instanceId, resourceKey, action: "acquire", ok: true, status: 200 });
      return c.json({ ok: true, resourceKey });
    }

    if (result.reason) {
      if (result.deadlock) {
        logger.warn({ agent: reg.agentName, resourceKey, cycle: result.cycle }, "possible deadlock");
      } else {
        logger.debug({ agent: reg.agentName, resourceKey }, "lock rejected: " + result.reason);
      }
      events?.emit("lock", { agentName: reg.agentName, instanceId: reg.instanceId, resourceKey, action: "acquire", ok: false, status: 409, reason: result.reason });
      return c.json(
        { ok: false, reason: result.reason, ...(result.deadlock ? { deadlock: true, cycle: result.cycle } : {}) },
        409
      );
    }

    logger.debug(
      { agent: reg.agentName, resourceKey, holder: result.holder },
      "lock conflict"
    );
    events?.emit("lock", { agentName: reg.agentName, instanceId: reg.instanceId, resourceKey, action: "acquire", ok: false, status: 409, reason: `held by ${result.holder}` });
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
      logger.warn({ route: "/locks/release" }, "invalid JSON body");
      return c.json({ error: "invalid JSON body" }, 400);
    }

    const { secret, resourceKey } = body;
    if (!secret || typeof secret !== "string") {
      logger.warn({ route: "/locks/release" }, "missing secret");
      return c.json({ error: "missing secret" }, 400);
    }
    if (!resourceKey || typeof resourceKey !== "string") {
      logger.warn({ route: "/locks/release" }, "missing resourceKey");
      return c.json({ error: "missing resourceKey" }, 400);
    }

    // Validate that resourceKey is a valid URI
    try {
      const url = new URL(resourceKey);
      const validSchemePattern = /^[a-z][a-z0-9+.-]*$/;
      if (!validSchemePattern.test(url.protocol.slice(0, -1))) {
        logger.warn({ route: "/locks/release", resourceKey }, "invalid URI scheme");
        return c.json({ error: `Invalid URI scheme '${url.protocol}'. URI schemes must match pattern [a-z][a-z0-9+.-]*:` }, 400);
      }
    } catch (error) {
      logger.warn({ route: "/locks/release", resourceKey }, "invalid URI format");
      return c.json({ error: `Invalid URI format: ${error instanceof Error ? error.message : 'unknown error'}` }, 400);
    }

    const reg = containerRegistry.get(secret);
    if (!reg) {
      logger.warn({ route: "/locks/release", resourceKey }, "invalid secret");
      return c.json({ error: "invalid secret" }, 403);
    }

    const result = lockStore.release(resourceKey, reg.instanceId);

    if (result.ok) {
      logger.debug({ agent: reg.agentName, resourceKey }, "lock released");
      events?.emit("lock", { agentName: reg.agentName, instanceId: reg.instanceId, resourceKey, action: "release", ok: true, status: 200 });
      return c.json({ ok: true });
    }

    const status = result.reason === "lock not found" ? 404 : 409;
    events?.emit("lock", { agentName: reg.agentName, instanceId: reg.instanceId, resourceKey, action: "release", ok: false, status, reason: result.reason });
    return c.json({ ok: false, reason: result.reason }, status);
  });

  app.post("/locks/heartbeat", async (c) => {
    let body: { secret?: string; resourceKey?: string; ttl?: number };
    try {
      body = await c.req.json();
    } catch {
      logger.warn({ route: "/locks/heartbeat" }, "invalid JSON body");
      return c.json({ error: "invalid JSON body" }, 400);
    }

    const { secret, resourceKey, ttl } = body;
    if (!secret || typeof secret !== "string") {
      logger.warn({ route: "/locks/heartbeat" }, "missing secret");
      return c.json({ error: "missing secret" }, 400);
    }
    if (!resourceKey || typeof resourceKey !== "string") {
      logger.warn({ route: "/locks/heartbeat" }, "missing resourceKey");
      return c.json({ error: "missing resourceKey" }, 400);
    }

    // Validate that resourceKey is a valid URI
    try {
      const url = new URL(resourceKey);
      const validSchemePattern = /^[a-z][a-z0-9+.-]*$/;
      if (!validSchemePattern.test(url.protocol.slice(0, -1))) {
        logger.warn({ route: "/locks/heartbeat", resourceKey }, "invalid URI scheme");
        return c.json({ error: `Invalid URI scheme '${url.protocol}'. URI schemes must match pattern [a-z][a-z0-9+.-]*:` }, 400);
      }
    } catch (error) {
      logger.warn({ route: "/locks/heartbeat", resourceKey }, "invalid URI format");
      return c.json({ error: `Invalid URI format: ${error instanceof Error ? error.message : 'unknown error'}` }, 400);
    }

    const reg = containerRegistry.get(secret);
    if (!reg) {
      logger.warn({ route: "/locks/heartbeat", resourceKey }, "invalid secret");
      return c.json({ error: "invalid secret" }, 403);
    }

    const result = lockStore.heartbeat(resourceKey, reg.instanceId, ttl);

    if (result.ok) {
      logger.debug({ agent: reg.agentName, resourceKey }, "lock heartbeat");
      events?.emit("lock", { agentName: reg.agentName, instanceId: reg.instanceId, resourceKey, action: "heartbeat", ok: true, status: 200 });
      return c.json({ ok: true, expiresAt: result.expiresAt });
    }

    const status = result.reason === "lock not found" ? 404 : 409;
    events?.emit("lock", { agentName: reg.agentName, instanceId: reg.instanceId, resourceKey, action: "heartbeat", ok: false, status, reason: result.reason });
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
          holder: lock.holder,
          heldSince: lock.heldSince,
        };
      });
      return c.json({ locks });
    });
  }
}
