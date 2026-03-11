import type { Hono } from "hono";
import type { ContainerRegistration, RerunRequest, StatusRequest, TriggerRequest } from "../types.js";
import type { Logger } from "../../shared/logger.js";
import type { StatusTracker } from "../../tui/status-tracker.js";

export interface SignalContext {
  schedulerRerun: (agentName: string) => void;
  schedulerTrigger: (targetAgent: string, sourceAgent: string, context: string) => void;
}

export function registerSignalRoutes(
  app: Hono,
  containerRegistry: Map<string, ContainerRegistration>,
  logger: Logger,
  statusTracker?: StatusTracker,
  signalContext?: SignalContext
): void {
  app.post("/signals/rerun", async (c) => {
    let body: RerunRequest;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }

    const { secret } = body;
    if (!secret || typeof secret !== "string") {
      return c.json({ error: "missing secret" }, 400);
    }

    const reg = containerRegistry.get(secret);
    if (!reg) {
      return c.json({ error: "invalid secret" }, 403);
    }

    logger.info({ agent: reg.agentName }, "rerun signal received");
    
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
      return c.json({ error: "invalid JSON body" }, 400);
    }

    const { secret, text } = body;
    if (!secret || typeof secret !== "string") {
      return c.json({ error: "missing secret" }, 400);
    }
    if (!text || typeof text !== "string") {
      return c.json({ error: "missing text" }, 400);
    }

    const reg = containerRegistry.get(secret);
    if (!reg) {
      return c.json({ error: "invalid secret" }, 403);
    }

    logger.debug({ agent: reg.agentName, text }, "status signal received");
    
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
      return c.json({ error: "invalid JSON body" }, 400);
    }

    const { secret, targetAgent, context } = body;
    if (!secret || typeof secret !== "string") {
      return c.json({ error: "missing secret" }, 400);
    }
    if (!targetAgent || typeof targetAgent !== "string") {
      return c.json({ error: "missing targetAgent" }, 400);
    }
    if (!context || typeof context !== "string") {
      return c.json({ error: "missing context" }, 400);
    }

    const reg = containerRegistry.get(secret);
    if (!reg) {
      return c.json({ error: "invalid secret" }, 403);
    }

    logger.info({ agent: reg.agentName, targetAgent }, "trigger signal received");
    
    if (signalContext) {
      signalContext.schedulerTrigger(targetAgent, reg.agentName, context);
    }
    
    return c.json({ ok: true });
  });
}