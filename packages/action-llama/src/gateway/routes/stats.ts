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

  // Paginated trigger history
  app.get("/api/stats/triggers", (c) => {
    const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") || "50", 10) || 50));
    const offset = Math.max(0, parseInt(c.req.query("offset") || "0", 10) || 0);
    const includeDeadLetters = c.req.query("all") === "1";
    const since = parseInt(c.req.query("since") || "0", 10) || 0;

    if (!statsStore) {
      return c.json({ triggers: [], total: 0, limit, offset });
    }

    const triggers = statsStore.queryTriggerHistory({ since, limit, offset, includeDeadLetters });
    const total = statsStore.countTriggerHistory(since, includeDeadLetters);
    return c.json({ triggers, total, limit, offset });
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
