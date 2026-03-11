import type { Hono } from "hono";
import type { StatusTracker } from "../../tui/status-tracker.js";

export interface ControlRoutesDeps {
  statusTracker?: StatusTracker;
  killInstance: (instanceId: string) => Promise<boolean>;
  pauseScheduler: () => Promise<void>;
  resumeScheduler: () => Promise<void>;
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

  // GET /control/status - Get scheduler status
  app.get("/control/status", async (c) => {
    if (!statusTracker) {
      return c.json({ error: "Status tracker not available" }, 503);
    }
    
    const schedulerInfo = statusTracker.getSchedulerInfo();
    const instances = statusTracker.getInstances();
    
    return c.json({
      scheduler: schedulerInfo,
      instances,
      running: instances.length,
    });
  });
}