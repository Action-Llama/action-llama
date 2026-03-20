import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { spawn } from "child_process";
import { resolve } from "path";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname } from "path";
import {
  discoverAgents,
  loadAgentConfig,
  loadAgentBody,
  loadGlobalConfig,
} from "../shared/config.js";
import { gatewayFetch, gatewayJson } from "../cli/gateway-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, "../../package.json"), "utf-8"));

// --- Gateway helper ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GatewayResult =
  | { ok: true; data: any; status: number }
  | { ok: false; error: string; status?: number };

async function callGateway(
  projectPath: string,
  envName: string | undefined,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<GatewayResult> {
  try {
    const response = await gatewayFetch({
      project: projectPath,
      path,
      method,
      body,
      env: envName,
    });
    const data = await gatewayJson(response);
    if (response.ok) {
      return { ok: true, data, status: response.status };
    }
    return { ok: false, error: data.error || `HTTP ${response.status}`, status: response.status };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
      return { ok: false, error: "Scheduler not running. Start it with the al_start tool or 'al start' in a terminal." };
    }
    return { ok: false, error: msg };
  }
}

function text(content: string) {
  return { content: [{ type: "text" as const, text: content }] };
}

// --- Log formatting ---

interface LogEntry {
  msg: string;
  level: number;
  time: number;
  text?: string;
  cmd?: string;
  tool?: string;
  err?: string;
  instance?: string;
  [key: string]: unknown;
}

const LEVEL_NAMES: Record<number, string> = {
  10: "trace",
  20: "debug",
  30: "info",
  40: "warn",
  50: "error",
  60: "fatal",
};

const LEVEL_VALUES: Record<string, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

function formatLogEntries(entries: LogEntry[], raw: boolean, level?: string): string {
  let filtered = entries;
  if (level && LEVEL_VALUES[level] !== undefined) {
    const minLevel = LEVEL_VALUES[level];
    filtered = entries.filter((e) => e.level >= minLevel);
  }

  if (raw) {
    return filtered.map((e) => JSON.stringify(e)).join("\n");
  }

  // Conversation-style formatting
  const lines: string[] = [];
  for (const entry of filtered) {
    const ts = new Date(entry.time).toISOString().slice(11, 19);
    const lvl = LEVEL_NAMES[entry.level] || String(entry.level);

    if (entry.text) {
      lines.push(`[${ts}] assistant: ${entry.text}`);
    } else if (entry.cmd) {
      lines.push(`[${ts}] bash: ${entry.cmd}`);
    } else if (entry.tool && entry.msg === "tool_start") {
      lines.push(`[${ts}] tool: ${entry.tool}`);
    } else if (entry.err) {
      lines.push(`[${ts}] error: ${entry.err}`);
    } else if (lvl === "debug") {
      continue; // skip noise
    } else if (entry.msg === "tool_done") {
      continue; // skip noise
    } else {
      lines.push(`[${ts}] ${lvl}: ${entry.msg}`);
    }
  }
  return lines.join("\n") || "(no log entries)";
}

// --- MCP server ---

