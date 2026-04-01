import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { StatusTracker } from "../../tui/status-tracker.js";

/**
 * Register the SSE status stream and locks API endpoints.
 * These are consumed by the React SPA frontend.
 */
export function registerDashboardDataRoutes(
  app: Hono,
  statusTracker: StatusTracker,
): void {
  // Locks API endpoint
  app.get("/dashboard/api/locks", async (c) => {
    try {
      const response = await fetch("http://127.0.0.1:" + (statusTracker.getSchedulerInfo()?.gatewayPort || 3000) + "/locks/status", {
        headers: { "X-Internal-Request": "true" }
      });
      if (response.ok) {
        const data = await response.json();
        return c.json(data);
      }
    } catch {
      // ignore fetch errors
    }
    return c.json({ locks: [] });
  });

  // SSE: status stream
  app.get("/dashboard/api/status-stream", (c) => {
    return streamSSE(c, async (stream) => {
      // Set headers for Cloudflare/nginx proxy compatibility.
      // Must be set after streamSSE creates the response to avoid being overwritten.
      c.header("Cache-Control", "no-cache, no-transform");
      c.header("X-Accel-Buffering", "no");
      c.header("Connection", "keep-alive");

      let lastVersion = statusTracker.getInvalidationVersion();

      const send = () => {
        const agents = statusTracker.getAllAgents();
        const info = statusTracker.getSchedulerInfo();
        const recentLogs = statusTracker.getRecentLogs(20);
        const instances = statusTracker.getInstances();
        const { signals: invalidated, version } = statusTracker.getInvalidationsSince(lastVersion);
        lastVersion = version;
        const payload: Record<string, unknown> = { agents, schedulerInfo: info, recentLogs, instances };
        if (invalidated.length > 0) {
          payload.invalidated = invalidated;
        }
        stream.writeSSE({
          data: JSON.stringify(payload),
        });
      };

      // Send initial state
      send();

      // Throttle updates: coalesce rapid-fire events into at most 1 send per 500ms
      let pending = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const throttledSend = () => {
        if (timer) {
          pending = true;
          return;
        }
        send();
        timer = setTimeout(() => {
          timer = null;
          if (pending) {
            pending = false;
            send();
          }
        }, 500);
      };

      // Listen for updates
      statusTracker.on("update", throttledSend);

      // Keep connection alive with periodic heartbeats
      const heartbeat = setInterval(() => {
        stream.writeSSE({ event: "heartbeat", data: "" });
      }, 15000);

      // Cleanup on disconnect
      stream.onAbort(() => {
        statusTracker.removeListener("update", throttledSend);
        if (timer) clearTimeout(timer);
        clearInterval(heartbeat);
      });

      // Keep the stream open
      await new Promise(() => {});
    });
  });
}
