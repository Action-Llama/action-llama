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
    const triggerTypeFilter = c.req.query("triggerType") || undefined;

    if (!statsStore) {
      return c.json({ triggers: [], total: 0, limit, offset });
    }

    const triggers = statsStore.queryTriggerHistory({ since, limit, offset, includeDeadLetters, agentName: agentFilter, triggerType: triggerTypeFilter });
    const total = statsStore.countTriggerHistory(since, includeDeadLetters, agentFilter, triggerTypeFilter);

    // Merge running instances into trigger list (only on first page)
    let mergedTriggers = triggers;
    let mergedTotal = total;
    if (statusTracker && offset === 0) {
      const running = statusTracker.getInstances()
        .filter((inst) => {
          if (inst.status !== "running") return false;
          if (agentFilter && inst.agentName !== agentFilter) return false;
          if (triggerTypeFilter) {
            const sep = inst.trigger.indexOf(":");
            const type = sep > -1 ? inst.trigger.slice(0, sep) : inst.trigger;
            if (type !== triggerTypeFilter) return false;
          }
          return true;
        })
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
            deadLetterReason: null,
          };
        });
      mergedTriggers = [...running, ...triggers].sort((a, b) => b.ts - a.ts);
      mergedTotal = total + running.length;
    }

    return c.json({ triggers: mergedTriggers, total: mergedTotal, limit, offset });
  });

  // Paginated jobs (pending + running + completed, no dead letters)
  app.get("/api/stats/jobs", (c) => {
    const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") || "50", 10) || 50));
    const offset = Math.max(0, parseInt(c.req.query("offset") || "0", 10) || 0);
    const since = parseInt(c.req.query("since") || "0", 10) || 0;
    const agentFilter = c.req.query("agent") || undefined;

    // Completed/errored jobs from runs table (no dead letters — dead letters aren't jobs)
    const runs = statsStore
      ? statsStore.queryTriggerHistory({ since, limit, offset, includeDeadLetters: false, agentName: agentFilter })
      : [];
    const total = statsStore ? statsStore.countTriggerHistory(since, false, agentFilter) : 0;

    // Running instances (only on first page)
    let mergedJobs = runs;
    let mergedTotal = total;
    if (statusTracker && offset === 0) {
      const running = statusTracker.getInstances()
        .filter((inst) => {
          if (inst.status !== "running") return false;
          if (agentFilter && inst.agentName !== agentFilter) return false;
          return true;
        })
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
            deadLetterReason: null,
          };
        });
      const runningIds = new Set(runs.map((r: any) => r.instanceId));
      const uniqueRunning = running.filter((r) => !runningIds.has(r.instanceId));
      mergedJobs = [...uniqueRunning, ...runs].sort((a: any, b: any) => b.ts - a.ts);
      mergedTotal = total + uniqueRunning.length;
    }

    // Pending counts per agent
    const agents = statusTracker ? statusTracker.getAllAgents() : [];
    const pending: Record<string, number> = {};
    for (const a of agents) {
      if (a.queuedWebhooks > 0) {
        if (!agentFilter || a.name === agentFilter) {
          pending[a.name] = a.queuedWebhooks;
        }
      }
    }
    const totalPending = Object.values(pending).reduce((s, n) => s + n, 0);

    return c.json({ jobs: mergedJobs, total: mergedTotal, pending, totalPending, limit, offset });
  });

  // Single webhook receipt by ID
  app.get("/api/stats/webhooks/:receiptId", (c) => {
    const receiptId = c.req.param("receiptId");

    if (!statsStore) {
      return c.json({ receipt: null });
    }

    const receipt = statsStore.getWebhookReceipt(receiptId);
    if (!receipt) {
      return c.json({ receipt: null }, 404);
    }
    return c.json({ receipt });
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
