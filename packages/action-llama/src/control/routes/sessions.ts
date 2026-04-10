import type { Hono } from "hono";
import type { StatusTracker } from "../../tui/status-tracker.js";

/**
 * REST endpoints for session listing and lookup.
 * WebSocket attach is handled separately via the HTTP server upgrade event.
 *
 * GET /sessions       — active sessions (running + waiting)
 * GET /sessions/:id   — single session by ID
 */
export function registerSessionRoutes(app: Hono, deps: { statusTracker?: StatusTracker }): void {
  app.get("/sessions", (c) => {
    if (!deps.statusTracker) {
      return c.json({ error: "Status tracker not available" }, 503);
    }
    const sessions = deps.statusTracker
      .getSessions()
      .filter(s => s.status === "running" || s.status === "waiting");
    return c.json({ sessions });
  });

  app.get("/sessions/:id", (c) => {
    if (!deps.statusTracker) {
      return c.json({ error: "Status tracker not available" }, 503);
    }
    const id = c.req.param("id");
    const session = deps.statusTracker.getSessions().find(s => s.id === id);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }
    return c.json({ session });
  });
}
