import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { renderDashboardPage } from "../views/dashboard-page.js";
import { renderAgentDetailPage } from "../views/agent-detail-page.js";
import { renderInstanceDetailPage } from "../views/instance-detail-page.js";
import { renderAgentSkillPage } from "../views/agent-skill-page.js";
import { renderLoginPage } from "../views/login-page.js";
import { renderProjectConfigPage } from "../views/project-config-page.js";
import { renderTriggerHistoryPage } from "../views/trigger-history-page.js";
import { safeCompare } from "../auth.js";
import type { StatusTracker } from "../../tui/status-tracker.js";
import type { StatsStore } from "../../stats/store.js";
import type { SessionStore } from "../session-store.js";
import { loadGlobalConfig, loadAgentConfig } from "../../shared/config.js";
import { parseFrontmatter } from "../../shared/frontmatter.js";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

/**
 * Register login/logout routes. Call this whenever auth is active so
 * the auth middleware's redirect to /login always has a target — even
 * when the full dashboard (webUI) is disabled.
 *
 * When a SessionStore is provided, login creates an opaque session ID stored
 * server-side and sets that ID in the cookie. Logout deletes the session.
 * Without a SessionStore the behavior is unchanged (backward compatibility).
 */
export function registerLoginRoutes(app: Hono, apiKey?: string, sessionStore?: SessionStore, hostname?: string): void {
  app.get("/login", (c) => {
    return c.html(renderLoginPage());
  });

  app.post("/login", async (c) => {
    if (!apiKey) {
      // No API key configured — skip auth
      return c.redirect("/dashboard");
    }
    const body = await c.req.parseBody();
    const key = typeof body["key"] === "string" ? body["key"] : "";
    if (safeCompare(key, apiKey)) {
      let sessionValue: string;
      if (sessionStore) {
        sessionValue = await sessionStore.createSession();
      } else {
        sessionValue = apiKey;
      }
      const isLocalhost = !hostname || hostname === "127.0.0.1" || hostname === "localhost";
      const securePart = isLocalhost ? "" : "; Secure";
      return c.html("", {
        status: 302,
        headers: {
          Location: "/dashboard",
          "Set-Cookie": `al_session=${sessionValue}; HttpOnly; SameSite=Strict; Path=/${securePart}`,
        },
      });
    }
    return c.html(renderLoginPage("Invalid API key"), 401);
  });

  app.post("/logout", async (c) => {
    if (sessionStore) {
      const cookie = c.req.header("Cookie") || "";
      const sessionId = parseCookieValue(cookie, "al_session");
      if (sessionId) {
        await sessionStore.deleteSession(sessionId);
      }
    }
    return c.html("", {
      status: 302,
      headers: {
        Location: "/login",
        "Set-Cookie": "al_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
      },
    });
  });
}

