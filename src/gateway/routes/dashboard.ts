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

/**
 * Efficiently read the last N lines from a file using reverse reading.
 * This is async to avoid blocking the event loop.
 */
async function readLastNLines(filePath: string, n: number): Promise<string[]> {
  try {
    const { promises: fs } = await import("fs");
    const stat = await fs.stat(filePath);
    const fileSize = stat.size;
    
    if (fileSize === 0) return [];
    
    const fd = await fs.open(filePath, 'r');
    const lines: string[] = [];
    let position = fileSize;
    let buffer = Buffer.alloc(8192); // 8KB chunks
    let remainder = '';
    
    try {
      while (lines.length < n && position > 0) {
        // Calculate how much to read (up to buffer size, but not before start of file)
        const chunkSize = Math.min(buffer.length, position);
        position -= chunkSize;
        
        // Read chunk from file
        const { buffer: readBuffer } = await fd.read(buffer, 0, chunkSize, position);
        const chunk = readBuffer.toString('utf-8', 0, chunkSize);
        
        // Combine with any remainder from previous iteration and split by newlines
        const text = chunk + remainder;
        const parts = text.split('\n');
        
        // The first part becomes the new remainder (since we're reading backwards)
        remainder = parts[0];
        
        // Add lines in reverse order (excluding the first part which is incomplete)
        for (let i = parts.length - 1; i >= 1; i--) {
          const line = parts[i];
          if (line.trim()) { // Skip empty lines
            lines.unshift(line);
            if (lines.length >= n) break;
          }
        }
      }
      
      // Handle any remaining text if we've read the whole file
      if (position === 0 && remainder.trim()) {
        lines.unshift(remainder);
        if (lines.length > n) {
          lines.splice(0, lines.length - n);
        }
      }
    } finally {
      await fd.close();
    }
    
    return lines.slice(-n); // Ensure we return exactly n lines (or fewer if file is smaller)
  } catch {
    return [];
  }
}

/**
 * Register login/logout routes. Call this whenever auth is active so
 * the auth middleware's redirect to /login always has a target — even
 * when the full dashboard (webUI) is disabled.
 */
export function registerLoginRoutes(app: Hono, apiKey?: string): void {
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
      "The dashboard now uses the gateway API key from ~/.action-llama/credentials/gateway_api_key/default/key. " +
      "Run 'al doctor' to set it up."
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
          const lines = await readLastNLines(lastFile, 100);
          if (lines.length > 0) {
            stream.writeSSE({ data: JSON.stringify({ lines }) });
          }
        }
      }

      // Track file position for tailing
      let fileSize = 0;
      let currentFile = "";
      let watcher: import("fs").FSWatcher | null = null;
      let fallbackPoll: NodeJS.Timeout | null = null;

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

      const readNewData = async () => {
        if (!projectPath) return;

        // Check if a new log file appeared
        const logFiles = findLogFiles(projectPath, agentName);
        if (logFiles.length === 0) return;

        const latestFile = logFiles[logFiles.length - 1];
        if (latestFile !== currentFile) {
          // Switch to new file and restart watching
          if (watcher) {
            watcher.close();
            watcher = null;
          }
          currentFile = latestFile;
          fileSize = 0;
          
          // Start watching the new file
          try {
            const { watch } = await import("fs");
            watcher = watch(currentFile, { persistent: false }, () => readNewData());
          } catch {
            // fs.watch failed for new file, rely on fallback polling
          }
        }

        try {
          const { promises: fs } = await import("fs");
          const stat = await fs.stat(currentFile);
          if (stat.size > fileSize) {
            const fd = await fs.open(currentFile, 'r');
            try {
              const buffer = Buffer.alloc(stat.size - fileSize);
              await fd.read(buffer, 0, buffer.length, fileSize);
              const newContent = buffer.toString('utf-8');
              fileSize = stat.size;
              const newLines = newContent.split("\n").filter((l) => l.trim());
              for (const line of newLines) {
                stream.writeSSE({ data: JSON.stringify({ line }) });
              }
            } finally {
              await fd.close();
            }
          }
        } catch {
          // File read error, skip
        }
      };

      // Set up file watching with fallback polling
      if (currentFile) {
        try {
          const { watch } = await import("fs");
          watcher = watch(currentFile, { persistent: false }, () => readNewData());
          // Still use a fallback poll but with longer interval since watch should catch most changes
          fallbackPoll = setInterval(readNewData, 2000);
        } catch {
          // fs.watch not available, use polling only
          fallbackPoll = setInterval(readNewData, 500);
        }
      } else {
        // No current file, just poll for new files
        fallbackPoll = setInterval(readNewData, 1000);
      }

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
        if (watcher) watcher.close();
        if (fallbackPoll) clearInterval(fallbackPoll);
        clearInterval(heartbeat);
      });

      // Keep stream open
      await new Promise(() => {});
    });
  });
}
