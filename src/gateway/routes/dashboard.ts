import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { renderDashboardPage } from "../views/dashboard-page.js";
import { renderLogsPage } from "../views/logs-page.js";
import { renderLoginPage } from "../views/login-page.js";
import { safeCompare } from "../auth.js";
import type { StatusTracker } from "../../tui/status-tracker.js";
import { readFileSync, readdirSync, statSync } from "fs";
import { resolve } from "path";

function logsDir(projectPath: string): string {
  return resolve(projectPath, ".al", "logs");
}

const SAFE_AGENT_NAME = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

function findLogFiles(projectPath: string, agentName: string): string[] {
  // Reject names that could cause path traversal
  if (!SAFE_AGENT_NAME.test(agentName)) return [];

  const dir = logsDir(projectPath);
  try {
    return readdirSync(dir)
      .filter((f) => f.startsWith(`${agentName}-`) && f.endsWith(".log"))
      .sort()
      .map((f) => resolve(dir, f));
  } catch {
    return [];
  }
}

function readLastNLines(filePath: string, n: number): string[] {
  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());
    return lines.slice(-n);
  } catch {
    return [];
  }
}

export function registerDashboardRoutes(
  app: Hono,
  statusTracker: StatusTracker,
  projectPath?: string,
  apiKey?: string,
): void {
  // Deprecation warning for old env var
  if (process.env.AL_DASHBOARD_SECRET) {
    console.warn(
      "[deprecated] AL_DASHBOARD_SECRET is no longer used. " +
      "The dashboard now uses the gateway API key from ~/.action-llama-credentials/gateway_api_key/default/key. " +
      "Run 'al doctor' to set it up."
    );
  }

  // --- Unprotected routes: login / logout ---

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
      return c.html("", {
        status: 302,
        headers: {
          Location: "/dashboard",
          "Set-Cookie": `al_session=${apiKey}; HttpOnly; SameSite=Strict; Path=/`,
        },
      });
    }
    return c.html(renderLoginPage("Invalid API key"), 401);
  });

  app.post("/logout", (c) => {
    return c.html("", {
      status: 302,
      headers: {
        Location: "/login",
        "Set-Cookie": "al_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
      },
    });
  });

  // Main dashboard page
  app.get("/dashboard", (c) => {
    const agents = statusTracker.getAllAgents();
    const info = statusTracker.getSchedulerInfo();
    const logs = statusTracker.getRecentLogs(20);
    const html = renderDashboardPage(agents, info, logs);
    return c.html(html);
  });

  // Agent logs page
  app.get("/dashboard/agents/:name/logs", (c) => {
    const name = c.req.param("name");
    const html = renderLogsPage(name);
    return c.html(html);
  });

  // SSE: status stream
  app.get("/dashboard/api/status-stream", (c) => {
    return streamSSE(c, async (stream) => {
      const send = () => {
        const agents = statusTracker.getAllAgents();
        const info = statusTracker.getSchedulerInfo();
        const recentLogs = statusTracker.getRecentLogs(20);
        stream.writeSSE({
          data: JSON.stringify({ agents, schedulerInfo: info, recentLogs }),
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

  // SSE: log stream for a specific agent
  app.get("/dashboard/api/logs/:agent/stream", (c) => {
    const agentName = c.req.param("agent");

    return streamSSE(c, async (stream) => {
      // Send historical log entries from file
      if (projectPath) {
        const logFiles = findLogFiles(projectPath, agentName);
        if (logFiles.length > 0) {
          const lastFile = logFiles[logFiles.length - 1];
          const lines = readLastNLines(lastFile, 100);
          if (lines.length > 0) {
            stream.writeSSE({ data: JSON.stringify({ lines }) });
          }
        }
      }

      // Track file position for tailing
      let fileSize = 0;
      let currentFile = "";
      if (projectPath) {
        const logFiles = findLogFiles(projectPath, agentName);
        if (logFiles.length > 0) {
          currentFile = logFiles[logFiles.length - 1];
          try {
            fileSize = statSync(currentFile).size;
          } catch {
            // File may not exist yet
          }
        }
      }

      // Poll for new file data
      const filePoll = setInterval(() => {
        if (!projectPath) return;

        // Check if a new log file appeared
        const logFiles = findLogFiles(projectPath, agentName);
        if (logFiles.length === 0) return;

        const latestFile = logFiles[logFiles.length - 1];
        if (latestFile !== currentFile) {
          currentFile = latestFile;
          fileSize = 0;
        }

        try {
          const stat = statSync(currentFile);
          if (stat.size > fileSize) {
            const fd = readFileSync(currentFile, "utf-8");
            const newContent = fd.slice(fileSize);
            fileSize = stat.size;
            const newLines = newContent.split("\n").filter((l) => l.trim());
            for (const line of newLines) {
              stream.writeSSE({ data: JSON.stringify({ line }) });
            }
          }
        } catch {
          // File read error, skip
        }
      }, 500);

      // Also forward StatusTracker log lines for this agent
      const onUpdate = () => {
        // StatusTracker log lines are already sent via the file poll,
        // but for non-Docker mode where logs go directly through StatusTracker,
        // we listen here as well. The client handles deduplication by display.
      };

      const heartbeat = setInterval(() => {
        stream.writeSSE({ event: "heartbeat", data: "" });
      }, 15000);

      stream.onAbort(() => {
        clearInterval(filePoll);
        clearInterval(heartbeat);
      });

      // Keep stream open
      await new Promise(() => {});
    });
  });
}
