import type { Hono } from "hono";
import type { StatsStore } from "../../stats/store.js";
import type { StatusTracker } from "../../tui/status-tracker.js";

export function registerStatsRoutes(app: Hono, statsStore?: StatsStore, statusTracker?: StatusTracker): void {
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

  // Paginated trigger history (optional ?agent=<name> filter)
  app.get("/api/stats/triggers", (c) => {
    const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") || "50", 10) || 50));
    const offset = Math.max(0, parseInt(c.req.query("offset") || "0", 10) || 0);
    const includeDeadLetters = c.req.query("all") === "1";
    const since = parseInt(c.req.query("since") || "0", 10) || 0;
    const agentFilter = c.req.query("agent") || undefined;

    if (!statsStore) {
      return c.json({ triggers: [], total: 0, limit, offset });
    }

    const triggers = statsStore.queryTriggerHistory({ since, limit, offset, includeDeadLetters, agentName: agentFilter });
    const total = statsStore.countTriggerHistory(since, includeDeadLetters, agentFilter);

    // Merge running instances into trigger list (only on first page)
    let mergedTriggers = triggers;
    let mergedTotal = total;
    if (statusTracker && offset === 0) {
      const running = statusTracker.getInstances()
        .filter((inst) => inst.status === "running" && (!agentFilter || inst.agentName === agentFilter))
        .map((inst) => {
          const sep = inst.trigger.indexOf(":");
          return {
            ts: new Date(inst.startedAt).getTime(),
            triggerType: sep > -1 ? inst.trigger.slice(0, sep) : inst.trigger,
            triggerSource: sep > -1 ? inst.trigger.slice(sep + 1).trim() : null,
            agentName: inst.agentName,
            instanceId: inst.id,
            result: "running",
            webhookReceiptId: null,
          };
        });
      mergedTriggers = [...running, ...triggers].sort((a, b) => b.ts - a.ts);
      mergedTotal = total + running.length;
    }

    return c.json({ triggers: mergedTriggers, total: mergedTotal, limit, offset });
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
