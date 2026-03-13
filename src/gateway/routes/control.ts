import type { Hono } from "hono";
import type { StatusTracker } from "../../tui/status-tracker.js";

export interface ControlRoutesDeps {
  statusTracker?: StatusTracker;
  killInstance: (instanceId: string) => Promise<boolean>;
  killAgent: (name: string) => Promise<{ killed: number } | null>;
  pauseScheduler: () => Promise<void>;
  resumeScheduler: () => Promise<void>;
  triggerAgent?: (name: string) => Promise<boolean>;
  enableAgent?: (name: string) => Promise<boolean>;
  disableAgent?: (name: string) => Promise<boolean>;
}

export function registerControlRoutes(app: Hono, deps: ControlRoutesDeps) {
  const { statusTracker, killInstance, pauseScheduler, resumeScheduler } = deps;

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
    
    try {
      const success = await killInstance(instanceId);
      if (success) {
        return c.json({ success: true, message: `Instance ${instanceId} killed` });
      } else {
        return c.json({ error: `Instance ${instanceId} not found` }, 404);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: `Failed to kill instance: ${message}` }, 500);
    }
  });

  // POST /control/pause - Pause the scheduler
  app.post("/control/pause", async (c) => {
    try {
      await pauseScheduler();
      return c.json({ success: true, message: "Scheduler paused" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: `Failed to pause scheduler: ${message}` }, 500);
    }
  });

  // POST /control/resume - Resume the scheduler  
  app.post("/control/resume", async (c) => {
    try {
      await resumeScheduler();
      return c.json({ success: true, message: "Scheduler resumed" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: `Failed to resume scheduler: ${message}` }, 500);
    }
  });

  // POST /control/trigger/:name - Trigger an agent run
  app.post("/control/trigger/:name", async (c) => {
    const name = c.req.param("name");
    if (!deps.triggerAgent) {
      return c.json({ error: "Trigger not available" }, 503);
    }
    try {
      const success = await deps.triggerAgent(name);
      if (success) {
        return c.json({ success: true, message: `Agent ${name} triggered` });
      } else {
        return c.json({ error: `Agent ${name} not found or all runners busy` }, 404);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: `Failed to trigger agent: ${message}` }, 500);
    }
  });

  // POST /control/agents/:name/enable - Enable an agent
  app.post("/control/agents/:name/enable", async (c) => {
    const name = c.req.param("name");
    if (!deps.enableAgent) {
      return c.json({ error: "Enable not available" }, 503);
    }
    try {
      const success = await deps.enableAgent(name);
      if (success) {
        return c.json({ success: true, message: `Agent ${name} enabled` });
      } else {
        return c.json({ error: `Agent ${name} not found` }, 404);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: `Failed to enable agent: ${message}` }, 500);
    }
  });

  // POST /control/agents/:name/disable - Disable an agent
  app.post("/control/agents/:name/disable", async (c) => {
    const name = c.req.param("name");
    if (!deps.disableAgent) {
      return c.json({ error: "Disable not available" }, 503);
    }
    try {
      const success = await deps.disableAgent(name);
      if (success) {
        return c.json({ success: true, message: `Agent ${name} disabled` });
      } else {
        return c.json({ error: `Agent ${name} not found` }, 404);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: `Failed to disable agent: ${message}` }, 500);
    }
  });

  // POST /control/agents/:name/pause - Pause an agent (alias for disable)
  app.post("/control/agents/:name/pause", async (c) => {
    const name = c.req.param("name");
    if (!deps.disableAgent) {
      return c.json({ error: "Pause not available" }, 503);
    }
    try {
      const success = await deps.disableAgent(name);
      if (success) {
        return c.json({ success: true, message: `Agent ${name} paused` });
      } else {
        return c.json({ error: `Agent ${name} not found` }, 404);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: `Failed to pause agent: ${message}` }, 500);
    }
  });

  // POST /control/agents/:name/resume - Resume an agent (alias for enable)
  app.post("/control/agents/:name/resume", async (c) => {
    const name = c.req.param("name");
    if (!deps.enableAgent) {
      return c.json({ error: "Resume not available" }, 503);
    }
    try {
      const success = await deps.enableAgent(name);
      if (success) {
        return c.json({ success: true, message: `Agent ${name} resumed` });
      } else {
        return c.json({ error: `Agent ${name} not found` }, 404);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: `Failed to resume agent: ${message}` }, 500);
    }
  });

  // POST /control/agents/:name/kill - Kill all running instances of an agent
  app.post("/control/agents/:name/kill", async (c) => {
    const name = c.req.param("name");
    try {
      const result = await deps.killAgent(name);
      if (result === null) {
        return c.json({ error: `Agent ${name} not found` }, 404);
      }
      return c.json({ success: true, message: `Killed ${result.killed} instance(s) of ${name}`, killed: result.killed });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
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

    return c.json({
      scheduler: schedulerInfo,
      instances,
      agents,
      running: instances.length,
    });
  });
}