import type { Hono, Context, Next } from "hono";
import { streamSSE } from "hono/streaming";
import { renderDashboardPage } from "../views/dashboard-page.js";
import { renderLogsPage } from "../views/logs-page.js";
import type { StatusTracker } from "../../tui/status-tracker.js";
import { readFileSync, readdirSync, statSync } from "fs";
import { resolve } from "path";
import { timingSafeEqual } from "crypto";

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

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function basicAuthMiddleware(secret: string) {
  return async (c: Context, next: Next) => {
    const header = c.req.header("Authorization");
    if (header && header.startsWith("Basic ")) {
      const decoded = Buffer.from(header.slice(6), "base64").toString("utf-8");
      const sep = decoded.indexOf(":");
      if (sep !== -1) {
        const password = decoded.slice(sep + 1);
        if (safeCompare(password, secret)) {
          await next();
          return;
        }
      }
    }
    c.header("WWW-Authenticate", 'Basic realm="Action Llama Dashboard"');
    return c.text("Unauthorized", 401);
  };
}

export function registerDashboardRoutes(
  app: Hono,
  statusTracker: StatusTracker,
  projectPath?: string
): void {
  // Apply basic auth if AL_DASHBOARD_SECRET is set
  const dashboardSecret = process.env.AL_DASHBOARD_SECRET;
  if (dashboardSecret) {
    app.use("/dashboard/*", basicAuthMiddleware(dashboardSecret));
    app.use("/dashboard", basicAuthMiddleware(dashboardSecret));
  } else {
    console.warn(
      "[security] Dashboard is running without authentication. " +
      "Set AL_DASHBOARD_SECRET to require a password."
    );
  }

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
