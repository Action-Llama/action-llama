import type { Hono } from "hono";
import type { ContainerRegistry } from "../container-registry.js";
import type { CallStore } from "../call-store.js";
import type { Logger } from "../../shared/logger.js";
import type { SchedulerEventBus } from "../../scheduler/events.js";

export type CallDispatcher = (entry: { callId: string; callerAgent: string; callerInstanceId: string; targetAgent: string; context: string; depth: number }) => { ok: boolean; reason?: string };

export function registerCallRoutes(
  app: Hono,
  containerRegistry: ContainerRegistry,
  callStore: CallStore,
  getDispatcher: () => CallDispatcher | undefined,
  logger: Logger,
  events?: SchedulerEventBus
): void {
  app.post("/calls", async (c) => {
    let body: { secret?: string; targetAgent?: string; context?: string };
    try {
      body = await c.req.json();
    } catch {
      logger.warn({ route: "/calls" }, "invalid JSON body");
      return c.json({ error: "invalid JSON body" }, 400);
    }

    const { secret, targetAgent, context } = body;
    if (!secret || typeof secret !== "string") {
      logger.warn({ route: "/calls" }, "missing secret");
      return c.json({ error: "missing secret" }, 400);
    }
    if (!targetAgent || typeof targetAgent !== "string") {
      logger.warn({ route: "/calls" }, "missing targetAgent");
      return c.json({ error: "missing targetAgent" }, 400);
    }
    if (context === undefined || context === null || typeof context !== "string") {
      logger.warn({ route: "/calls" }, "missing context");
      return c.json({ error: "missing context" }, 400);
    }

    const reg = containerRegistry.get(secret);
    if (!reg) {
      logger.warn({ route: "/calls", targetAgent }, "invalid secret");
      return c.json({ error: "invalid secret" }, 403);
    }

    const dispatcher = getDispatcher();
    if (!dispatcher) {
      logger.warn({ route: "/calls", agent: reg.agentName, targetAgent }, "call dispatcher not ready");
      return c.json({ ok: false, reason: "call dispatcher not ready" }, 503);
    }

    // Look up existing calls from this caller to determine depth
    const entry = callStore.create({
      callerAgent: reg.agentName,
      callerInstanceId: reg.instanceId,
      targetAgent,
      context,
      depth: 0, // Will be set by dispatcher
    });

    const result = dispatcher(entry);
    if (!result.ok) {
      // Clean up the entry since it won't be dispatched
      callStore.fail(entry.callId, result.reason || "dispatch rejected");
      logger.warn({ caller: reg.agentName, target: targetAgent, reason: result.reason }, "call rejected");
      events?.emit("call", { callerAgent: reg.agentName, targetAgent, ok: false, reason: result.reason });
      return c.json({ ok: false, reason: result.reason }, 409);
    }

    logger.info({ caller: reg.agentName, target: targetAgent, callId: entry.callId }, "call dispatched");
    events?.emit("call", { callerAgent: reg.agentName, targetAgent, ok: true, callId: entry.callId });
    return c.json({ ok: true, callId: entry.callId });
  });

  app.get("/calls/:callId", (c) => {
    const secret = c.req.query("secret");
    if (!secret) {
      logger.warn({ route: "/calls/:callId" }, "missing secret");
      return c.json({ error: "missing secret" }, 400);
    }

    const reg = containerRegistry.get(secret);
    if (!reg) {
      logger.warn({ route: "/calls/:callId" }, "invalid secret");
      return c.json({ error: "invalid secret" }, 403);
    }

    const callId = c.req.param("callId");
    const result = callStore.check(callId, reg.instanceId);
    if (!result) {
      logger.debug({ agent: reg.agentName, callId }, "call not found");
      return c.json({ error: "call not found" }, 404);
    }

    return c.json(result);
  });
}
