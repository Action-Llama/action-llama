import type { Hono } from "hono";
import type { StatusTracker } from "../../tui/status-tracker.js";
import type { Logger } from "../../shared/logger.js";

export interface ControlRoutesDeps {
  statusTracker?: StatusTracker;
  killInstance: (instanceId: string) => Promise<boolean>;
  killAgent: (name: string) => Promise<{ killed: number } | null>;
  pauseScheduler: () => Promise<void>;
  resumeScheduler: () => Promise<void>;
  triggerAgent?: (name: string, prompt?: string) => Promise<true | string>;
  enableAgent?: (name: string) => Promise<boolean>;
  disableAgent?: (name: string) => Promise<boolean>;
  stopScheduler?: () => Promise<void>;
  updateProjectScale?: (scale: number) => Promise<boolean>;
  updateAgentScale?: (name: string, scale: number) => Promise<boolean>;
  logger?: Logger;
  workQueue?: { size(agentName: string): number };
}

export function registerControlRoutes(app: Hono, deps: ControlRoutesDeps) {
  const { statusTracker, killInstance, pauseScheduler, resumeScheduler, logger } = deps;

  // GET /control/instances - List running instances
  app.get("/control/instances", async (c) => {
    if (!statusTracker) {
      return c.json({ error: "Status tracker not available" }, 503);
    }
    
    const instances = statusTracker.getInstances();
    return c.json({ instances });
  });

  // POST /control/kill/:instanceId - Kill a specific instance
  app.post("/control/kill/:instanceId", async (c) => {
    const instanceId = c.req.param("instanceId");
    logger?.info({ instanceId }, "control: kill instance requested");

    try {
      const success = await killInstance(instanceId);
      if (success) {
        logger?.info({ instanceId }, "control: instance killed");
        return c.json({ success: true, message: `Instance ${instanceId} killed` });
      } else {
        logger?.warn({ instanceId }, "control: instance not found");
        return c.json({ error: `Instance ${instanceId} not found` }, 404);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger?.error({ instanceId, err: message }, "control: kill instance failed");
      return c.json({ error: `Failed to kill instance: ${message}` }, 500);
    }
  });

  // POST /control/pause - Pause the scheduler
  app.post("/control/pause", async (c) => {
    logger?.info("control: pause requested");
    try {
      await pauseScheduler();
      return c.json({ success: true, message: "Scheduler paused" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger?.error({ err: message }, "control: pause failed");
      return c.json({ error: `Failed to pause scheduler: ${message}` }, 500);
    }
  });

  // POST /control/resume - Resume the scheduler
  app.post("/control/resume", async (c) => {
    logger?.info("control: resume requested");
    try {
      await resumeScheduler();
      return c.json({ success: true, message: "Scheduler resumed" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger?.error({ err: message }, "control: resume failed");
      return c.json({ error: `Failed to resume scheduler: ${message}` }, 500);
    }
  });

  // POST /control/stop - Stop the scheduler and clear queues
  app.post("/control/stop", async (c) => {
    if (!deps.stopScheduler) {
      return c.json({ error: "Stop not available" }, 503);
    }
    logger?.info("control: stop requested");
    // Respond before shutting down so the client gets a response
    setTimeout(() => { deps.stopScheduler!().catch(() => {}); }, 100);
    return c.json({ success: true, message: "Scheduler stopping" });
  });

  // POST /control/trigger/:name - Trigger an agent run
  app.post("/control/trigger/:name", async (c) => {
    const name = c.req.param("name");
    let prompt: string | undefined;
    try {
      const body = await c.req.json();
      if (body && typeof body.prompt === "string" && body.prompt.trim()) {
        prompt = body.prompt.trim();
      }
    } catch {
      // No body or invalid JSON — that's fine, prompt stays undefined
    }
    logger?.info({ agent: name, hasPrompt: !!prompt }, "control: trigger requested");
    if (!deps.triggerAgent) {
      return c.json({ error: "Trigger not available" }, 503);
    }
    try {
      const result = await deps.triggerAgent(name, prompt);
      if (result === true) {
        return c.json({ success: true, message: `Agent ${name} triggered` });
      } else {
        logger?.warn({ agent: name, reason: result }, "control: trigger rejected");
        const status = result.includes("not found") ? 404 : 409;
        return c.json({ error: result }, status);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger?.error({ agent: name, err: message }, "control: trigger failed");
      return c.json({ error: `Failed to trigger agent: ${message}` }, 500);
    }
  });

  // POST /control/agents/:name/enable - Enable an agent
  app.post("/control/agents/:name/enable", async (c) => {
    const name = c.req.param("name");
    logger?.info({ agent: name }, "control: enable requested");
    if (!deps.enableAgent) {
      return c.json({ error: "Enable not available" }, 503);
    }
    try {
      const success = await deps.enableAgent(name);
      if (success) {
        return c.json({ success: true, message: `Agent ${name} enabled` });
      } else {
        logger?.warn({ agent: name }, "control: agent not found");
        return c.json({ error: `Agent ${name} not found` }, 404);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger?.error({ agent: name, err: message }, "control: enable failed");
      return c.json({ error: `Failed to enable agent: ${message}` }, 500);
    }
  });

  // POST /control/agents/:name/disable - Disable an agent
  app.post("/control/agents/:name/disable", async (c) => {
    const name = c.req.param("name");
    logger?.info({ agent: name }, "control: disable requested");
    if (!deps.disableAgent) {
      return c.json({ error: "Disable not available" }, 503);
    }
    try {
      const success = await deps.disableAgent(name);
      if (success) {
        return c.json({ success: true, message: `Agent ${name} disabled` });
      } else {
        logger?.warn({ agent: name }, "control: agent not found");
        return c.json({ error: `Agent ${name} not found` }, 404);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger?.error({ agent: name, err: message }, "control: disable failed");
      return c.json({ error: `Failed to disable agent: ${message}` }, 500);
    }
  });

  // POST /control/agents/:name/pause - Pause an agent (alias for disable)
  app.post("/control/agents/:name/pause", async (c) => {
    const name = c.req.param("name");
    logger?.info({ agent: name }, "control: pause agent requested");
    if (!deps.disableAgent) {
      return c.json({ error: "Pause not available" }, 503);
    }
    try {
      const success = await deps.disableAgent(name);
      if (success) {
        return c.json({ success: true, message: `Agent ${name} paused` });
      } else {
        logger?.warn({ agent: name }, "control: agent not found");
        return c.json({ error: `Agent ${name} not found` }, 404);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger?.error({ agent: name, err: message }, "control: pause agent failed");
      return c.json({ error: `Failed to pause agent: ${message}` }, 500);
    }
  });

  // POST /control/agents/:name/resume - Resume an agent (alias for enable)
  app.post("/control/agents/:name/resume", async (c) => {
    const name = c.req.param("name");
    logger?.info({ agent: name }, "control: resume agent requested");
    if (!deps.enableAgent) {
      return c.json({ error: "Resume not available" }, 503);
    }
    try {
      const success = await deps.enableAgent(name);
      if (success) {
        return c.json({ success: true, message: `Agent ${name} resumed` });
      } else {
        logger?.warn({ agent: name }, "control: agent not found");
        return c.json({ error: `Agent ${name} not found` }, 404);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger?.error({ agent: name, err: message }, "control: resume agent failed");
      return c.json({ error: `Failed to resume agent: ${message}` }, 500);
    }
  });

  // POST /control/agents/:name/kill - Kill all running instances of an agent
  app.post("/control/agents/:name/kill", async (c) => {
    const name = c.req.param("name");
    logger?.info({ agent: name }, "control: kill agent requested");
    try {
      const result = await deps.killAgent(name);
      if (result === null) {
        logger?.warn({ agent: name }, "control: agent not found");
        return c.json({ error: `Agent ${name} not found` }, 404);
      }
      logger?.info({ agent: name, killed: result.killed }, "control: agent instances killed");
      return c.json({ success: true, message: `Killed ${result.killed} instance(s) of ${name}`, killed: result.killed });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger?.error({ agent: name, err: message }, "control: kill agent failed");
      return c.json({ error: `Failed to kill agent: ${message}` }, 500);
    }
  });

  // GET /control/status - Get scheduler status
  app.get("/control/status", async (c) => {
    if (!statusTracker) {
      return c.json({ error: "Status tracker not available" }, 503);
    }

    const schedulerInfo = statusTracker.getSchedulerInfo();
    const instances = statusTracker.getInstances();
    const agents = statusTracker.getAllAgents();

    const queueSizes: Record<string, number> = {};
    if (deps.workQueue) {
      for (const agent of agents) {
        queueSizes[agent.name] = deps.workQueue.size(agent.name);
      }
    }

    return c.json({
      scheduler: schedulerInfo,
      instances,
      agents,
      running: instances.length,
      queueSizes,
    });
  });

  // POST /control/project/scale - Update project scale
  app.post("/control/project/scale", async (c) => {
    logger?.info("control: project scale update requested");
    if (!deps.updateProjectScale) {
      return c.json({ error: "Project scale update not available" }, 503);
    }
    try {
      const body = await c.req.json();
      const scale = parseInt(body.scale);
      if (!Number.isInteger(scale) || scale < 1) {
        return c.json({ error: "Scale must be a positive integer" }, 400);
      }
      const success = await deps.updateProjectScale(scale);
      if (success) {
        logger?.info({ scale }, "control: project scale updated");
        return c.json({ success: true, message: `Project scale updated to ${scale}` });
      } else {
        return c.json({ error: "Failed to update project scale" }, 500);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger?.error({ err: message }, "control: project scale update failed");
      return c.json({ error: `Failed to update project scale: ${message}` }, 500);
    }
  });

  // POST /control/agents/:name/scale - Update agent scale
  app.post("/control/agents/:name/scale", async (c) => {
    const name = c.req.param("name");
    logger?.info({ agent: name }, "control: agent scale update requested");
    if (!deps.updateAgentScale) {
      return c.json({ error: "Agent scale update not available" }, 503);
    }
    try {
      const body = await c.req.json();
      const scale = parseInt(body.scale);
      if (!Number.isInteger(scale) || scale < 1) {
        return c.json({ error: "Scale must be a positive integer" }, 400);
      }
      const success = await deps.updateAgentScale(name, scale);
      if (success) {
        logger?.info({ agent: name, scale }, "control: agent scale updated");
        return c.json({ success: true, message: `Agent ${name} scale updated to ${scale}` });
      } else {
        logger?.warn({ agent: name }, "control: agent not found");
        return c.json({ error: `Agent ${name} not found` }, 404);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger?.error({ agent: name, err: message }, "control: agent scale update failed");
      return c.json({ error: `Failed to update agent scale: ${message}` }, 500);
    }
  });
}