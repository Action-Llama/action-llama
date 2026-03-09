import type { AgentStatus, SchedulerInfo, LogLine } from "../../tui/status-tracker.js";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stateColor(state: AgentStatus["state"]): string {
  switch (state) {
    case "running": return "#22c55e";
    case "building": return "#eab308";
    case "error": return "#ef4444";
    case "idle": return "#6b7280";
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function formatTime(date: Date | null): string {
  if (!date) return "\u2014";
  return date.toLocaleTimeString();
}

function formatLogLine(log: LogLine): string {
  const time = log.timestamp.toLocaleTimeString();
  return `<span class="log-time">${escapeHtml(time)}</span> <span class="log-agent">[${escapeHtml(log.agent)}]</span> ${escapeHtml(log.message)}`;
}

function formatScale(agent: AgentStatus): string {
  if (agent.state === "running" && agent.scale > 1) return `running ${agent.runningCount}/${agent.scale}`;
  if (agent.scale > 1) return `${agent.state} (\u00d7${agent.scale})`;
  return agent.state;
}

function renderAgentRow(agent: AgentStatus): string {
  const color = stateColor(agent.state);
  const statusText = agent.statusText || agent.lastError || "\u2014";
  return `<tr>
    <td><a href="/dashboard/agents/${escapeHtml(agent.name)}/logs">${escapeHtml(agent.name)}</a></td>
    <td><span class="state-dot" style="background:${color}"></span> ${escapeHtml(formatScale(agent))}</td>
    <td class="status-text">${escapeHtml(statusText)}</td>
    <td>${formatTime(agent.lastRunAt)}</td>
    <td>${agent.lastRunDuration != null ? formatDuration(agent.lastRunDuration) : "\u2014"}</td>
    <td>${formatTime(agent.nextRunAt)}</td>
  </tr>`;
}

function renderAgentCard(agent: AgentStatus): string {
  const color = stateColor(agent.state);
  const statusText = agent.statusText || agent.lastError || "\u2014";
  return `<a href="/dashboard/agents/${escapeHtml(agent.name)}/logs" class="agent-card">
    <div class="card-header">
      <span class="card-name">${escapeHtml(agent.name)}</span>
      <span><span class="state-dot" style="background:${color}"></span>${escapeHtml(formatScale(agent))}</span>
    </div>
    <div class="card-status">${escapeHtml(statusText)}</div>
    <div class="card-meta">
      <span>Last: ${formatTime(agent.lastRunAt)}</span>
      <span>${agent.lastRunDuration != null ? formatDuration(agent.lastRunDuration) : ""}</span>
      <span>Next: ${formatTime(agent.nextRunAt)}</span>
    </div>
  </a>`;
}

export function renderDashboardPage(agents: AgentStatus[], schedulerInfo: SchedulerInfo | null, recentLogs: LogLine[]): string {
  const mode = schedulerInfo?.mode || "host";
  const runtime = schedulerInfo?.runtime || "\u2014";
  const uptime = schedulerInfo ? formatDuration(Date.now() - schedulerInfo.startedAt.getTime()) : "\u2014";
  const cronCount = schedulerInfo?.cronJobCount || 0;
  const webhooks = schedulerInfo?.webhooksActive ? "active" : "inactive";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Action Llama Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background: #0f172a; color: #e2e8f0; padding: 16px; }
  h1 { font-size: 1.5rem; margin-bottom: 8px; color: #f8fafc; }
  .header { display: flex; align-items: baseline; gap: 12px 20px; margin-bottom: 24px; flex-wrap: wrap; }
  .header-stat { font-size: 0.85rem; color: #94a3b8; white-space: nowrap; }
  .header-stat strong { color: #cbd5e1; }

  /* Desktop table */
  .agent-table { width: 100%; border-collapse: collapse; margin-bottom: 32px; }
  .agent-table th { text-align: left; padding: 8px 12px; border-bottom: 2px solid #334155; color: #94a3b8; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; }
  .agent-table td { padding: 8px 12px; border-bottom: 1px solid #1e293b; font-size: 0.9rem; }
  .agent-table td a { color: #60a5fa; text-decoration: none; }
  .agent-table td a:hover { text-decoration: underline; }
  .agent-table tr:hover { background: #1e293b; }
  .status-text { max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #94a3b8; }

  /* Mobile cards (hidden on desktop) */
  .agent-cards { display: none; margin-bottom: 24px; }
  .agent-card { display: block; background: #1e293b; border-radius: 8px; padding: 12px 16px; margin-bottom: 8px; text-decoration: none; color: #e2e8f0; border: 1px solid #334155; }
  .agent-card:active { background: #334155; }
  .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  .card-name { color: #60a5fa; font-weight: 600; font-size: 0.95rem; }
  .card-status { color: #94a3b8; font-size: 0.8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-bottom: 6px; }
  .card-meta { display: flex; gap: 12px; font-size: 0.75rem; color: #64748b; flex-wrap: wrap; }

  .state-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }

  h2 { font-size: 1.1rem; margin-bottom: 12px; color: #f8fafc; }
  .logs { background: #1e293b; border-radius: 8px; padding: 12px; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.75rem; line-height: 1.6; max-height: 300px; overflow-y: auto; }
  .log-line { white-space: pre-wrap; word-break: break-all; }
  .log-time { color: #64748b; }
  .log-agent { color: #818cf8; }
  .empty { color: #475569; font-style: italic; }

  @media (max-width: 640px) {
    body { padding: 12px; }
    h1 { font-size: 1.25rem; }
    .header { gap: 6px 14px; margin-bottom: 16px; }
    .header-stat { font-size: 0.75rem; }
    .agent-table { display: none; }
    .agent-cards { display: block; }
    .logs { font-size: 0.7rem; padding: 10px; max-height: 250px; }
  }

  @media (min-width: 641px) {
    body { padding: 24px; }
    .logs { font-size: 0.8rem; padding: 16px; }
  }
</style>
</head>
<body>
  <div class="header">
    <h1>Action Llama</h1>
    <span class="header-stat">Mode: <strong>${escapeHtml(mode)}</strong></span>
    <span class="header-stat">Runtime: <strong>${escapeHtml(runtime)}</strong></span>
    <span class="header-stat">Agents: <strong>${agents.length}</strong></span>
    <span class="header-stat">Cron: <strong>${cronCount}</strong></span>
    <span class="header-stat">Webhooks: <strong>${escapeHtml(webhooks)}</strong></span>
    <span class="header-stat">Uptime: <strong id="uptime">${escapeHtml(uptime)}</strong></span>
  </div>

  <table class="agent-table">
    <thead>
      <tr>
        <th>Agent</th>
        <th>State</th>
        <th>Status</th>
        <th>Last Run</th>
        <th>Duration</th>
        <th>Next Run</th>
      </tr>
    </thead>
    <tbody id="agent-table-body">
      ${agents.length > 0 ? agents.map(renderAgentRow).join("\n      ") : '<tr><td colspan="6" class="empty">No agents registered</td></tr>'}
    </tbody>
  </table>

  <div class="agent-cards" id="agent-cards">
    ${agents.length > 0 ? agents.map(renderAgentCard).join("\n    ") : '<div class="empty">No agents registered</div>'}
  </div>

  <h2>Recent Activity</h2>
  <div class="logs" id="recent-logs">
    ${recentLogs.length > 0 ? recentLogs.map((l) => `<div class="log-line">${formatLogLine(l)}</div>`).join("\n    ") : '<div class="empty">No recent activity</div>'}
  </div>

  <script>
    const stateColors = { running: "#22c55e", building: "#eab308", error: "#ef4444", idle: "#6b7280" };

    function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

    function fmtDur(ms) {
      if (ms < 1000) return ms + "ms";
      const s = Math.floor(ms / 1000);
      if (s < 60) return s + "s";
      return Math.floor(s / 60) + "m " + (s % 60) + "s";
    }

    function fmtTime(iso) {
      if (!iso) return "\\u2014";
      return new Date(iso).toLocaleTimeString();
    }

    function fmtScale(a) {
      if (a.state === "running" && a.scale > 1) return "running " + a.runningCount + "/" + a.scale;
      if (a.scale > 1) return a.state + " (\\u00d7" + a.scale + ")";
      return a.state;
    }

    function renderRow(a) {
      const color = stateColors[a.state] || "#6b7280";
      const status = a.statusText || a.lastError || "\\u2014";
      return '<tr>' +
        '<td><a href="/dashboard/agents/' + esc(a.name) + '/logs">' + esc(a.name) + '</a></td>' +
        '<td><span class="state-dot" style="background:' + color + '"></span> ' + esc(fmtScale(a)) + '</td>' +
        '<td class="status-text">' + esc(status) + '</td>' +
        '<td>' + fmtTime(a.lastRunAt) + '</td>' +
        '<td>' + (a.lastRunDuration != null ? fmtDur(a.lastRunDuration) : "\\u2014") + '</td>' +
        '<td>' + fmtTime(a.nextRunAt) + '</td>' +
        '</tr>';
    }

    function renderCard(a) {
      const color = stateColors[a.state] || "#6b7280";
      const status = a.statusText || a.lastError || "\\u2014";
      return '<a href="/dashboard/agents/' + esc(a.name) + '/logs" class="agent-card">' +
        '<div class="card-header"><span class="card-name">' + esc(a.name) + '</span>' +
        '<span><span class="state-dot" style="background:' + color + '"></span>' + esc(fmtScale(a)) + '</span></div>' +
        '<div class="card-status">' + esc(status) + '</div>' +
        '<div class="card-meta"><span>Last: ' + fmtTime(a.lastRunAt) + '</span>' +
        '<span>' + (a.lastRunDuration != null ? fmtDur(a.lastRunDuration) : "") + '</span>' +
        '<span>Next: ' + fmtTime(a.nextRunAt) + '</span></div></a>';
    }

    function renderLog(l) {
      const t = new Date(l.timestamp).toLocaleTimeString();
      return '<div class="log-line"><span class="log-time">' + esc(t) + '</span> <span class="log-agent">[' + esc(l.agent) + ']</span> ' + esc(l.message) + '</div>';
    }

    const es = new EventSource("/dashboard/api/status-stream");
    es.onmessage = function(e) {
      const data = JSON.parse(e.data);

      if (data.agents) {
        // Update desktop table
        const tbody = document.getElementById("agent-table-body");
        if (data.agents.length > 0) {
          tbody.innerHTML = data.agents.map(renderRow).join("");
        } else {
          tbody.innerHTML = '<tr><td colspan="6" class="empty">No agents registered</td></tr>';
        }

        // Update mobile cards
        const cards = document.getElementById("agent-cards");
        if (data.agents.length > 0) {
          cards.innerHTML = data.agents.map(renderCard).join("");
        } else {
          cards.innerHTML = '<div class="empty">No agents registered</div>';
        }
      }

      // Update recent logs
      const logsDiv = document.getElementById("recent-logs");
      if (data.recentLogs && data.recentLogs.length > 0) {
        logsDiv.innerHTML = data.recentLogs.map(renderLog).join("");
        logsDiv.scrollTop = logsDiv.scrollHeight;
      }

      // Update uptime
      if (data.schedulerInfo && data.schedulerInfo.startedAt) {
        document.getElementById("uptime").textContent = fmtDur(Date.now() - new Date(data.schedulerInfo.startedAt).getTime());
      }
    };
  </script>
</body>
</html>`;
}