function parseCookieValue(header: string, name: string): string | undefined {
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

export function registerDashboardRoutes(
  app: Hono,
  statusTracker: StatusTracker,
  projectPath?: string,
  apiKey?: string,
  statsStore?: StatsStore,
): void {
  // Deprecation warning for old env var
  if (process.env.AL_DASHBOARD_SECRET) {
    console.warn(
      "[deprecated] AL_DASHBOARD_SECRET is no longer used. " +
      "The dashboard now uses the gateway API key from ~/.action-llama/credentials/gateway_api_key/default/key. " +
      "Run 'al doctor' to set it up."
    );
  }

  // Defense in depth: refuse to serve dashboard routes without an API key
  if (!apiKey) {
    app.get("/dashboard", (c) => c.text("Dashboard disabled: No API key configured", 503));
    app.get("/dashboard/*", (c) => c.text("Dashboard disabled: No API key configured", 503));
    return;
  }

  // Main dashboard page
  app.get("/dashboard", (c) => {
    const agents = statusTracker.getAllAgents();
    const info = statusTracker.getSchedulerInfo();
    const logs = statusTracker.getRecentLogs(20);
    const triggerHistory = statsStore
      ? statsStore.queryTriggerHistory({ since: 0, limit: 20, offset: 0, includeDeadLetters: true })
      : undefined;
    const html = renderDashboardPage(agents, info, logs, triggerHistory);
    return c.html(html);
  });

  // Trigger history page
  app.get("/dashboard/triggers", (c) => {
    const page = Math.max(1, parseInt(c.req.query("page") || "1", 10) || 1);
    const limit = 50;
    const includeDeadLetters = c.req.query("all") === "1";
    const offset = (page - 1) * limit;

    if (!statsStore) {
      const html = renderTriggerHistoryPage({ rows: [], total: 0, page: 1, limit, includeDeadLetters });
      return c.html(html);
    }

    const rows = statsStore.queryTriggerHistory({ since: 0, limit, offset, includeDeadLetters });
    const total = statsStore.countTriggerHistory(0, includeDeadLetters);
    const html = renderTriggerHistoryPage({ rows, total, page, limit, includeDeadLetters });
    return c.html(html);
  });

  // Agent detail page
  app.get("/dashboard/agents/:name", (c) => {
    const name = c.req.param("name");
    const agents = statusTracker.getAllAgents();
    const agent = agents.find((a) => a.name === name) || null;
    const summary = statsStore ? (statsStore.queryAgentSummary({ agent: name })[0] || null) : null;
    const instances = statusTracker.getInstances().filter((i) => i.agentName === name && i.status === "running");
    const totalHistorical = statsStore ? statsStore.countRunsByAgent(name) : 0;
    
    // Load agent configuration and feedback settings
    let agentConfig = null;
    let feedbackEnabled: boolean | undefined;
    let globalFeedbackEnabled = false;
    if (projectPath) {
      try {
        const globalConfig = loadGlobalConfig(projectPath);
        globalFeedbackEnabled = globalConfig.feedback?.enabled ?? false;
        
        agentConfig = loadAgentConfig(projectPath, name);
        feedbackEnabled = agentConfig.feedback?.enabled;
      } catch (err) {
        // Ignore config loading errors for the UI
      }
    }
    
    const html = renderAgentDetailPage({ 
      agentName: name, 
      agent,
      agentConfig,
      summary, 
      runningInstances: instances, 
      totalHistorical,
      feedbackEnabled,
      globalFeedbackEnabled,
    });
    return c.html(html);
  });

  // Agent skill page
  app.get("/dashboard/agents/:name/skill", (c) => {
    const name = c.req.param("name");
    
    if (!projectPath) {
      return c.html(renderAgentSkillPage(name, ""), 404);
    }

    try {
      // Load the SKILL.md file and extract the body
      const skillPath = resolve(projectPath, "agents", name, "SKILL.md");
      if (!existsSync(skillPath)) {
        return c.html(renderAgentSkillPage(name, "Agent not found or SKILL.md file is missing."), 404);
      }
      
      const skillContent = readFileSync(skillPath, "utf-8");
      const { body } = parseFrontmatter(skillContent);
      
      const html = renderAgentSkillPage(name, body);
      return c.html(html);
    } catch (err) {
      console.error(`Error loading skill for agent ${name}:`, err);
      return c.html(renderAgentSkillPage(name, "Error loading skill content."), 500);
    }
  });

  // Instance detail page
  app.get("/dashboard/agents/:name/instances/:id", (c) => {
    const name = c.req.param("name");
    const id = c.req.param("id");
    const run = statsStore ? statsStore.queryRunByInstanceId(id) : null;
    const runningInstance = statusTracker.getInstances().find(i => i.id === id) || null;

    let parentEdge: { caller_agent: string; caller_instance: string } | undefined;
    let webhookReceipt: { source: string; eventSummary?: string; deliveryId?: string } | undefined;

    if (statsStore && run) {
      if (run.trigger_type === "agent") {
        const edge = statsStore.queryCallEdgeByTargetInstance(id);
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

    const html = renderInstanceDetailPage({ agentName: name, instanceId: id, run, runningInstance, parentEdge, webhookReceipt });
    return c.html(html);
  });

  // Project configuration page
  app.get("/dashboard/config", (c) => {
    const info = statusTracker.getSchedulerInfo();
    // Load project scale from config if available
    let projectScale = 5; // default
    try {
      if (projectPath) {
        const { getProjectScale } = require("../../shared/config.js");
        projectScale = getProjectScale(projectPath);
      }
    } catch (err) {
      console.warn("Failed to load project scale:", err);
    }
    
    // Load feedback configuration
    let feedbackEnabled = false;
    let feedbackAgent: string | undefined;
    let feedbackErrorPatterns: string[] = ["error", "fail"];
    let feedbackContextLines = 2;
    
    if (projectPath) {
      try {
        const globalConfig = loadGlobalConfig(projectPath);
        if (globalConfig.feedback) {
          feedbackEnabled = globalConfig.feedback.enabled ?? false;
          feedbackAgent = globalConfig.feedback.agent;
          feedbackErrorPatterns = globalConfig.feedback.errorPatterns ?? ["error", "fail"];
          feedbackContextLines = globalConfig.feedback.contextLines ?? 2;
        }
      } catch (err) {
        // Ignore config loading errors for the UI
      }
    }
    
    const html = renderProjectConfigPage({
      projectName: info?.projectName,
      projectScale,
      gatewayPort: info?.gatewayPort || undefined,
      webhooksActive: info?.webhooksActive || false,
      feedbackEnabled,
      feedbackAgent,
      feedbackErrorPatterns,
      feedbackContextLines,
    });
    return c.html(html);
  });

  // Redirect old logs route to agent detail page
  app.get("/dashboard/agents/:name/logs", (c) => {
    const name = c.req.param("name");
    return c.redirect(`/dashboard/agents/${encodeURIComponent(name)}`);
  });

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
      const send = () => {
        const agents = statusTracker.getAllAgents();
        const info = statusTracker.getSchedulerInfo();
        const recentLogs = statusTracker.getRecentLogs(20);
        const instances = statusTracker.getInstances();
        stream.writeSSE({
          data: JSON.stringify({ agents, schedulerInfo: info, recentLogs, instances }),
        });
      };

      // Send initial state
      send();

      // Listen for updates
      statusTracker.on("update", send);

      // Keep connection alive with periodic heartbeats
      const heartbeat = setInterval(() => {
        stream.writeSSE({ event: "heartbeat", data: "" });
      }, 15000);

      // Cleanup on disconnect
      stream.onAbort(() => {
        statusTracker.removeListener("update", send);
        clearInterval(heartbeat);
      });

      // Keep the stream open
      await new Promise(() => {});
    });
  });

}