export async function startMcpServer(opts: {
  projectPath: string;
  envName?: string;
}): Promise<void> {
  const { projectPath, envName } = opts;

  const server = new McpServer({
    name: "action-llama",
    version: pkg.version,
  });

  // Helper to get gateway base URL for al_start polling
  function getBaseUrl(): string {
    try {
      const globalConfig = loadGlobalConfig(projectPath, envName);
      const port = globalConfig.gateway?.port || 8080;
      return globalConfig.gateway?.url || `http://localhost:${port}`;
    } catch {
      return "http://localhost:8080";
    }
  }

  // --- Tools ---

  server.tool(
    "al_start",
    "Start the Action Llama scheduler. Spawns 'al start --headless' as a background process and waits for the gateway to become ready.",
    {},
    async () => {
      // Check if already running
      try {
        const res = await fetch(`${getBaseUrl()}/health`);
        if (res.ok) return text("Scheduler is already running.");
      } catch { /* not running */ }

      const args = ["start", "--headless", "-p", projectPath];
      if (envName) args.push("-E", envName);
      const child = spawn("al", args, { detached: true, stdio: "ignore" });
      child.unref();

      // Poll /health until ready
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 500));
        try {
          const res = await fetch(`${getBaseUrl()}/health`);
          if (res.ok) return text("Scheduler started.");
        } catch { /* not ready yet */ }
      }
      return text("Scheduler process spawned but gateway not responding yet. It may still be starting up.");
    },
  );

  server.tool(
    "al_stop",
    "Gracefully stop the Action Llama scheduler.",
    {},
    async () => {
      const result = await callGateway(projectPath, envName, "/control/stop", "POST");
      if (result.ok) return text(result.data.message || "Scheduler stopped.");
      return text(`Failed to stop: ${result.error}`);
    },
  );

  server.tool(
    "al_status",
    "Show scheduler status, agent states, running instances, and queue sizes.",
    {},
    async () => {
      const result = await callGateway(projectPath, envName, "/control/status");
      if (!result.ok) return text(`Failed to get status: ${result.error}`);

      const d = result.data;
      const lines: string[] = [];
      lines.push(`Scheduler: ${d.state || "unknown"}`);
      if (d.uptime) lines.push(`Uptime: ${Math.round(d.uptime)}s`);

      if (d.agents && Array.isArray(d.agents)) {
        lines.push("");
        lines.push("Agents:");
        for (const a of d.agents) {
          const parts = [`  ${a.name}: ${a.state || a.status || "unknown"}`];
          if (a.running !== undefined) parts.push(`running=${a.running}`);
          if (a.queued !== undefined) parts.push(`queued=${a.queued}`);
          if (a.schedule) parts.push(`schedule="${a.schedule}"`);
          lines.push(parts.join(" "));
        }
      }

      if (d.instances && Array.isArray(d.instances) && d.instances.length > 0) {
        lines.push("");
        lines.push("Running instances:");
        for (const inst of d.instances) {
          lines.push(`  ${inst.id || inst.instanceId}: ${inst.agent} (started ${inst.startedAt || "unknown"})`);
        }
      }

      return text(lines.join("\n"));
    },
  );

  server.tool(
    "al_agents",
    "List agents in the project with their config, schedule, and webhook triggers. Optionally get details for a specific agent including SKILL.md body. Works offline (reads filesystem); enriches with live status when the gateway is running.",
    { name: z.string().optional().describe("Agent name to get details for (omit to list all)") },
    async ({ name }) => {
      const agents = discoverAgents(projectPath);
      if (agents.length === 0) return text("No agents found in this project.");

      if (name) {
        if (!agents.includes(name)) return text(`Agent "${name}" not found. Available: ${agents.join(", ")}`);
        const config = loadAgentConfig(projectPath, name);
        const body = loadAgentBody(projectPath, name);

        const lines: string[] = [`# ${name}`];
        if (config.description) lines.push(`Description: ${config.description}`);
        if (config.schedule) lines.push(`Schedule: ${config.schedule}`);
        if (config.webhooks?.length) lines.push(`Webhooks: ${config.webhooks.map((w) => `${w.source}:${(w.events || []).join(",")}`).join(", ")}`);
        lines.push(`Models: ${config.models.length > 0 ? config.models.map(m => `${m.provider}/${m.model}`).join(", ") : "none"}`);
        if (config.credentials?.length) lines.push(`Credentials: ${config.credentials.join(", ")}`);
        if (config.scale && config.scale > 1) lines.push(`Scale: ${config.scale}`);
        if (config.timeout) lines.push(`Timeout: ${config.timeout}s`);

        // Try to enrich with live status
        const statusResult = await callGateway(projectPath, envName, "/control/status");
        if (statusResult.ok && statusResult.data.agents) {
          const live = statusResult.data.agents.find((a: { name: string }) => a.name === name);
          if (live) {
            lines.push("");
            lines.push(`Live state: ${live.state || live.status || "unknown"}`);
            if (live.running !== undefined) lines.push(`Running instances: ${live.running}`);
          }
        }

        if (body.trim()) {
          lines.push("");
          lines.push("---");
          lines.push(body.trim());
        }

        return text(lines.join("\n"));
      }

      // List all agents
      const lines: string[] = [];

      // Try to get live status for enrichment
      const statusResult = await callGateway(projectPath, envName, "/control/status");
      const liveMap = new Map<string, Record<string, unknown>>();
      if (statusResult.ok && statusResult.data.agents) {
        for (const a of statusResult.data.agents) {
          liveMap.set(a.name, a);
        }
      }

      for (const agentName of agents) {
        try {
          const config = loadAgentConfig(projectPath, agentName);
          const parts: string[] = [`**${agentName}**`];
          if (config.description) parts.push(`— ${config.description}`);
          if (config.schedule) parts.push(`| schedule: ${config.schedule}`);
          if (config.webhooks?.length) parts.push(`| webhooks: ${config.webhooks.map((w) => `${w.source}:${(w.events || []).join(",")}`).join(", ")}`);
          const live = liveMap.get(agentName);
          if (live) parts.push(`| state: ${live.state || live.status || "unknown"}`);
          lines.push(parts.join(" "));
        } catch {
          lines.push(`**${agentName}** — (config error)`);
        }
      }

      return text(lines.join("\n"));
    },
  );

  server.tool(
    "al_run",
    "Manually trigger an agent run.",
    { name: z.string().describe("Agent name to run") },
    async ({ name }) => {
      const result = await callGateway(projectPath, envName, `/control/trigger/${encodeURIComponent(name)}`, "POST");
      if (result.ok) return text(result.data.message || `Triggered ${name}.`);
      return text(`Failed to trigger ${name}: ${result.error}`);
    },
  );

  server.tool(
    "al_logs",
    "View agent or scheduler logs. Supports time filtering, instance filtering, and level filtering.",
    {
      name: z.string().describe('Agent name, or "scheduler" for scheduler logs'),
      lines: z.number().optional().default(100).describe("Number of log entries to fetch (max 1000)"),
      instance: z.string().optional().describe("Instance ID to filter (for scale > 1 agents)"),
      after: z.string().optional().describe("ISO 8601 timestamp — only entries after this time"),
      before: z.string().optional().describe("ISO 8601 timestamp — only entries before this time"),
      level: z.enum(["trace", "debug", "info", "warn", "error"]).optional().describe("Minimum log level"),
      raw: z.boolean().optional().default(false).describe("Return full JSON log entries instead of conversation view"),
    },
    async ({ name, lines, instance, after, before, level, raw }) => {
      const clampedLines = Math.min(Math.max(lines, 1), 1000);
      const params = new URLSearchParams({ lines: String(clampedLines) });
      if (after) params.set("after", String(new Date(after).getTime()));
      if (before) params.set("before", String(new Date(before).getTime()));

      let path: string;
      if (name === "scheduler") {
        path = `/api/logs/scheduler?${params}`;
      } else if (instance) {
        path = `/api/logs/agents/${encodeURIComponent(name)}/${encodeURIComponent(instance)}?${params}`;
      } else {
        path = `/api/logs/agents/${encodeURIComponent(name)}?${params}`;
      }

      const result = await callGateway(projectPath, envName, path);
      if (!result.ok) return text(`Failed to fetch logs: ${result.error}`);

      const entries: LogEntry[] = result.data.entries || result.data || [];
      if (!Array.isArray(entries) || entries.length === 0) return text("(no log entries)");

      return text(formatLogEntries(entries, raw, level));
    },
  );

  server.tool(
    "al_pause",
    "Pause the scheduler (all agents) or a single agent by name.",
    { name: z.string().optional().describe("Agent name to pause (omit to pause entire scheduler)") },
    async ({ name }) => {
      const path = name
        ? `/control/agents/${encodeURIComponent(name)}/pause`
        : "/control/pause";
      const result = await callGateway(projectPath, envName, path, "POST");
      if (result.ok) return text(result.data.message || `Paused ${name || "scheduler"}.`);
      return text(`Failed to pause: ${result.error}`);
    },
  );

  server.tool(
    "al_resume",
    "Resume the scheduler (all agents) or a single agent by name.",
    { name: z.string().optional().describe("Agent name to resume (omit to resume entire scheduler)") },
    async ({ name }) => {
      const path = name
        ? `/control/agents/${encodeURIComponent(name)}/resume`
        : "/control/resume";
      const result = await callGateway(projectPath, envName, path, "POST");
      if (result.ok) return text(result.data.message || `Resumed ${name || "scheduler"}.`);
      return text(`Failed to resume: ${result.error}`);
    },
  );

  server.tool(
    "al_kill",
    "Kill an agent (all instances) or a single instance by ID.",
    { target: z.string().describe("Agent name or instance ID") },
    async ({ target }) => {
      // Try agent-level kill first
      const result = await callGateway(
        projectPath,
        envName,
        `/control/agents/${encodeURIComponent(target)}/kill`,
        "POST",
      );
      if (result.ok) return text(result.data.message || `Killed ${target}.`);

      // On 404, try instance-level kill
      if (result.status === 404) {
        const instResult = await callGateway(
          projectPath,
          envName,
          `/control/kill/${encodeURIComponent(target)}`,
          "POST",
        );
        if (instResult.ok) return text(instResult.data.message || `Killed instance ${target}.`);
        return text(`Failed to kill: ${instResult.error}`);
      }

      return text(`Failed to kill: ${result.error}`);
    },
  );

  // --- Resources ---

  server.resource(
    "agent-skill",
    new ResourceTemplate("al://agents/{name}/skill", { list: undefined }),
    async (uri, { name }) => {
      const agentName = Array.isArray(name) ? name[0] : name;
      const body = loadAgentBody(projectPath, agentName);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: body || "(empty SKILL.md)",
          },
        ],
      };
    },
  );

  // --- Connect ---

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
