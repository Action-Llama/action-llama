import type { Hono } from "hono";
import type { StatsStore } from "../../stats/store.js";
import type { StatusTracker } from "../../tui/status-tracker.js";

export interface StatsControlDeps {
  workQueue?: {
    size(agentName: string): number;
    peek(agentName: string): { context: unknown; receivedAt: Date }[];
  };
}

export function registerStatsRoutes(
  app: Hono,
  statsStore?: StatsStore,
  statusTracker?: StatusTracker,
  controlDeps?: StatsControlDeps,
): void {
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

  // Unified activity feed — runs + running instances + pending queue items + dead letters
  app.get("/api/stats/activity", (c) => {
    const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") || "50", 10) || 50));
    const offset = Math.max(0, parseInt(c.req.query("offset") || "0", 10) || 0);
    const agentFilter = c.req.query("agent") || undefined;
    const triggerTypeFilter = c.req.query("triggerType") || undefined;
    const statusFilter = c.req.query("status") || "all";

    // Parse status filter into mem statuses (running/pending) and DB statuses (completed/error/etc)
    const MEM_STATUSES = new Set(["running", "pending"]);
    const DB_STATUSES = new Set(["completed", "error", "rerun", "dead-letter"]);

    let requestedMemStatuses: string[] | undefined; // undefined = no filter on mem
    let requestedDbStatuses: string[] | undefined;  // undefined = no filter on db

    if (statusFilter && statusFilter !== "all") {
      const requested = statusFilter.split(",").map((s: string) => s.trim()).filter(Boolean);
      requestedMemStatuses = requested.filter((s) => MEM_STATUSES.has(s));
      requestedDbStatuses = requested.filter((s) => DB_STATUSES.has(s));
    }

    const includeRunning = requestedMemStatuses === undefined || requestedMemStatuses.includes("running");
    const includePending = requestedMemStatuses === undefined || requestedMemStatuses.includes("pending");
    const includeDb = requestedDbStatuses === undefined || requestedDbStatuses.length > 0;
    const includeDeadLetters = requestedDbStatuses === undefined || requestedDbStatuses.includes("dead-letter");

    // Build in-memory rows (running + pending) applying filters
    const buildMemRows = (): any[] => {
      const memRows: any[] = [];

      // Collect running instances
      if (includeRunning && statusTracker) {
        const running = statusTracker
          .getInstances()
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
        memRows.push(...running);
      }

      // Collect pending queue items
      if (includePending && controlDeps?.workQueue) {
        const agents = statusTracker ? statusTracker.getAllAgents() : [];
        const agentsToCheck = agentFilter
          ? agents.filter((a) => a.name === agentFilter)
          : agents;
        for (const agent of agentsToCheck) {
          const items = controlDeps.workQueue!.peek(agent.name);
          for (const item of items) {
            const ctx = item.context as any;
            let triggerType = "manual";
            let triggerSource: string | null = null;
            let eventSummary: string | null = null;
            if (ctx && typeof ctx === "object") {
              if (ctx.type === "webhook") {
                triggerType = "webhook";
                triggerSource = ctx.context?.source ?? null;
                const wctx = ctx.context;
                if (wctx?.event) {
                  const parts = [wctx.event];
                  if (wctx.action) parts.push(wctx.action);
                  eventSummary = parts.join(" ");
                }
              } else if (ctx.type === "schedule") {
                triggerType = "schedule";
              } else if (ctx.type === "agent-trigger" || ctx.type === "agent") {
                triggerType = "agent";
                triggerSource = ctx.sourceAgent ?? null;
              } else if (ctx.type === "manual") {
                triggerType = "manual";
              } else if (ctx.type) {
                triggerType = ctx.type;
              }
            }
            if (triggerTypeFilter && triggerType !== triggerTypeFilter) continue;
            memRows.push({
              ts: item.receivedAt.getTime(),
              triggerType,
              triggerSource,
              eventSummary,
              agentName: agent.name,
              instanceId: null,
              result: "pending",
              webhookReceiptId: null,
              deadLetterReason: null,
            });
          }
        }
      }

      // Sort: pending first, then running, then by ts descending within each group
      const statusPriority: Record<string, number> = { pending: 0, running: 1 };
      memRows.sort((a, b) => {
        const pa = statusPriority[a.result] ?? 2;
        const pb = statusPriority[b.result] ?? 2;
        if (pa !== pb) return pa - pb;
        return b.ts - a.ts;
      });

      return memRows;
    };

    const memRows = buildMemRows();
    const memCount = memRows.length;
    const pendingCount = memRows.filter((r) => r.result === "pending").length;

    let rows: any[];
    let total: number;

    if (!includeDb || !statsStore) {
      // Only mem rows — no DB query needed
      rows = memRows.slice(offset, offset + limit);
      total = memCount;
    } else {
      // Determine which portion of mem rows to include on this page
      const memSlice = memRows.slice(offset, offset + limit);
      const memSliceLen = memSlice.length;

      // DB pagination: adjust offset to account for mem rows that precede DB rows
      const dbOffset = Math.max(0, offset - memCount);
      const dbLimit = limit - memSliceLen;

      let dbRows: any[] = [];
      if (dbLimit > 0) {
        dbRows = statsStore.queryActivityRows({
          limit: dbLimit,
          offset: dbOffset,
          agentName: agentFilter,
          triggerType: triggerTypeFilter,
          dbStatuses: requestedDbStatuses,
          includeDeadLetters,
        });

        // Dedup: remove DB rows that match a currently-running instance
        // (a run may appear as "running" in tracker AND as "completed" in DB if it just finished)
        const runningIds = new Set(
          memRows
            .filter((r) => r.result === "running")
            .map((r) => r.instanceId)
            .filter(Boolean)
        );
        if (runningIds.size > 0) {
          dbRows = dbRows.filter((r) => !r.instanceId || !runningIds.has(r.instanceId));
        }
      }

      const dbCount = statsStore.countActivityRows({
        agentName: agentFilter,
        triggerType: triggerTypeFilter,
        dbStatuses: requestedDbStatuses,
        includeDeadLetters,
      });

      rows = [...memSlice, ...dbRows];
      total = memCount + dbCount;
    }

    return c.json({ rows, total, pendingCount, limit, offset });
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
