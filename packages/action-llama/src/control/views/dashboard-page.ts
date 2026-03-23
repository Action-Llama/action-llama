import type { AgentStatus, SchedulerInfo, LogLine } from "../../tui/status-tracker.js";
import type { TriggerHistoryRow } from "../../stats/store.js";
import { escapeHtml, formatDuration, formatTime, formatCost, formatTokens, renderLayout } from "./layout.js";

interface SessionSummary {
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

function renderTokenBar(agent: AgentStatus, totalSessionTokens: number): string {
  const tokens = agent.cumulativeUsage?.totalTokens ?? 0;
  const pct = totalSessionTokens > 0 ? Math.round((tokens / totalSessionTokens) * 100) : 0;
  return `<div class="flex items-center gap-2">
    <div class="flex-1 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden" style="min-width:60px">
      <div class="h-full bg-blue-500 rounded-full" style="width:${pct}%"></div>
    </div>
    <span class="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">${formatTokens(tokens)}</span>
  </div>`;
}

function renderAgentRow(agent: AgentStatus, totalSessionTokens: number): string {
  const colors = stateColor(agent.state);
  const toggleLabel = agent.enabled ? "Disable" : "Enable";
  const toggleAction = agent.enabled ? "disable" : "enable";
  const descHtml = agent.description
    ? `<div class="text-xs text-slate-400 mt-0.5">${escapeHtml(agent.description)}</div>`
    : "";
  const runDisabled = !agent.enabled;
  const killDisabled = agent.runningCount === 0;
  return `<tr data-agent="${escapeHtml(agent.name)}" class="hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors${!agent.enabled ? " opacity-50" : ""}">
    <td class="px-3 py-2.5">
      <a href="/dashboard/agents/${escapeHtml(agent.name)}" class="text-blue-600 dark:text-blue-400 hover:underline font-medium">${escapeHtml(agent.name)}</a>
      ${descHtml}
    </td>
    <td class="px-3 py-2.5"><span class="state-dot ${colors.dot} mr-1.5 inline-block"></span><span class="${colors.text} text-sm">${escapeHtml(formatScale(agent))}</span></td>
    <td class="px-3 py-2.5 text-sm text-slate-600 dark:text-slate-300">${formatTime(agent.lastRunAt)}</td>
    <td class="px-3 py-2.5 text-sm text-slate-600 dark:text-slate-300">${agent.lastRunDuration != null ? formatDuration(agent.lastRunDuration) : "\u2014"}</td>
    <td class="px-3 py-2.5 text-sm text-slate-600 dark:text-slate-300">${formatTime(agent.nextRunAt)}</td>
    <td class="px-3 py-2.5" style="min-width:120px">${renderTokenBar(agent, totalSessionTokens)}</td>
    <td class="px-3 py-2.5 text-sm text-slate-600 dark:text-slate-300">${agent.locks && agent.locks.length > 0 ? agent.locks.map(l => escapeHtml(l.resourceKey.replace(/^[^:]+:\/\//, ""))).join(", ") : "\u2014"}</td>
    <td class="px-3 py-2.5 whitespace-nowrap">
      <button class="px-2 py-1 text-xs rounded font-bold bg-green-600 ${runDisabled ? "opacity-40 cursor-not-allowed" : "hover:bg-green-700"} text-white transition-colors mr-1" ${runDisabled ? "disabled" : `onclick="triggerAgent('${escapeHtml(agent.name)}')"`}>Run</button>
      <button class="px-2 py-1 text-xs rounded font-bold bg-red-600 ${killDisabled ? "opacity-40 cursor-not-allowed" : "hover:bg-red-700"} text-white transition-colors mr-1" ${killDisabled ? "disabled" : `onclick="killAgent('${escapeHtml(agent.name)}')"`}>Kill</button>
      <button class="px-2 py-1 text-xs rounded font-bold border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors" onclick="toggleAgent('${escapeHtml(agent.name)}','${toggleAction}')">${toggleLabel}</button>
    </td>
  </tr>`;
}

function renderAgentCard(agent: AgentStatus): string {
  const colors = stateColor(agent.state);
  const toggleLabel = agent.enabled ? "Disable" : "Enable";
  const toggleAction = agent.enabled ? "disable" : "enable";
  const runDisabled = !agent.enabled;
  const killDisabled = agent.runningCount === 0;
  const descHtml = agent.description
    ? `<div class="text-xs text-slate-400 mb-1">${escapeHtml(agent.description)}</div>`
    : "";
  return `<div class="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-3 mb-2${!agent.enabled ? " opacity-50" : ""}">
    <a href="/dashboard/agents/${escapeHtml(agent.name)}" class="block">
      <div class="flex justify-between items-center mb-1">
        <span class="text-blue-600 dark:text-blue-400 font-semibold text-sm">${escapeHtml(agent.name)}</span>
        <span class="text-xs ${colors.text}"><span class="state-dot ${colors.dot} mr-1 inline-block"></span>${escapeHtml(formatScale(agent))}</span>
      </div>
      ${descHtml}
      <div class="flex gap-3 text-xs text-slate-400">
        <span>Last: ${formatTime(agent.lastRunAt)}</span>
        <span>${agent.lastRunDuration != null ? formatDuration(agent.lastRunDuration) : ""}</span>
        <span>Next: ${formatTime(agent.nextRunAt)}</span>
      </div>
    </a>
    <div class="flex gap-2 mt-2 pt-2 border-t border-slate-100 dark:border-slate-800">
      <button class="px-2.5 py-1 text-xs rounded font-bold bg-green-600 ${runDisabled ? "opacity-40 cursor-not-allowed" : "hover:bg-green-700"} text-white transition-colors" ${runDisabled ? "disabled" : `onclick="triggerAgent('${escapeHtml(agent.name)}')"`}>Run</button>
      <button class="px-2.5 py-1 text-xs rounded font-bold bg-red-600 ${killDisabled ? "opacity-40 cursor-not-allowed" : "hover:bg-red-700"} text-white transition-colors" ${killDisabled ? "disabled" : `onclick="killAgent('${escapeHtml(agent.name)}')"`}>Kill</button>
      <button class="px-2.5 py-1 text-xs rounded font-bold border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors" onclick="toggleAgent('${escapeHtml(agent.name)}','${toggleAction}')">${toggleLabel}</button>
    </div>
  </div>`;
}

function triggerTypeBadge(type: string): string {
  const colors: Record<string, string> = {
    schedule: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    webhook: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
    agent: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  };
  const cls = colors[type] ?? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
  return `<span class="px-1.5 py-0.5 text-xs font-medium rounded ${cls}">${escapeHtml(type)}</span>`;
}

function resultBadge(result: string): string {
  if (result === "completed" || result === "rerun") {
    return `<span class="text-green-600 dark:text-green-400 text-xs font-medium">${escapeHtml(result)}</span>`;
  }
  if (result === "dead-letter") {
    return `<span class="px-1.5 py-0.5 text-xs font-medium rounded bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">Dead Letter</span>`;
  }
  if (result === "error") {
    return `<span class="text-red-600 dark:text-red-400 text-xs font-medium">error</span>`;
  }
  return `<span class="text-slate-500 text-xs">${escapeHtml(result)}</span>`;
}

function renderTriggerRow(row: TriggerHistoryRow): string {
  const time = new Date(row.ts).toLocaleTimeString();
  const agentLink = row.agentName
    ? `<a href="/dashboard/agents/${escapeHtml(row.agentName)}" class="text-blue-600 dark:text-blue-400 hover:underline text-xs">${escapeHtml(row.agentName)}</a>`
    : `<span class="text-slate-400 text-xs">\u2014</span>`;
  const instanceLink = row.instanceId && row.agentName
    ? `<a href="/dashboard/agents/${escapeHtml(row.agentName)}/instances/${escapeHtml(row.instanceId)}" class="text-xs text-slate-500 dark:text-slate-400 hover:underline font-mono">${escapeHtml(row.instanceId.slice(0, 8))}</a>`
    : `<span class="text-slate-400 text-xs">\u2014</span>`;
  return `<tr class="hover:bg-slate-50 dark:hover:bg-slate-900/50">
    <td class="px-2 py-1.5 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">${escapeHtml(time)}</td>
    <td class="px-2 py-1.5">${triggerTypeBadge(row.triggerType)}</td>
    <td class="px-2 py-1.5 text-xs text-slate-600 dark:text-slate-300">${escapeHtml(row.triggerSource ?? "\u2014")}</td>
    <td class="px-2 py-1.5">${agentLink}</td>
    <td class="px-2 py-1.5">${instanceLink}</td>
    <td class="px-2 py-1.5">${resultBadge(row.result)}</td>
  </tr>`;
}

function formatLogLine(log: LogLine): string {
  const time = log.timestamp.toLocaleTimeString();
  return `<span class="text-slate-400">${escapeHtml(time)}</span> <span class="text-indigo-400">[${escapeHtml(log.agent)}]</span> ${escapeHtml(log.message)}`;
}

export function renderDashboardPage(agents: AgentStatus[], schedulerInfo: SchedulerInfo | null, recentLogs: LogLine[], triggerHistory?: TriggerHistoryRow[]): string {
  const sessionTokens = agents.reduce((sum, a) => sum + (a.cumulativeUsage?.totalTokens ?? 0), 0);
  const sessionCost = agents.reduce((sum, a) => sum + (a.cumulativeUsage?.cost ?? 0), 0);

  const content = `
    <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
      <h1 class="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">Dashboard</h1>
      <div class="flex items-center gap-2">
        <a href="/dashboard/config" class="px-3 py-1.5 text-sm rounded-md font-bold border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors">Config</a>
        <button id="pause-btn" class="px-3 py-1.5 text-sm rounded-md font-bold border border-yellow-500 bg-yellow-500 hover:bg-yellow-600 text-white transition-colors" onclick="togglePause()">${schedulerInfo?.paused ? "Resume" : "Pause"}</button>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-3 mb-6">
      ${renderStatCard("Session Tokens", formatTokens(sessionTokens), "stat-tokens")}
      ${renderStatCard("Session Cost", formatCost(sessionCost), "stat-cost")}
    </div>

    <!-- Desktop table -->
    <div class="hidden sm:block mb-8">
      <table class="w-full">
        <thead>
          <tr class="border-b-2 border-slate-200 dark:border-slate-700">
            <th class="text-left px-3 py-2 text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium">Agent</th>
            <th class="text-left px-3 py-2 text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium">State</th>
            <th class="text-left px-3 py-2 text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium">Last Run</th>
            <th class="text-left px-3 py-2 text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium">Duration</th>
            <th class="text-left px-3 py-2 text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium">Next Run</th>
            <th class="text-left px-3 py-2 text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium">Tokens Used</th>
            <th class="text-left px-3 py-2 text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium">Locks</th>
            <th class="text-left px-3 py-2 text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium">Actions</th>
          </tr>
        </thead>
        <tbody id="agent-table-body" class="divide-y divide-slate-100 dark:divide-slate-800">
          ${agents.length > 0 ? agents.map((a) => renderAgentRow(a, sessionTokens)).join("\n") : '<tr><td colspan="8" class="px-3 py-8 text-center text-slate-400 italic">No agents registered</td></tr>'}
        </tbody>
      </table>
    </div>

    <!-- Mobile cards -->
    <div class="sm:hidden mb-6" id="agent-cards">
      ${agents.length > 0 ? agents.map(renderAgentCard).join("\n") : '<div class="text-slate-400 italic text-center py-6">No agents registered</div>'}
    </div>

    <div class="flex items-center justify-between mb-3">
      <h2 class="text-base font-semibold text-slate-900 dark:text-white">Recent Triggers</h2>
      <a href="/dashboard/triggers" class="text-xs text-blue-600 dark:text-blue-400 hover:underline">View all</a>
    </div>
    ${triggerHistory && triggerHistory.length > 0 ? `
    <div class="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden mb-6">
      <table class="w-full">
        <thead>
          <tr class="border-b border-slate-200 dark:border-slate-700">
            <th class="text-left px-2 py-1.5 text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium">Time</th>
            <th class="text-left px-2 py-1.5 text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium">Type</th>
            <th class="text-left px-2 py-1.5 text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium">Source</th>
            <th class="text-left px-2 py-1.5 text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium">Agent</th>
            <th class="text-left px-2 py-1.5 text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium">Instance</th>
            <th class="text-left px-2 py-1.5 text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium">Status</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
          ${triggerHistory.map(renderTriggerRow).join("\n")}
        </tbody>
      </table>
    </div>` : `
    <div class="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-3 sm:p-4 mb-6">
      <div class="text-slate-400 italic text-sm">No trigger history yet</div>
    </div>`}

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

    function sessionTotalTokens(agents) {
      var total = 0;
      for (var i = 0; i < agents.length; i++) {
        if (agents[i].cumulativeUsage) total += agents[i].cumulativeUsage.totalTokens || 0;
      }
      return total;
    }

    function sessionTotalCost(agents) {
      var total = 0;
      for (var i = 0; i < agents.length; i++) {
        if (agents[i].cumulativeUsage) total += agents[i].cumulativeUsage.cost || 0;
      }
      return total;
    }

    function tokenBar(a, totalTokens) {
      var tokens = (a.cumulativeUsage && a.cumulativeUsage.totalTokens) || 0;
      var pct = totalTokens > 0 ? Math.round((tokens / totalTokens) * 100) : 0;
      return '<div class="flex items-center gap-2">' +
        '<div class="flex-1 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden" style="min-width:60px">' +
        '<div class="h-full bg-blue-500 rounded-full" style="width:' + pct + '%"></div></div>' +
        '<span class="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">' + fmtTokens(tokens) + '</span></div>';
    }

    var _cachedAgents = null;

    function renderRow(a) {
      var dotClass = stateColors[a.state] || "bg-slate-400";
      var textClass = stateTextColors[a.state] || "text-slate-400";
      var toggleLabel = a.enabled ? "Disable" : "Enable";
      var toggleAction = a.enabled ? "disable" : "enable";
      var totalTok = _cachedAgents ? sessionTotalTokens(_cachedAgents) : 0;
      var runDis = !a.enabled;
      var killDis = !a.runningCount;
      return '<tr data-agent="' + esc(a.name) + '" class="hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors' + (a.enabled ? '' : ' opacity-50') + '">' +
        '<td class="px-3 py-2.5"><a href="/dashboard/agents/' + esc(a.name) + '" class="text-blue-600 dark:text-blue-400 hover:underline font-medium">' + esc(a.name) + '</a></td>' +
        '<td class="px-3 py-2.5"><span class="state-dot ' + dotClass + ' mr-1.5 inline-block"></span><span class="' + textClass + ' text-sm">' + esc(fmtScale(a)) + '</span></td>' +
        '<td class="px-3 py-2.5 text-sm text-slate-600 dark:text-slate-300">' + fmtTime(a.lastRunAt) + '</td>' +
        '<td class="px-3 py-2.5 text-sm text-slate-600 dark:text-slate-300">' + (a.lastRunDuration != null ? fmtDur(a.lastRunDuration) : "\\u2014") + '</td>' +
        '<td class="px-3 py-2.5 text-sm text-slate-600 dark:text-slate-300">' + fmtTime(a.nextRunAt) + '</td>' +
        '<td class="px-3 py-2.5" style="min-width:120px">' + tokenBar(a, totalTok) + '</td>' +
        '<td class="px-3 py-2.5 text-sm text-slate-600 dark:text-slate-300">' + (a.locks && a.locks.length > 0 ? a.locks.map(function(l) { return esc(l.resourceKey.replace(/^[^:]+:\\/\\//, "")); }).join(", ") : "\\u2014") + '</td>' +
        '<td class="px-3 py-2.5 whitespace-nowrap">' +
        '<button class="px-2 py-1 text-xs rounded font-bold bg-green-600 ' + (runDis ? 'opacity-40 cursor-not-allowed' : 'hover:bg-green-700') + ' text-white transition-colors mr-1" ' + (runDis ? 'disabled' : 'onclick="triggerAgent(\\'' + esc(a.name) + '\\')"') + '>Run</button>' +
        '<button class="px-2 py-1 text-xs rounded font-bold bg-red-600 ' + (killDis ? 'opacity-40 cursor-not-allowed' : 'hover:bg-red-700') + ' text-white transition-colors mr-1" ' + (killDis ? 'disabled' : 'onclick="killAgent(\\'' + esc(a.name) + '\\')"') + '>Kill</button>' +
        '<button class="px-2 py-1 text-xs rounded font-bold border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors" onclick="toggleAgent(\\'' + esc(a.name) + '\\',\\'' + toggleAction + '\\')">' + toggleLabel + '</button></td></tr>';
    }

    function renderCard(a) {
      var dotClass = stateColors[a.state] || "bg-slate-400";
      var textClass = stateTextColors[a.state] || "text-slate-400";
      var toggleLabel = a.enabled ? "Disable" : "Enable";
      var toggleAction = a.enabled ? "disable" : "enable";
      var runDis = !a.enabled;
      var killDis = !a.runningCount;
      return '<div class="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-3 mb-2' + (a.enabled ? '' : ' opacity-50') + '">' +
        '<a href="/dashboard/agents/' + esc(a.name) + '" class="block">' +
        '<div class="flex justify-between items-center mb-1"><span class="text-blue-600 dark:text-blue-400 font-semibold text-sm">' + esc(a.name) + '</span>' +
        '<span class="text-xs ' + textClass + '"><span class="state-dot ' + dotClass + ' mr-1 inline-block"></span>' + esc(fmtScale(a)) + '</span></div>' +
        '<div class="flex gap-3 text-xs text-slate-400"><span>Last: ' + fmtTime(a.lastRunAt) + '</span><span>' + (a.lastRunDuration != null ? fmtDur(a.lastRunDuration) : "") + '</span><span>Next: ' + fmtTime(a.nextRunAt) + '</span></div></a>' +
        '<div class="flex gap-2 mt-2 pt-2 border-t border-slate-100 dark:border-slate-800">' +
        '<button class="px-2.5 py-1 text-xs rounded font-bold bg-green-600 ' + (runDis ? 'opacity-40 cursor-not-allowed' : 'hover:bg-green-700') + ' text-white transition-colors" ' + (runDis ? 'disabled' : 'onclick="triggerAgent(\\'' + esc(a.name) + '\\')"') + '>Run</button>' +
        '<button class="px-2.5 py-1 text-xs rounded font-bold bg-red-600 ' + (killDis ? 'opacity-40 cursor-not-allowed' : 'hover:bg-red-700') + ' text-white transition-colors" ' + (killDis ? 'disabled' : 'onclick="killAgent(\\'' + esc(a.name) + '\\')"') + '>Kill</button>' +
        '<button class="px-2.5 py-1 text-xs rounded font-bold border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors" onclick="toggleAgent(\\'' + esc(a.name) + '\\',\\'' + toggleAction + '\\')">' + toggleLabel + '</button></div></div>';
    }

    function renderLog(l) {
      var t = new Date(l.timestamp).toLocaleTimeString();
      return '<div class="whitespace-pre-wrap break-all"><span class="text-slate-400">' + esc(t) + '</span> <span class="text-indigo-400">[' + esc(l.agent) + ']</span> ' + esc(l.message) + '</div>';
    }

    var es = new EventSource("/dashboard/api/status-stream");
    es.onmessage = function(e) {
      var data = JSON.parse(e.data);
      if (data.agents) {
        _cachedAgents = data.agents;
        var tbody = document.getElementById("agent-table-body");
        if (data.agents.length > 0) {
          tbody.innerHTML = data.agents.map(renderRow).join("");
        } else {
          tbody.innerHTML = '<tr><td colspan="8" class="px-3 py-8 text-center text-slate-400 italic">No agents registered</td></tr>';
        }
        var cards = document.getElementById("agent-cards");
        if (data.agents.length > 0) {
          cards.innerHTML = data.agents.map(renderCard).join("");
        } else {
          cards.innerHTML = '<div class="text-slate-400 italic text-center py-6">No agents registered</div>';
        }
        // Update session stats
        var tokEl = document.getElementById("stat-tokens");
        var costEl = document.getElementById("stat-cost");
        if (tokEl) tokEl.textContent = fmtTokens(sessionTotalTokens(data.agents));
        if (costEl) costEl.textContent = fmtCost(sessionTotalCost(data.agents));
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

    // Fetch locks periodically
    async function fetchLocks() {
      try {
        var res = await fetch("/dashboard/api/locks");
        if (res.ok) {
          var data = await res.json();
          if (data.locks && _cachedAgents) {
            // Group locks by agent
            var locksByAgent = {};
            for (var i = 0; i < data.locks.length; i++) {
              var lock = data.locks[i];
              if (!locksByAgent[lock.agentName]) locksByAgent[lock.agentName] = [];
              locksByAgent[lock.agentName].push(lock);
            }
            // Update agent locks
            for (var j = 0; j < _cachedAgents.length; j++) {
              _cachedAgents[j].locks = locksByAgent[_cachedAgents[j].name] || [];
            }
            // Re-render table
            var tbody = document.getElementById("agent-table-body");
            if (_cachedAgents.length > 0) {
              tbody.innerHTML = _cachedAgents.map(renderRow).join("");
            }
          }
        }
      } catch(e) {}
    }
    setInterval(fetchLocks, 2000);
    fetchLocks(); // Initial fetch

    var schedulerPaused = ${schedulerInfo?.paused ? "true" : "false"};

    function triggerAgent(name) {
      ctrlPost("/control/trigger/" + encodeURIComponent(name));
    }
    function toggleAgent(name, action) {
      ctrlPost("/control/agents/" + encodeURIComponent(name) + "/" + action);
    }
    function killAgent(name) {
      if (!confirm("Kill all instances of agent '" + name + "'?")) return;
      ctrlPost("/control/agents/" + encodeURIComponent(name) + "/kill");
    }
    function togglePause() {
      ctrlPost(schedulerPaused ? "/control/resume" : "/control/pause");
    }
  </script>`;

  return renderLayout({ title: "Dashboard", content, scripts });
}
