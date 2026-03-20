import type { AgentStatus, SchedulerInfo, LogLine } from "../../tui/status-tracker.js";
import { escapeHtml, formatDuration, formatTime, formatCost, formatTokens, renderLayout } from "./layout.js";

interface GlobalSummary {
  totalRuns: number;
  okRuns: number;
  errorRuns: number;
  totalTokens: number;
  totalCost: number;
}

function stateColor(state: AgentStatus["state"]): { dot: string; text: string } {
  switch (state) {
    case "running": return { dot: "bg-green-500", text: "text-green-600 dark:text-green-400" };
    case "building": return { dot: "bg-yellow-500", text: "text-yellow-600 dark:text-yellow-400" };
    case "error": return { dot: "bg-red-500", text: "text-red-600 dark:text-red-400" };
    case "idle": return { dot: "bg-slate-400", text: "text-slate-500 dark:text-slate-400" };
  }
}

function formatScale(agent: AgentStatus): string {
  if (agent.state === "running" && agent.scale > 1) return `running ${agent.runningCount}/${agent.scale}`;
  if (agent.scale > 1) return `${agent.state} (\u00d7${agent.scale})`;
  return agent.state;
}

function renderStatCard(label: string, value: string, id?: string): string {
  const idAttr = id ? ` id="${id}"` : "";
  return `<div class="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-3 sm:p-4">
    <div class="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">${escapeHtml(label)}</div>
    <div class="text-lg sm:text-xl font-semibold text-slate-900 dark:text-white"${idAttr}>${value}</div>
  </div>`;
}

function renderAgentRow(agent: AgentStatus): string {
  const colors = stateColor(agent.state);
  const statusText = agent.statusText || agent.lastError || "\u2014";
  const toggleLabel = agent.enabled ? "Disable" : "Enable";
  const toggleAction = agent.enabled ? "disable" : "enable";
  const descHtml = agent.description
    ? `<div class="text-xs text-slate-400 mt-0.5">${escapeHtml(agent.description)}</div>`
    : "";
  return `<tr data-agent="${escapeHtml(agent.name)}" class="hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors">
    <td class="px-3 py-2.5">
      <a href="/dashboard/agents/${escapeHtml(agent.name)}" class="text-blue-600 dark:text-blue-400 hover:underline font-medium">${escapeHtml(agent.name)}</a>
      ${descHtml}
    </td>
    <td class="px-3 py-2.5"><span class="state-dot ${colors.dot} mr-1.5 inline-block"></span><span class="${colors.text} text-sm">${escapeHtml(formatScale(agent))}</span></td>
    <td class="px-3 py-2.5 max-w-[300px] truncate text-slate-500 dark:text-slate-400 text-sm">${escapeHtml(statusText)}</td>
    <td class="px-3 py-2.5 text-sm text-slate-600 dark:text-slate-300">${formatTime(agent.lastRunAt)}</td>
    <td class="px-3 py-2.5 text-sm text-slate-600 dark:text-slate-300">${agent.lastRunDuration != null ? formatDuration(agent.lastRunDuration) : "\u2014"}</td>
    <td class="px-3 py-2.5 text-sm text-slate-600 dark:text-slate-300">${formatTime(agent.nextRunAt)}</td>
    <td class="px-3 py-2.5 whitespace-nowrap">
      <button class="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors mr-1" onclick="triggerAgent('${escapeHtml(agent.name)}')">Run</button>
      <button class="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-600 bg-transparent hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors" onclick="toggleAgent('${escapeHtml(agent.name)}','${toggleAction}')">${toggleLabel}</button>
    </td>
  </tr>`;
}

