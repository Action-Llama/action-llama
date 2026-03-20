import type { AgentStatus } from "../../tui/status-tracker.js";
import type { AgentSummary } from "../../stats/store.js";
import type { AgentInstance } from "../../scheduler/types.js";
import { escapeHtml, formatDuration, formatCost, formatTokens, renderLayout } from "./layout.js";

function stateColor(state: AgentStatus["state"]): { dot: string; text: string } {
  switch (state) {
    case "running": return { dot: "bg-green-500", text: "text-green-600 dark:text-green-400" };
    case "building": return { dot: "bg-yellow-500", text: "text-yellow-600 dark:text-yellow-400" };
    case "error": return { dot: "bg-red-500", text: "text-red-600 dark:text-red-400" };
    case "idle": return { dot: "bg-slate-400", text: "text-slate-500 dark:text-slate-400" };
  }
}

function instanceStatusColor(status: string): string {
  switch (status) {
    case "running": return "text-green-600 dark:text-green-400";
    case "completed": return "text-slate-600 dark:text-slate-300";
    case "error": return "text-red-600 dark:text-red-400";
    case "killed": return "text-yellow-600 dark:text-yellow-400";
    default: return "text-slate-500";
  }
}

function renderStatCard(label: string, value: string): string {
  return `<div class="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-3">
    <div class="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">${escapeHtml(label)}</div>
    <div class="text-lg font-semibold text-slate-900 dark:text-white">${value}</div>
  </div>`;
}

export interface AgentDetailData {
  agentName: string;
  agent: AgentStatus | null;
  summary: AgentSummary | null;
  runningInstances: AgentInstance[];
  totalHistorical: number;
}

