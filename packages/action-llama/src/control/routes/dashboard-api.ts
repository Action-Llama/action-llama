/**
 * JSON API endpoints for the React dashboard SPA.
 *
 * These replace the server-rendered HTML routes with pure JSON responses,
 * providing the same data that was previously embedded in HTML templates.
 */

import type { Hono } from "hono";
import type { StatusTracker } from "../../tui/status-tracker.js";
import type { StatsStore } from "../../stats/store.js";
import type { SessionStore } from "../session-store.js";
import { safeCompare, type ApiKeySource } from "../auth.js";
import { loadAgentConfig, getProjectScale } from "../../shared/config.js";
import { parseFrontmatter } from "../../shared/frontmatter.js";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

/**
 * Register JSON login/logout routes for the SPA.
 * Unlike the HTML form-based flow, these accept/return JSON.
 */
export function registerAuthApiRoutes(
  app: Hono,
  apiKey?: ApiKeySource,
  sessionStore?: SessionStore,
  hostname?: string,
): void {
  app.post("/api/auth/login", async (c) => {
    if (!apiKey) {
      return c.json({ success: true });
    }
    const currentKey = typeof apiKey === "function" ? await apiKey() : apiKey;
    if (!currentKey) {
      return c.json({ success: true });
    }
    const body = await c.req.json<{ key?: string }>();
    const key = body.key ?? "";
    if (safeCompare(key, currentKey)) {
      let sessionValue: string;
      if (sessionStore) {
        sessionValue = await sessionStore.createSession();
      } else {
        sessionValue = currentKey;
      }
      const isLocalhost = !hostname || hostname === "127.0.0.1" || hostname === "localhost";
      const securePart = isLocalhost ? "" : "; Secure";
      return c.json({ success: true }, {
        headers: {
          "Set-Cookie": `al_session=${sessionValue}; HttpOnly; SameSite=Strict; Path=/${securePart}`,
        },
      });
    }
    return c.json({ error: "Invalid API key" }, 401);
  });

  app.get("/api/auth/check", (c) => {
    // This route is behind auth middleware, so reaching here means authenticated
    return c.json({ authenticated: true });
  });

  app.post("/api/auth/logout", async (c) => {
    if (sessionStore) {
      const cookie = c.req.header("Cookie") || "";
      for (const part of cookie.split(";")) {
        const eq = part.indexOf("=");
        if (eq !== -1 && part.slice(0, eq).trim() === "al_session") {
          await sessionStore.deleteSession(part.slice(eq + 1).trim());
          break;
        }
      }
    }
    return c.json({ success: true }, {
      headers: {
        "Set-Cookie": "al_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
      },
    });
  });
}

/**
 * Register JSON dashboard API routes for the SPA.
 */
