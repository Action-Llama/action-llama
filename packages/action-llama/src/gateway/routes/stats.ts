import type { Hono } from "hono";
import type { StatsStore } from "../../stats/store.js";

export function registerStatsRoutes(app: Hono, statsStore?: StatsStore): void {
  // Paginated runs for an agent
  app.get("/api/stats/agents/:name/runs", (c) => {
    const name = c.req.param("name");
    const page = Math.max(1, parseInt(c.req.query("page") || "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") || "10", 10) || 10));
    const offset = (page - 1) * limit;

    if (!statsStore) {
      return c.json({ runs: [], total: 0, page, limit });
    }

    const runs = statsStore.queryRunsByAgentPaginated(name, limit, offset);
    const total = statsStore.countRunsByAgent(name);
    return c.json({ runs, total, page, limit });
  });

  // Single run by instance ID
  app.get("/api/stats/agents/:name/runs/:instanceId", (c) => {
    const instanceId = c.req.param("instanceId");

    if (!statsStore) {
      return c.json({ run: null });
    }

    const run = statsStore.queryRunByInstanceId(instanceId);
    return c.json({ run: run || null });
  });
}
