import type { StatusTracker } from "./status-tracker.js";
import type { AgentStatus } from "./status-tracker.js";

export function attachPlainLogger(statusTracker: StatusTracker): { detach: () => void } {
  const prevStates = new Map<string, string>();

  const onUpdate = () => {
    const info = statusTracker.getSchedulerInfo();
    const agents = statusTracker.getAllAgents();

    for (const agent of agents) {
      const key = stateKey(agent);
      if (prevStates.get(agent.name) === key) continue;
      prevStates.set(agent.name, key);

      const ts = new Date().toISOString();
      switch (agent.state) {
        case "building":
          log(ts, agent.name, "building" + (agent.statusText ? `: ${agent.statusText}` : ""));
          break;
        case "running":
          log(ts, agent.name, "running" + (agent.statusText ? `: ${agent.statusText}` : ""));
          break;
        case "error":
          log(ts, agent.name, `error: ${agent.lastError ?? "unknown"}`);
          break;
        case "idle": {
          if (agent.lastRunAt) {
            const dur = agent.lastRunDuration != null ? ` (${(agent.lastRunDuration / 1000).toFixed(1)}s)` : "";
            log(ts, agent.name, `completed${dur}`);
          }
          if (agent.nextRunAt) {
            log(ts, agent.name, `next run: ${agent.nextRunAt.toISOString()}`);
          }
          break;
        }
      }
    }

    // Print any new log lines
    const logs = statusTracker.getRecentLogs(1);
    if (logs.length > 0) {
      const line = logs[logs.length - 1];
      const lineKey = `${line.timestamp.getTime()}:${line.agent}:${line.message}`;
      if (lastLogKey !== lineKey) {
        lastLogKey = lineKey;
        log(line.timestamp.toISOString(), line.agent, line.message);
      }
    }
  };

  let lastLogKey = "";

  // Log scheduler info, re-log when it changes (e.g. webhook URLs populated after startup)
  let lastSchedulerKey = "";
  const onSchedulerInfo = () => {
    const info = statusTracker.getSchedulerInfo();
    if (!info) return;

    const parts = [`mode=${info.mode}`];
    if (info.runtime) parts.push(`runtime=${info.runtime}`);
    if (info.gatewayPort) parts.push(`gateway=:${info.gatewayPort}`);
    parts.push(`cron_jobs=${info.cronJobCount}`);
    if (info.webhooksActive) parts.push(`webhooks=active`);

    // Build a key to detect meaningful changes
    const key = parts.join(",") + "|" + info.webhookUrls.join(",") + "|" + (info.dashboardUrl || "");
    if (key === lastSchedulerKey) return;
    lastSchedulerKey = key;

    const ts = new Date().toISOString();
    console.log(`[${ts}] scheduler started (${parts.join(", ")})`);

    // Log each listening endpoint
    for (const url of info.webhookUrls) {
      console.log(`[${ts}] listening: ${url}`);
    }
    if (info.dashboardUrl) {
      console.log(`[${ts}] dashboard: ${info.dashboardUrl}`);
    }
  };

  const handler = () => {
    onSchedulerInfo();
    onUpdate();
  };

  statusTracker.on("update", handler);

  return {
    detach: () => statusTracker.removeListener("update", handler),
  };
}

function stateKey(agent: AgentStatus): string {
  return `${agent.state}|${agent.statusText}|${agent.lastError}|${agent.lastRunAt?.getTime()}|${agent.lastRunDuration}`;
}

function log(ts: string, agent: string, msg: string): void {
  console.log(`[${ts}] ${agent}: ${msg}`);
}