function renderAgentCard(agent: AgentStatus): string {
  const colors = stateColor(agent.state);
  const statusText = agent.statusText || agent.lastError || "\u2014";
  const toggleLabel = agent.enabled ? "Disable" : "Enable";
  const toggleAction = agent.enabled ? "disable" : "enable";
  const descHtml = agent.description
    ? `<div class="text-xs text-slate-400 mb-1">${escapeHtml(agent.description)}</div>`
    : "";
  return `<div class="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-3 mb-2">
    <a href="/dashboard/agents/${escapeHtml(agent.name)}" class="block">
      <div class="flex justify-between items-center mb-1">
        <span class="text-blue-600 dark:text-blue-400 font-semibold text-sm">${escapeHtml(agent.name)}</span>
        <span class="text-xs ${colors.text}"><span class="state-dot ${colors.dot} mr-1 inline-block"></span>${escapeHtml(formatScale(agent))}</span>
      </div>
      ${descHtml}
      <div class="text-xs text-slate-500 dark:text-slate-400 truncate mb-1.5">${escapeHtml(statusText)}</div>
      <div class="flex gap-3 text-xs text-slate-400">
        <span>Last: ${formatTime(agent.lastRunAt)}</span>
        <span>${agent.lastRunDuration != null ? formatDuration(agent.lastRunDuration) : ""}</span>
        <span>Next: ${formatTime(agent.nextRunAt)}</span>
      </div>
    </a>
    <div class="flex gap-2 mt-2 pt-2 border-t border-slate-100 dark:border-slate-800">
      <button class="px-2.5 py-1 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors" onclick="triggerAgent('${escapeHtml(agent.name)}')">Run</button>
      <button class="px-2.5 py-1 text-xs rounded border border-slate-300 dark:border-slate-600 bg-transparent hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors" onclick="toggleAgent('${escapeHtml(agent.name)}','${toggleAction}')">${toggleLabel}</button>
    </div>
  </div>`;
}

function formatLogLine(log: LogLine): string {
  const time = log.timestamp.toLocaleTimeString();
  return `<span class="text-slate-400">${escapeHtml(time)}</span> <span class="text-indigo-400">[${escapeHtml(log.agent)}]</span> ${escapeHtml(log.message)}`;
}

