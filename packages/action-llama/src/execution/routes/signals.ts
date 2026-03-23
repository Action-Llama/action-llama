import type { Hono } from "hono";
import type { RerunRequest, StatusRequest, TriggerRequest, ReturnRequest } from "../types.js";
import type { ContainerRegistry } from "../container-registry.js";
import type { Logger } from "../../shared/logger.js";
import type { StatusTracker } from "../../tui/status-tracker.js";
import type { SchedulerEventBus } from "../../scheduler/events.js";

export interface SignalContext {
  schedulerRerun: (agentName: string) => void;
  schedulerTrigger: (targetAgent: string, sourceAgent: string, context: string) => void;
  schedulerReturn?: (agentName: string, value: string) => void;
}

export function registerSignalRoutes(
  app: Hono,
  containerRegistry: ContainerRegistry,
  logger: Logger,
  statusTracker?: StatusTracker,
  signalContext?: SignalContext,
  events?: SchedulerEventBus
): void {
  app.post("/signals/rerun", async (c) => {
    let body: RerunRequest;
    try {
      body = await c.req.json();
    } catch {
      logger.warn({ route: "/signals/rerun" }, "invalid JSON body");
      return c.json({ error: "invalid JSON body" }, 400);
    }

    const { secret } = body;
    if (!secret || typeof secret !== "string") {
      logger.warn({ route: "/signals/rerun" }, "missing secret");
      return c.json({ error: "missing secret" }, 400);
    }

    const reg = containerRegistry.get(secret);
    if (!reg) {
      logger.warn({ route: "/signals/rerun" }, "invalid secret");
      return c.json({ error: "invalid secret" }, 403);
    }

    logger.info({ agent: reg.agentName }, "rerun signal received");
    events?.emit("signal", { agentName: reg.agentName, instanceId: reg.instanceId, signal: "rerun" });

    if (signalContext) {
      signalContext.schedulerRerun(reg.agentName);
    }

    return c.json({ ok: true });
  });

  app.post("/signals/status", async (c) => {
    let body: StatusRequest;
    try {
      body = await c.req.json();
    } catch {
      logger.warn({ route: "/signals/status" }, "invalid JSON body");
      return c.json({ error: "invalid JSON body" }, 400);
    }

    const { secret, text } = body;
    if (!secret || typeof secret !== "string") {
      logger.warn({ route: "/signals/status" }, "missing secret");
      return c.json({ error: "missing secret" }, 400);
    }
    if (!text || typeof text !== "string") {
      logger.warn({ route: "/signals/status" }, "missing text");
      return c.json({ error: "missing text" }, 400);
    }

    const reg = containerRegistry.get(secret);
    if (!reg) {
      logger.warn({ route: "/signals/status" }, "invalid secret");
      return c.json({ error: "invalid secret" }, 403);
    }

    logger.debug({ agent: reg.agentName, text }, "status signal received");
    events?.emit("signal", { agentName: reg.agentName, instanceId: reg.instanceId, signal: "status" });

    if (statusTracker) {
      statusTracker.setAgentStatusText(reg.agentName, text);
    }

    return c.json({ ok: true });
  });

  app.post("/signals/trigger", async (c) => {
    let body: TriggerRequest;
    try {
      body = await c.req.json();
    } catch {
      logger.warn({ route: "/signals/trigger" }, "invalid JSON body");
      return c.json({ error: "invalid JSON body" }, 400);
    }

    const { secret, targetAgent, context } = body;
    if (!secret || typeof secret !== "string") {
      logger.warn({ route: "/signals/trigger" }, "missing secret");
      return c.json({ error: "missing secret" }, 400);
    }
    if (!targetAgent || typeof targetAgent !== "string") {
      logger.warn({ route: "/signals/trigger" }, "missing targetAgent");
      return c.json({ error: "missing targetAgent" }, 400);
    }
    if (!context || typeof context !== "string") {
      logger.warn({ route: "/signals/trigger" }, "missing context");
      return c.json({ error: "missing context" }, 400);
    }

    const reg = containerRegistry.get(secret);
    if (!reg) {
      logger.warn({ route: "/signals/trigger", targetAgent }, "invalid secret");
      return c.json({ error: "invalid secret" }, 403);
    }

    logger.info({ agent: reg.agentName, targetAgent }, "trigger signal received");
    events?.emit("signal", { agentName: reg.agentName, instanceId: reg.instanceId, signal: "trigger" });

    if (signalContext) {
      signalContext.schedulerTrigger(targetAgent, reg.agentName, context);
    }

    return c.json({ ok: true });
  });

  app.post("/signals/return", async (c) => {
    let body: ReturnRequest;
    try {
      body = await c.req.json();
    } catch {
      logger.warn({ route: "/signals/return" }, "invalid JSON body");
      return c.json({ error: "invalid JSON body" }, 400);
    }

    const { secret, value } = body;
    if (!secret || typeof secret !== "string") {
      logger.warn({ route: "/signals/return" }, "missing secret");
      return c.json({ error: "missing secret" }, 400);
    }
    if (value === undefined || value === null) {
      logger.warn({ route: "/signals/return" }, "missing value");
      return c.json({ error: "missing value" }, 400);
    }

    const reg = containerRegistry.get(secret);
    if (!reg) {
      logger.warn({ route: "/signals/return" }, "invalid secret");
      return c.json({ error: "invalid secret" }, 403);
    }

    logger.debug({ agent: reg.agentName }, "return signal received");
    events?.emit("signal", { agentName: reg.agentName, instanceId: reg.instanceId, signal: "return" });

    if (signalContext?.schedulerReturn) {
      signalContext.schedulerReturn(reg.agentName, String(value));
    }

    return c.json({ ok: true });
  });
}