export function registerDashboardApiRoutes(
  app: Hono,
  statusTracker: StatusTracker,
  projectPath?: string,
  statsStore?: StatsStore,
): void {
  // Main dashboard status: agents, scheduler info, recent logs
  app.get("/api/dashboard/status", (c) => {
    const agents = statusTracker.getAllAgents();
    const schedulerInfo = statusTracker.getSchedulerInfo();
    const recentLogs = statusTracker.getRecentLogs(20);
    return c.json({ agents, schedulerInfo, recentLogs });
  });

  // Agent detail: config, stats, running instances
  app.get("/api/dashboard/agents/:name", (c) => {
    const name = c.req.param("name");
    const agents = statusTracker.getAllAgents();
    const agent = agents.find((a) => a.name === name) || null;
    const summary = statsStore ? (statsStore.queryAgentSummary({ agent: name })[0] || null) : null;
    const instances = statusTracker.getInstances().filter((i) => i.agentName === name && i.status === "running");
    const totalHistorical = statsStore ? statsStore.countRunsByAgent(name) : 0;

    let agentConfig = null;
    if (projectPath) {
      try {
        agentConfig = loadAgentConfig(projectPath, name);
      } catch {
        // Ignore config loading errors for the API
      }
    }

    return c.json({
      agent,
      agentConfig,
      summary,
      runningInstances: instances,
      totalHistorical,
    });
  });

  // Instance detail: run record, running instance, parent edge, webhook receipt
  app.get("/api/dashboard/agents/:name/instances/:id", (c) => {
    const instanceId = c.req.param("id");
    const run = statsStore ? statsStore.queryRunByInstanceId(instanceId) : null;
    const runningInstance = statusTracker.getInstances().find((i) => i.id === instanceId && i.status === "running") || null;

    let parentEdge: { caller_agent: string; caller_instance: string } | undefined;
    let webhookReceipt: { source: string; eventSummary?: string; deliveryId?: string } | undefined;

    if (statsStore && run) {
      if (run.trigger_type === "agent") {
        const edge = statsStore.queryCallEdgeByTargetInstance(instanceId);
        if (edge) {
          parentEdge = { caller_agent: edge.caller_agent, caller_instance: edge.caller_instance };
        }
      } else if (run.trigger_type === "webhook" && run.webhook_receipt_id) {
        const receipt = statsStore.getWebhookReceipt(run.webhook_receipt_id);
        if (receipt) {
          webhookReceipt = { source: receipt.source, eventSummary: receipt.eventSummary, deliveryId: receipt.deliveryId };
        }
      }
    }

    return c.json({ run, runningInstance, parentEdge, webhookReceipt });
  });

  // Agent skill markdown
  app.get("/api/dashboard/agents/:name/skill", (c) => {
    const name = c.req.param("name");

    if (!projectPath) {
      return c.json({ body: "" }, 404);
    }

    try {
      const skillPath = resolve(projectPath, "agents", name, "SKILL.md");
      if (!existsSync(skillPath)) {
        return c.json({ body: "" }, 404);
      }
      const skillContent = readFileSync(skillPath, "utf-8");
      const { body } = parseFrontmatter(skillContent);

      let agentConfig = null;
      try {
        agentConfig = loadAgentConfig(projectPath, name);
      } catch {
        // Ignore config loading errors
      }

      return c.json({ body, agentConfig });
    } catch {
      return c.json({ body: "" }, 500);
    }
  });

  // Trigger detail by instance ID (unified across all trigger types)
  app.get("/api/dashboard/triggers/:instanceId", (c) => {
    const instanceId = c.req.param("instanceId");

    const run = statsStore?.queryRunByInstanceId(instanceId);

    // Fall back to status tracker for running instances not yet in the DB
    if (!run) {
      const inst = statusTracker.getInstances().find((i) => i.id === instanceId);
      if (!inst) return c.json({ trigger: null }, 404);

      const sep = inst.trigger.indexOf(":");
      const triggerType = sep > -1 ? inst.trigger.slice(0, sep) : inst.trigger;
      const triggerSource = sep > -1 ? inst.trigger.slice(sep + 1).trim() : null;

      return c.json({
        trigger: {
          instanceId: inst.id,
          agentName: inst.agentName,
          triggerType,
          triggerSource,
          triggerContext: null,
          startedAt: new Date(inst.startedAt).getTime(),
        },
      });
    }

    const result: Record<string, unknown> = {
      instanceId: run.instance_id,
      agentName: run.agent_name,
      triggerType: run.trigger_type,
      triggerSource: run.trigger_source ?? null,
      triggerContext: run.trigger_context ?? null,
      startedAt: run.started_at,
    };

    // Enrich with type-specific details (statsStore is guaranteed non-null if run exists)
    if (run.trigger_type === "webhook" && run.webhook_receipt_id && statsStore) {
      const receipt = statsStore.getWebhookReceipt(run.webhook_receipt_id);
      if (receipt) {
        result.webhook = {
          receiptId: receipt.id,
          source: receipt.source,
          eventSummary: receipt.eventSummary ?? null,
          deliveryId: receipt.deliveryId ?? null,
          timestamp: receipt.timestamp,
          headers: receipt.headers ?? null,
          body: receipt.body ?? null,
          matchedAgents: receipt.matchedAgents,
          status: receipt.status,
        };
      }
    }

    if (run.trigger_type === "agent" && statsStore) {
      const edge = statsStore.queryCallEdgeByTargetInstance(instanceId);
      if (edge) {
        result.callerAgent = edge.caller_agent;
        result.callerInstance = edge.caller_instance;
        result.callDepth = edge.depth;
      }
    }

    return c.json({ trigger: result });
  });

  // Project config
  app.get("/api/dashboard/config", (c) => {
    const info = statusTracker.getSchedulerInfo();
    let projectScale = 5;
    if (projectPath) {
      try {
        projectScale = getProjectScale(projectPath);
      } catch {
        // Ignore config loading errors
      }
    }

    return c.json({
      projectName: info?.projectName,
      projectScale,
      gatewayPort: info?.gatewayPort || undefined,
      webhooksActive: info?.webhooksActive || false,
    });
  });
}