export function renderDashboardPage(agents: AgentStatus[], schedulerInfo: SchedulerInfo | null, recentLogs: LogLine[], globalSummary?: GlobalSummary | null): string {
  const cronCount = schedulerInfo?.cronJobCount || 0;
  const webhooks = schedulerInfo?.webhooksActive ? "active" : "inactive";
  const summary = globalSummary || { totalRuns: 0, okRuns: 0, errorRuns: 0, totalTokens: 0, totalCost: 0 };

  const content = `
    <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
      <h1 class="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">Dashboard</h1>
      <div class="flex items-center gap-2">
        <button id="pause-btn" class="px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors" onclick="togglePause()">${schedulerInfo?.paused ? "Resume" : "Pause"}</button>
      </div>
    </div>

    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
      ${renderStatCard("Agents", `${agents.length}`)}
      ${renderStatCard("Cron Jobs", `${cronCount}`)}
      ${renderStatCard("Webhooks", webhooks)}
      ${renderStatCard("Total Runs", `${summary.totalRuns}`, "stat-runs")}
      ${renderStatCard("Total Cost", formatCost(summary.totalCost), "stat-cost")}
    </div>

    <!-- Desktop table -->
    <div class="hidden sm:block mb-8">
      <table class="w-full">
        <thead>
          <tr class="border-b-2 border-slate-200 dark:border-slate-700">
            <th class="text-left px-3 py-2 text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium">Agent</th>
            <th class="text-left px-3 py-2 text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium">State</th>
            <th class="text-left px-3 py-2 text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium">Status</th>
            <th class="text-left px-3 py-2 text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium">Last Run</th>
            <th class="text-left px-3 py-2 text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium">Duration</th>
            <th class="text-left px-3 py-2 text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium">Next Run</th>
            <th class="text-left px-3 py-2 text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium">Actions</th>
          </tr>
        </thead>
        <tbody id="agent-table-body" class="divide-y divide-slate-100 dark:divide-slate-800">
          ${agents.length > 0 ? agents.map(renderAgentRow).join("\n") : '<tr><td colspan="7" class="px-3 py-8 text-center text-slate-400 italic">No agents registered</td></tr>'}
        </tbody>
      </table>
    </div>

    <!-- Mobile cards -->
    <div class="sm:hidden mb-6" id="agent-cards">
      ${agents.length > 0 ? agents.map(renderAgentCard).join("\n") : '<div class="text-slate-400 italic text-center py-6">No agents registered</div>'}
    </div>

    <h2 class="text-base font-semibold text-slate-900 dark:text-white mb-3">Recent Activity</h2>
    <div class="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-3 sm:p-4 font-mono text-xs sm:text-sm leading-relaxed max-h-72 overflow-y-auto scrollbar-thin" id="recent-logs">
      ${recentLogs.length > 0 ? recentLogs.map((l) => `<div class="whitespace-pre-wrap break-all">${formatLogLine(l)}</div>`).join("\n") : '<div class="text-slate-400 italic">No recent activity</div>'}
    </div>`;

  const scripts = `<script>
    var stateColors = { running: "bg-green-500", building: "bg-yellow-500", error: "bg-red-500", idle: "bg-slate-400" };
    var stateTextColors = { running: "text-green-600 dark:text-green-400", building: "text-yellow-600 dark:text-yellow-400", error: "text-red-600 dark:text-red-400", idle: "text-slate-500 dark:text-slate-400" };

    function fmtScale(a) {
      if (a.state === "running" && a.scale > 1) return "running " + a.runningCount + "/" + a.scale;
      if (a.scale > 1) return a.state + " (\\u00d7" + a.scale + ")";
      return a.state;
    }

    function renderRow(a) {
      var dotClass = stateColors[a.state] || "bg-slate-400";
      var textClass = stateTextColors[a.state] || "text-slate-400";
      var status = a.statusText || a.lastError || "\\u2014";
      var toggleLabel = a.enabled ? "Disable" : "Enable";
      var toggleAction = a.enabled ? "disable" : "enable";
      return '<tr data-agent="' + esc(a.name) + '" class="hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors">' +
        '<td class="px-3 py-2.5"><a href="/dashboard/agents/' + esc(a.name) + '" class="text-blue-600 dark:text-blue-400 hover:underline font-medium">' + esc(a.name) + '</a></td>' +
        '<td class="px-3 py-2.5"><span class="state-dot ' + dotClass + ' mr-1.5 inline-block"></span><span class="' + textClass + ' text-sm">' + esc(fmtScale(a)) + '</span></td>' +
        '<td class="px-3 py-2.5 max-w-[300px] truncate text-slate-500 dark:text-slate-400 text-sm">' + esc(status) + '</td>' +
        '<td class="px-3 py-2.5 text-sm text-slate-600 dark:text-slate-300">' + fmtTime(a.lastRunAt) + '</td>' +
        '<td class="px-3 py-2.5 text-sm text-slate-600 dark:text-slate-300">' + (a.lastRunDuration != null ? fmtDur(a.lastRunDuration) : "\\u2014") + '</td>' +
        '<td class="px-3 py-2.5 text-sm text-slate-600 dark:text-slate-300">' + fmtTime(a.nextRunAt) + '</td>' +
        '<td class="px-3 py-2.5 whitespace-nowrap">' +
        '<button class="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors mr-1" onclick="triggerAgent(\\'' + esc(a.name) + '\\')">Run</button>' +
        '<button class="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-600 bg-transparent hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors" onclick="toggleAgent(\\'' + esc(a.name) + '\\',\\'' + toggleAction + '\\')">' + toggleLabel + '</button></td></tr>';
    }

    function renderCard(a) {
      var dotClass = stateColors[a.state] || "bg-slate-400";
      var textClass = stateTextColors[a.state] || "text-slate-400";
      var status = a.statusText || a.lastError || "\\u2014";
      var toggleLabel = a.enabled ? "Disable" : "Enable";
      var toggleAction = a.enabled ? "disable" : "enable";
      return '<div class="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-3 mb-2">' +
        '<a href="/dashboard/agents/' + esc(a.name) + '" class="block">' +
        '<div class="flex justify-between items-center mb-1"><span class="text-blue-600 dark:text-blue-400 font-semibold text-sm">' + esc(a.name) + '</span>' +
        '<span class="text-xs ' + textClass + '"><span class="state-dot ' + dotClass + ' mr-1 inline-block"></span>' + esc(fmtScale(a)) + '</span></div>' +
        '<div class="text-xs text-slate-500 dark:text-slate-400 truncate mb-1.5">' + esc(status) + '</div>' +
        '<div class="flex gap-3 text-xs text-slate-400"><span>Last: ' + fmtTime(a.lastRunAt) + '</span><span>' + (a.lastRunDuration != null ? fmtDur(a.lastRunDuration) : "") + '</span><span>Next: ' + fmtTime(a.nextRunAt) + '</span></div></a>' +
        '<div class="flex gap-2 mt-2 pt-2 border-t border-slate-100 dark:border-slate-800">' +
        '<button class="px-2.5 py-1 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors" onclick="triggerAgent(\\'' + esc(a.name) + '\\')">Run</button>' +
        '<button class="px-2.5 py-1 text-xs rounded border border-slate-300 dark:border-slate-600 bg-transparent hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors" onclick="toggleAgent(\\'' + esc(a.name) + '\\',\\'' + toggleAction + '\\')">' + toggleLabel + '</button></div></div>';
    }

    function renderLog(l) {
      var t = new Date(l.timestamp).toLocaleTimeString();
      return '<div class="whitespace-pre-wrap break-all"><span class="text-slate-400">' + esc(t) + '</span> <span class="text-indigo-400">[' + esc(l.agent) + ']</span> ' + esc(l.message) + '</div>';
    }

    var es = new EventSource("/dashboard/api/status-stream");
    es.onmessage = function(e) {
      var data = JSON.parse(e.data);
      if (data.agents) {
        var tbody = document.getElementById("agent-table-body");
        if (data.agents.length > 0) {
          tbody.innerHTML = data.agents.map(renderRow).join("");
        } else {
          tbody.innerHTML = '<tr><td colspan="7" class="px-3 py-8 text-center text-slate-400 italic">No agents registered</td></tr>';
        }
        var cards = document.getElementById("agent-cards");
        if (data.agents.length > 0) {
          cards.innerHTML = data.agents.map(renderCard).join("");
        } else {
          cards.innerHTML = '<div class="text-slate-400 italic text-center py-6">No agents registered</div>';
        }
      }
      if (data.recentLogs && data.recentLogs.length > 0) {
        var logsDiv = document.getElementById("recent-logs");
        logsDiv.innerHTML = data.recentLogs.map(renderLog).join("");
        logsDiv.scrollTop = logsDiv.scrollHeight;
      }
      if (data.schedulerInfo) {
        var btn = document.getElementById("pause-btn");
        if (btn) {
          schedulerPaused = !!data.schedulerInfo.paused;
          btn.textContent = schedulerPaused ? "Resume" : "Pause";
        }
      }
    };

    var schedulerPaused = ${schedulerInfo?.paused ? "true" : "false"};

    function triggerAgent(name) {
      ctrlPost("/control/trigger/" + encodeURIComponent(name));
    }
    function toggleAgent(name, action) {
      ctrlPost("/control/agents/" + encodeURIComponent(name) + "/" + action);
    }
    function togglePause() {
      ctrlPost(schedulerPaused ? "/control/resume" : "/control/pause");
    }
  </script>`;

  return renderLayout({ title: "Dashboard", content, scripts });
}
