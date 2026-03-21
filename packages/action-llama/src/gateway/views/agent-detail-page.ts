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

function instanceCardStyle(status: string): { bg: string; border: string; dot: string; pulse: string } {
  switch (status) {
    case "running": return { bg: "bg-green-50 dark:bg-green-950/30", border: "border-green-200 dark:border-green-900", dot: "bg-green-500", pulse: "animate-pulse" };
    case "completed": return { bg: "bg-slate-50 dark:bg-slate-900", border: "border-slate-200 dark:border-slate-800", dot: "bg-slate-400", pulse: "" };
    case "error": return { bg: "bg-red-50 dark:bg-red-950/30", border: "border-red-200 dark:border-red-900", dot: "bg-red-500", pulse: "" };
    case "killed": return { bg: "bg-yellow-50 dark:bg-yellow-950/30", border: "border-yellow-200 dark:border-yellow-900", dot: "bg-yellow-500", pulse: "" };
    default: return { bg: "bg-slate-50 dark:bg-slate-900", border: "border-slate-200 dark:border-slate-800", dot: "bg-slate-400", pulse: "" };
  }
}

function renderInstanceCard(inst: AgentInstance, agentName: string): string {
  const s = instanceCardStyle(inst.status);
  const killBtn = inst.status === "running"
    ? `<button class="px-2 py-1 text-xs rounded font-bold bg-red-600 hover:bg-red-700 text-white transition-colors" onclick="killInstance('${escapeHtml(inst.id)}')">Kill</button>`
    : "";
  return `<div class="${s.bg} border ${s.border} rounded-lg p-3 flex items-center justify-between" data-instance="${escapeHtml(inst.id)}">
    <div>
      <a href="/dashboard/agents/${escapeHtml(agentName)}/instances/${escapeHtml(inst.id)}" class="text-blue-600 dark:text-blue-400 hover:underline font-mono text-sm">${escapeHtml(inst.id)}</a>
      <span class="ml-2 text-xs text-slate-500">${escapeHtml(inst.trigger)}</span>
      <span class="ml-2 text-xs text-slate-400">started ${escapeHtml(inst.startedAt.toLocaleTimeString())}</span>
      <span class="ml-2 text-xs ${instanceStatusColor(inst.status)}">${escapeHtml(inst.status)}</span>
    </div>
    <div class="flex items-center gap-2">
      ${killBtn}
      <span class="state-dot ${s.dot} inline-block ${s.pulse}"></span>
    </div>
  </div>`;
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
        <button class="px-3 py-1.5 text-sm rounded-md font-bold bg-green-600 hover:bg-green-700 text-white transition-colors" onclick="triggerAgent('${escapeHtml(agentName)}')">Run</button>
        <button id="toggle-btn" class="px-3 py-1.5 text-sm rounded-md font-bold border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors" onclick="toggleEnabled()">${agent?.enabled !== false ? "Disable" : "Enable"}</button>
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

    <!-- Agent Configuration -->
    <div class="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-4 mb-6">
      <h2 class="text-lg font-semibold text-slate-900 dark:text-white mb-3">Configuration</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Agent Scale (concurrent runners)</label>
          <div class="flex items-center gap-2">
            <input id="agent-scale-input" type="number" min="1" max="20" value="${agent?.scale ?? 1}" class="px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white w-20">
            <button id="update-agent-scale-btn" class="px-3 py-1.5 text-sm rounded-md font-bold bg-blue-600 hover:bg-blue-700 text-white transition-colors" onclick="updateAgentScale()">Update</button>
          </div>
          <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Number of concurrent instances this agent can run</p>
        </div>
      </div>
    </div>

    <!-- Session instances -->
    <div id="running-section" class="${runningInstances.length > 0 ? "" : "hidden"} mb-6">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-base font-semibold text-slate-900 dark:text-white">Running Instances</h2>
        <button id="agent-kill-btn" class="px-3 py-1.5 text-sm rounded-md font-bold bg-red-600 hover:bg-red-700 text-white transition-colors ${runningInstances.length > 0 ? "" : "opacity-50 cursor-not-allowed"}" onclick="killAgent()" ${runningInstances.length > 0 ? "" : "disabled"}>Kill all</button>
      </div>
      <div id="running-instances" class="space-y-2">
        ${runningInstances.map((inst) => renderInstanceCard(inst, agentName)).join("\n")}
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
    <div class="flex justify-between items-center mb-8" id="pagination">
      <button id="prev-btn" class="px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed" onclick="prevPage()" disabled>Previous</button>
      <span id="page-info" class="text-sm text-slate-400"></span>
      <button id="next-btn" class="px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed" onclick="nextPage()" disabled>Next</button>
    </div>

    <!-- Aggregate logs -->
    <h2 class="text-base font-semibold text-slate-900 dark:text-white mb-3">Recent Logs</h2>
    <div id="agent-log-container" class="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-3 sm:p-4 font-mono text-xs sm:text-sm leading-relaxed overflow-y-auto scrollbar-thin" style="height: 300px;">
      <div id="agent-log-empty" class="text-slate-400 italic">Loading logs...</div>
    </div>`;

  const scripts = `<script>
    var agentName = ${JSON.stringify(agentName)};
    var currentPage = 1;
    var pageSize = 10;
    var totalItems = ${totalHistorical};
    var agentEnabled = ${agent?.enabled !== false ? "true" : "false"};

    var stateColors = { running: "bg-green-500", building: "bg-yellow-500", error: "bg-red-500", idle: "bg-slate-400" };
    var stateTextColors = { running: "text-green-600 dark:text-green-400", building: "text-yellow-600 dark:text-yellow-400", error: "text-red-600 dark:text-red-400", idle: "text-slate-500 dark:text-slate-400" };

    function updateKillButtonState(instances) {
      var hasRunning = instances.some(function(i) { return i.status === "running"; });
      var btn = document.getElementById("agent-kill-btn");
      if (btn) {
        btn.disabled = !hasRunning;
        if (hasRunning) {
          btn.classList.remove("opacity-50", "cursor-not-allowed");
        } else {
          btn.classList.add("opacity-50", "cursor-not-allowed");
        }
      }
    }

    function resultColor(result) {
      if (result === "completed" || result === "rerun") return "text-green-600 dark:text-green-400";
      if (result === "error") return "text-red-600 dark:text-red-400";
      return "text-slate-500 dark:text-slate-400";
    }

    function instStyle(status) {
      if (status === "running") return { bg: "bg-green-50 dark:bg-green-950/30", border: "border-green-200 dark:border-green-900", dot: "bg-green-500", pulse: "animate-pulse" };
      if (status === "error") return { bg: "bg-red-50 dark:bg-red-950/30", border: "border-red-200 dark:border-red-900", dot: "bg-red-500", pulse: "" };
      if (status === "killed") return { bg: "bg-yellow-50 dark:bg-yellow-950/30", border: "border-yellow-200 dark:border-yellow-900", dot: "bg-yellow-500", pulse: "" };
      return { bg: "bg-slate-50 dark:bg-slate-900", border: "border-slate-200 dark:border-slate-800", dot: "bg-slate-400", pulse: "" };
    }

    function instStatusColor(status) {
      if (status === "running") return "text-green-600 dark:text-green-400";
      if (status === "error") return "text-red-600 dark:text-red-400";
      if (status === "killed") return "text-yellow-600 dark:text-yellow-400";
      return "text-slate-600 dark:text-slate-300";
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
            var st = instStyle(inst.status);
            var killBtn = inst.status === "running"
              ? '<button class="px-2 py-1 text-xs rounded font-bold bg-red-600 hover:bg-red-700 text-white transition-colors" onclick="killInstance(\\\'' + esc(inst.id) + '\\\')">Kill</button>'
              : "";
            var statusColor = instStatusColor(inst.status);
            return '<div class="' + st.bg + ' border ' + st.border + ' rounded-lg p-3 flex items-center justify-between" data-instance="' + esc(inst.id) + '">' +
              '<div><a href="/dashboard/agents/' + esc(agentName) + '/instances/' + esc(inst.id) + '" class="text-blue-600 dark:text-blue-400 hover:underline font-mono text-sm">' + esc(inst.id) + '</a>' +
              '<span class="ml-2 text-xs text-slate-500">' + esc(inst.trigger) + '</span>' +
              '<span class="ml-2 text-xs text-slate-400">started ' + fmtTime(inst.startedAt) + '</span>' +
              '<span class="ml-2 text-xs ' + statusColor + '">' + esc(inst.status) + '</span></div>' +
              '<div class="flex items-center gap-2">' + killBtn +
              '<span class="state-dot ' + st.dot + ' inline-block ' + st.pulse + '"></span></div></div>';
          }).join("");
        } else {
          section.classList.add("hidden");
          container.innerHTML = "";
        }
        // Update kill button state after updating instances
        updateKillButtonState(mine);
      }
    };

    function triggerAgent(name) {
      ctrlPost("/control/trigger/" + encodeURIComponent(name));
    }
    function toggleEnabled() {
      var action = agentEnabled ? "disable" : "enable";
      ctrlPost("/control/agents/" + encodeURIComponent(agentName) + "/" + action);
    }
    function killAgent() {
      var btn = document.getElementById("agent-kill-btn");
      if (!btn || btn.disabled) return;
      if (!confirm("Kill all instances of agent '" + agentName + "'?")) return;
      ctrlPost("/control/agents/" + encodeURIComponent(agentName) + "/kill");
    }
    function killInstance(id) {
      if (!confirm("Kill instance " + id + "?")) return;
      ctrlPost("/control/kill/" + encodeURIComponent(id));
    }
    function updateAgentScale() {
      var input = document.getElementById("agent-scale-input");
      var btn = document.getElementById("update-agent-scale-btn");
      var scale = parseInt(input.value);
      if (!scale || scale < 1 || scale > 20) {
        alert("Scale must be between 1 and 20");
        return;
      }
      btn.disabled = true;
      btn.textContent = "Updating...";
      fetch("/control/agents/" + encodeURIComponent(agentName) + "/scale", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scale: scale })
      }).then(function(r) {
        if (r.ok) {
          alert("Agent scale updated to " + scale);
        } else {
          r.text().then(function(text) { alert("Error: " + text); });
        }
      }).catch(function(err) {
        alert("Error: " + err);
      }).finally(function() {
        btn.disabled = false;
        btn.textContent = "Update";
      });
    }

    // Aggregate log viewer
    var SKIP_LOG_MSGS = { "event": 1, "tool done": 1 };
    function formatAgentLogEntry(p) {
      var time = '<span class="text-slate-400">' + esc(new Date(p.time).toLocaleTimeString("en-US", { hour12: false })) + '</span>  ';
      var msg = p.msg || "";
      var lvl = p.level || 30;
      var inst = p.instance ? '<span class="text-purple-400">[' + esc(p.instance.slice(0, 8)) + ']</span> ' : "";
      if (SKIP_LOG_MSGS[msg]) return null;
      if (lvl <= 20 && msg !== "tool start") return null;
      if (msg === "assistant") {
        var text = p.text || "";
        if (!text) return null;
        return time + inst + '<span class="text-slate-900 dark:text-white font-medium">' + esc(text.split("\\n")[0]) + '</span>';
      }
      if (msg === "bash") return time + inst + '<span class="text-cyan-500">$ ' + esc(p.cmd || "") + '</span>';
      if (msg === "tool start") return time + inst + '<span class="text-blue-500">\\u25b8 ' + esc(p.tool || "unknown") + '</span>';
      if (msg === "run completed" || msg === "run completed, rerun requested") return time + inst + '<span class="text-green-500 font-semibold">Run completed</span>';
      if (lvl >= 50) return time + inst + '<span class="text-red-500 font-semibold">ERROR: ' + esc(msg) + '</span>';
      if (lvl >= 40) return time + inst + '<span class="text-yellow-500">WARN: ' + esc(msg) + '</span>';
      return time + inst + '<span class="text-slate-400">' + esc(msg) + '</span>';
    }

    var agentLogContainer = document.getElementById("agent-log-container");
    var agentLogEmpty = document.getElementById("agent-log-empty");
    var agentLogCursor = null;
    async function fetchAgentLogs(initial) {
      try {
        var params = new URLSearchParams();
        if (initial) params.set("lines", "200");
        if (agentLogCursor) params.set("cursor", agentLogCursor);
        var res = await fetch("/api/logs/agents/" + encodeURIComponent(agentName) + "?" + params, { credentials: "same-origin" });
        if (!res.ok) return;
        var data = await res.json();
        if (data.entries.length > 0 && agentLogEmpty && agentLogEmpty.parentNode) agentLogEmpty.remove();
        for (var i = 0; i < data.entries.length; i++) {
          var html = formatAgentLogEntry(data.entries[i]);
          if (!html) continue;
          var div = document.createElement("div");
          div.className = "whitespace-pre-wrap break-all py-px";
          div.innerHTML = html;
          agentLogContainer.appendChild(div);
        }
        if (data.cursor) agentLogCursor = data.cursor;
        agentLogContainer.scrollTop = agentLogContainer.scrollHeight;
      } catch(e) {}
    }
    fetchAgentLogs(true);
    setInterval(function() { fetchAgentLogs(false); }, 2000);
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