export function renderAgentDetailPage(data: AgentDetailData): string {
  const { agentName, agent, summary, runningInstances, totalHistorical } = data;
  const colors = agent ? stateColor(agent.state) : { dot: "bg-slate-400", text: "text-slate-400" };

  const stateHtml = agent
    ? `<span class="state-dot ${colors.dot} inline-block mr-1.5"></span><span class="${colors.text}">${escapeHtml(agent.state)}</span>`
    : '<span class="text-slate-400">unknown</span>';

  const content = `
    <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
      <div class="flex items-center gap-3">
        <h1 class="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">${escapeHtml(agentName)}</h1>
        <span id="agent-state" class="text-sm">${stateHtml}</span>
      </div>
      <div class="flex items-center gap-2">
        <button class="px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors" onclick="triggerAgent('${escapeHtml(agentName)}')">Run</button>
        <button id="toggle-btn" class="px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-600 bg-transparent hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors" onclick="toggleEnabled()">${agent?.enabled !== false ? "Disable" : "Enable"}</button>
      </div>
    </div>

    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
      ${renderStatCard("Total Runs", `${summary?.totalRuns ?? 0}`)}
      ${renderStatCard("Success", `${summary?.okRuns ?? 0}`)}
      ${renderStatCard("Errors", `${summary?.errorRuns ?? 0}`)}
      ${renderStatCard("Avg Duration", summary?.avgDurationMs ? formatDuration(summary.avgDurationMs) : "\u2014")}
      ${renderStatCard("Total Tokens", formatTokens(summary?.totalTokens ?? 0))}
      ${renderStatCard("Total Cost", formatCost(summary?.totalCost ?? 0))}
    </div>

    <!-- Running instances -->
    <div id="running-section" class="${runningInstances.length > 0 ? "" : "hidden"} mb-6">
      <h2 class="text-base font-semibold text-slate-900 dark:text-white mb-3">Running Instances</h2>
      <div id="running-instances" class="space-y-2">
        ${runningInstances.map((inst) => `
          <div class="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900 rounded-lg p-3 flex items-center justify-between" data-instance="${escapeHtml(inst.id)}">
            <div>
              <a href="/dashboard/agents/${escapeHtml(agentName)}/instances/${escapeHtml(inst.id)}" class="text-blue-600 dark:text-blue-400 hover:underline font-mono text-sm">${escapeHtml(inst.id)}</a>
              <span class="ml-2 text-xs text-slate-500">${escapeHtml(inst.trigger)}</span>
              <span class="ml-2 text-xs text-slate-400">started ${escapeHtml(inst.startedAt.toLocaleTimeString())}</span>
            </div>
            <span class="state-dot bg-green-500 inline-block animate-pulse"></span>
          </div>`).join("\n")}
      </div>
    </div>

    <!-- Instance history -->
    <h2 class="text-base font-semibold text-slate-900 dark:text-white mb-3">Instance History <span id="total-count" class="text-sm font-normal text-slate-400">(${totalHistorical} total)</span></h2>
    <div class="overflow-x-auto mb-4">
      <table class="w-full">
        <thead>
          <tr class="border-b-2 border-slate-200 dark:border-slate-700">
            <th class="text-left px-3 py-2 text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium">Instance</th>
            <th class="text-left px-3 py-2 text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium">Trigger</th>
            <th class="text-left px-3 py-2 text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium">Status</th>
            <th class="text-left px-3 py-2 text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium">Started</th>
            <th class="text-left px-3 py-2 text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium">Duration</th>
            <th class="text-left px-3 py-2 text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium">Tokens</th>
            <th class="text-left px-3 py-2 text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium">Cost</th>
          </tr>
        </thead>
        <tbody id="history-body" class="divide-y divide-slate-100 dark:divide-slate-800">
          <tr><td colspan="7" class="px-3 py-6 text-center text-slate-400 italic">Loading...</td></tr>
        </tbody>
      </table>
    </div>
    <div class="flex justify-between items-center" id="pagination">
      <button id="prev-btn" class="px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed" onclick="prevPage()" disabled>Previous</button>
      <span id="page-info" class="text-sm text-slate-400"></span>
      <button id="next-btn" class="px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed" onclick="nextPage()" disabled>Next</button>
    </div>`;

  const scripts = `<script>
    var agentName = ${JSON.stringify(agentName)};
    var currentPage = 1;
    var pageSize = 10;
    var totalItems = ${totalHistorical};
    var agentEnabled = ${agent?.enabled !== false ? "true" : "false"};

    var stateColors = { running: "bg-green-500", building: "bg-yellow-500", error: "bg-red-500", idle: "bg-slate-400" };
    var stateTextColors = { running: "text-green-600 dark:text-green-400", building: "text-yellow-600 dark:text-yellow-400", error: "text-red-600 dark:text-red-400", idle: "text-slate-500 dark:text-slate-400" };

    function resultColor(result) {
      if (result === "completed" || result === "rerun") return "text-green-600 dark:text-green-400";
      if (result === "error") return "text-red-600 dark:text-red-400";
      return "text-slate-500 dark:text-slate-400";
    }

    function renderHistoryRow(r) {
      var started = new Date(r.started_at).toLocaleString();
      var rc = resultColor(r.result);
      return '<tr class="hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors">' +
        '<td class="px-3 py-2.5"><a href="/dashboard/agents/' + esc(agentName) + '/instances/' + esc(r.instance_id) + '" class="text-blue-600 dark:text-blue-400 hover:underline font-mono text-xs">' + esc(r.instance_id) + '</a></td>' +
        '<td class="px-3 py-2.5 text-sm text-slate-600 dark:text-slate-300">' + esc(r.trigger_type) + '</td>' +
        '<td class="px-3 py-2.5 text-sm ' + rc + '">' + esc(r.result) + '</td>' +
        '<td class="px-3 py-2.5 text-sm text-slate-600 dark:text-slate-300">' + esc(started) + '</td>' +
        '<td class="px-3 py-2.5 text-sm text-slate-600 dark:text-slate-300">' + fmtDur(r.duration_ms) + '</td>' +
        '<td class="px-3 py-2.5 text-sm text-slate-600 dark:text-slate-300">' + fmtTokens(r.total_tokens || 0) + '</td>' +
        '<td class="px-3 py-2.5 text-sm text-slate-600 dark:text-slate-300">' + fmtCost(r.cost_usd || 0) + '</td></tr>';
    }

    function loadPage(page) {
      currentPage = page;
      fetch("/api/stats/agents/" + encodeURIComponent(agentName) + "/runs?page=" + page + "&limit=" + pageSize, { credentials: "same-origin" })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          totalItems = data.total;
          var tbody = document.getElementById("history-body");
          if (data.runs.length > 0) {
            tbody.innerHTML = data.runs.map(renderHistoryRow).join("");
          } else {
            tbody.innerHTML = '<tr><td colspan="7" class="px-3 py-6 text-center text-slate-400 italic">No run history</td></tr>';
          }
          document.getElementById("total-count").textContent = "(" + totalItems + " total)";
          var totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
          document.getElementById("page-info").textContent = "Page " + currentPage + " of " + totalPages;
          document.getElementById("prev-btn").disabled = currentPage <= 1;
          document.getElementById("next-btn").disabled = currentPage >= totalPages;
        });
    }

    function prevPage() { if (currentPage > 1) loadPage(currentPage - 1); }
    function nextPage() { loadPage(currentPage + 1); }

    loadPage(1);

    // SSE for live updates
    var es = new EventSource("/dashboard/api/status-stream");
    es.onmessage = function(e) {
      var data = JSON.parse(e.data);
      if (data.agents) {
        var agent = data.agents.find(function(a) { return a.name === agentName; });
        if (agent) {
          var dotClass = stateColors[agent.state] || "bg-slate-400";
          var textClass = stateTextColors[agent.state] || "text-slate-400";
          document.getElementById("agent-state").innerHTML = '<span class="state-dot ' + dotClass + ' inline-block mr-1.5"></span><span class="' + textClass + '">' + esc(agent.state) + '</span>';
          agentEnabled = agent.enabled;
          document.getElementById("toggle-btn").textContent = agentEnabled ? "Disable" : "Enable";
        }
      }
      if (data.instances) {
        var mine = data.instances.filter(function(i) { return i.agentName === agentName; });
        var section = document.getElementById("running-section");
        var container = document.getElementById("running-instances");
        if (mine.length > 0) {
          section.classList.remove("hidden");
          container.innerHTML = mine.map(function(inst) {
            return '<div class="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900 rounded-lg p-3 flex items-center justify-between" data-instance="' + esc(inst.id) + '">' +
              '<div><a href="/dashboard/agents/' + esc(agentName) + '/instances/' + esc(inst.id) + '" class="text-blue-600 dark:text-blue-400 hover:underline font-mono text-sm">' + esc(inst.id) + '</a>' +
              '<span class="ml-2 text-xs text-slate-500">' + esc(inst.trigger) + '</span>' +
              '<span class="ml-2 text-xs text-slate-400">started ' + fmtTime(inst.startedAt) + '</span></div>' +
              '<span class="state-dot bg-green-500 inline-block animate-pulse"></span></div>';
          }).join("");
        } else {
          section.classList.add("hidden");
          container.innerHTML = "";
        }
      }
    };

    function triggerAgent(name) {
      ctrlPost("/control/trigger/" + encodeURIComponent(name));
    }
    function toggleEnabled() {
      var action = agentEnabled ? "disable" : "enable";
      ctrlPost("/control/agents/" + encodeURIComponent(agentName) + "/" + action);
    }
  </script>`;

  return renderLayout({
    title: agentName,
    breadcrumbs: [
      { label: "Dashboard", href: "/dashboard" },
      { label: agentName },
    ],
    content,
    scripts,
  });
}
