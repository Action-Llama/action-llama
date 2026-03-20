import { escapeHtml, formatDuration, formatCost, formatTokens, renderLayout } from "./layout.js";

export interface InstanceDetailData {
  agentName: string;
  instanceId: string;
  run: {
    instance_id: string;
    agent_name: string;
    trigger_type: string;
    trigger_source?: string;
    result: string;
    exit_code?: number;
    started_at: number;
    duration_ms: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
    total_tokens: number;
    cost_usd: number;
    turn_count: number;
    error_message?: string;
  } | null;
}

function resultBadge(result: string): string {
  switch (result) {
    case "completed":
    case "rerun":
      return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400">${escapeHtml(result)}</span>`;
    case "error":
      return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400">error</span>`;
    default:
      return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">${escapeHtml(result)}</span>`;
  }
}

function statRow(label: string, value: string): string {
  return `<div class="flex justify-between py-2 border-b border-slate-100 dark:border-slate-800">
    <span class="text-sm text-slate-500 dark:text-slate-400">${escapeHtml(label)}</span>
    <span class="text-sm font-medium text-slate-900 dark:text-white">${value}</span>
  </div>`;
}

export function renderInstanceDetailPage(data: InstanceDetailData): string {
  const { agentName, instanceId, run } = data;

  const notFoundContent = `
    <div class="text-center py-12">
      <div class="text-slate-400 text-lg mb-2">Instance not found</div>
      <p class="text-sm text-slate-500">The instance <code class="font-mono">${escapeHtml(instanceId)}</code> was not found in the stats database. It may still be running or the data may have been pruned.</p>
    </div>`;

  if (!run) {
    // Even without stats data, show the log viewer — the instance may be running
    const content = `
      <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 class="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white font-mono">${escapeHtml(instanceId)}</h1>
        <div class="flex items-center gap-2">
          <button class="px-3 py-1.5 text-sm rounded-md font-bold bg-red-600 hover:bg-red-700 text-white transition-colors" onclick="killThisInstance()">Kill</button>
          <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400">running / pending</span>
        </div>
      </div>
      ${notFoundContent}
      <h2 class="text-base font-semibold text-slate-900 dark:text-white mb-3 mt-8">Logs</h2>
      ${logViewerHtml(agentName, instanceId)}`;

    return renderLayout({
      title: instanceId,
      breadcrumbs: [
        { label: "Dashboard", href: "/dashboard" },
        { label: agentName, href: `/dashboard/agents/${encodeURIComponent(agentName)}` },
        { label: instanceId },
      ],
      content,
      scripts: logViewerScript(agentName, instanceId),
    });
  }

  const startedAt = new Date(run.started_at);
  const endedAt = new Date(run.started_at + run.duration_ms);

  const content = `
    <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
      <h1 class="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white font-mono">${escapeHtml(run.instance_id)}</h1>
      <div class="flex items-center gap-2">
        ${run.result === "running" ? `<button class="px-3 py-1.5 text-sm rounded-md font-bold bg-red-600 hover:bg-red-700 text-white transition-colors" onclick="killThisInstance()">Kill</button>` : ""}
        ${resultBadge(run.result)}
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
      <div class="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-4">
        <h3 class="text-sm font-semibold text-slate-900 dark:text-white mb-3 uppercase tracking-wide">Run Info</h3>
        ${statRow("Trigger", run.trigger_type + (run.trigger_source ? ` (${run.trigger_source})` : ""))}
        ${statRow("Status", run.result)}
        ${run.exit_code != null ? statRow("Exit Code", `${run.exit_code}`) : ""}
        ${statRow("Started", startedAt.toLocaleString())}
        ${statRow("Ended", endedAt.toLocaleString())}
        ${statRow("Duration", formatDuration(run.duration_ms))}
        ${statRow("Turns", `${run.turn_count}`)}
        ${run.error_message ? `<div class="mt-3 p-2 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded text-sm text-red-700 dark:text-red-400 break-words">${escapeHtml(run.error_message)}</div>` : ""}
      </div>

      <div class="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-4">
        <h3 class="text-sm font-semibold text-slate-900 dark:text-white mb-3 uppercase tracking-wide">Token Usage</h3>
        ${statRow("Input Tokens", formatTokens(run.input_tokens))}
        ${statRow("Output Tokens", formatTokens(run.output_tokens))}
        ${statRow("Cache Read", formatTokens(run.cache_read_tokens))}
        ${statRow("Cache Write", formatTokens(run.cache_write_tokens))}
        ${statRow("Total Tokens", formatTokens(run.total_tokens))}
        ${statRow("Cost", formatCost(run.cost_usd))}
      </div>
    </div>

    <h2 class="text-base font-semibold text-slate-900 dark:text-white mb-3">Logs</h2>
    ${logViewerHtml(agentName, instanceId)}`;

  return renderLayout({
    title: instanceId,
    breadcrumbs: [
      { label: "Dashboard", href: "/dashboard" },
      { label: agentName, href: `/dashboard/agents/${encodeURIComponent(agentName)}` },
      { label: instanceId },
    ],
    content,
    scripts: logViewerScript(agentName, instanceId),
  });
}

function logViewerHtml(agentName: string, instanceId: string): string {
  return `
    <div class="flex items-center gap-3 mb-2">
      <button id="follow-btn" class="px-3 py-1 text-xs rounded-md font-bold border border-blue-500 bg-blue-500 text-white hover:bg-blue-600 transition-colors" onclick="toggleFollow()">Follow</button>
      <button class="px-3 py-1 text-xs rounded-md font-bold border border-orange-500 bg-orange-500 text-white hover:bg-orange-600 transition-colors" onclick="clearLogs()">Clear</button>
      <span id="line-count" class="text-xs text-slate-400">0 lines</span>
      <span id="conn-status" class="text-xs text-green-500">connected</span>
    </div>
    <div id="log-container" class="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-3 sm:p-4 font-mono text-xs sm:text-sm leading-relaxed overflow-y-auto scrollbar-thin" style="height: 500px;">
      <div id="empty-msg" class="text-slate-400 italic">Waiting for logs...</div>
    </div>`;
}

function logViewerScript(agentName: string, instanceId: string): string {
  return `<script>
    var agentName = ${JSON.stringify(agentName)};
    var instanceId = ${JSON.stringify(instanceId)};
    var container = document.getElementById("log-container");
    var emptyMsg = document.getElementById("empty-msg");
    var followBtn = document.getElementById("follow-btn");
    var lineCountEl = document.getElementById("line-count");
    var connStatus = document.getElementById("conn-status");

    var follow = true;
    var lineCount = 0;

    function toggleFollow() {
      follow = !follow;
      if (follow) {
        followBtn.className = "px-3 py-1 text-xs rounded-md border border-blue-500 bg-blue-500 text-white hover:bg-blue-600 transition-colors";
        container.scrollTop = container.scrollHeight;
      } else {
        followBtn.className = "px-3 py-1 text-xs rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors";
      }
    }

    function clearLogs() {
      container.innerHTML = "";
      lineCount = 0;
      lineCountEl.textContent = "0 lines";
    }

    var SKIP_MSGS = { "event": 1, "tool done": 1 };

    function formatEntry(p) {
      var time = '<span class="text-slate-400">' + esc(new Date(p.time).toLocaleTimeString("en-US", { hour12: false })) + '</span>  ';
      var msg = p.msg || "";
      var lvl = p.level || 30;

      if (SKIP_MSGS[msg]) return null;
      if (lvl <= 20 && msg !== "tool start") return null;

      if (msg === "assistant") {
        var text = p.text || "";
        if (!text) return null;
        var lines = text.split("\\n");
        var out = time + '<span class="text-slate-900 dark:text-white font-medium">' + esc(lines[0]) + '</span>';
        for (var i = 1; i < lines.length; i++) {
          out += '<span class="text-slate-900 dark:text-white block pl-[7.5em]">' + esc(lines[i]) + '</span>';
        }
        return out;
      }
      if (msg === "bash") return time + '<span class="text-cyan-500">$ ' + esc(p.cmd || "") + '</span>';
      if (msg === "tool start") return time + '<span class="text-blue-500">\\u25b8 ' + esc(p.tool || "unknown") + '</span>';
      if (msg === "tool error") {
        var out = time + '<span class="text-red-500">\\u2717 ' + esc(p.tool || "unknown") + ' failed</span>';
        if (p.cmd) out += '<span class="block pl-[7.5em] text-slate-400 text-[0.9em]">$ ' + esc(String(p.cmd)) + '</span>';
        if (p.result) out += '<span class="block pl-[7.5em] text-slate-400 text-[0.9em]">' + esc(String(p.result).slice(0, 300)) + '</span>';
        return out;
      }
      if (msg.startsWith && msg.startsWith("Starting ")) {
        var ctr = p.container ? ' <span class="text-slate-400">(' + esc(p.container) + ')</span>' : "";
        return time + '<span class="text-purple-500 font-semibold">' + esc(msg) + '</span>' + ctr;
      }
      if (msg === "run completed" || msg === "run completed, rerun requested") {
        var suffix = msg.includes("rerun") ? ' <span class="text-yellow-500">(rerun requested)</span>' : "";
        return time + '<span class="text-green-500 font-semibold">Run completed</span>' + suffix;
      }
      if (msg === "container launched" || msg === "container finished" || msg.includes("container")) {
        return time + '<span class="text-slate-400">' + esc(msg) + '</span>';
      }
      if (lvl >= 50) {
        var detail = p.err ? '<span class="block pl-[7.5em] text-slate-400 text-[0.9em]">' + esc(JSON.stringify(p.err).slice(0, 300)) + '</span>' : "";
        return time + '<span class="text-red-500 font-semibold">ERROR: ' + esc(msg) + '</span>' + detail;
      }
      if (lvl >= 40) return time + '<span class="text-yellow-500">WARN: ' + esc(msg) + '</span>';
      return time + '<span class="text-slate-400">' + esc(msg) + '</span>';
    }

    function maybeRunHeader(p) {
      var msg = p.msg || "";
      if (msg.startsWith && msg.startsWith("Starting ") && (msg.includes(" run") || msg.includes(" container run"))) {
        var name = p.name || "agent";
        var ctr = p.container ? "  " + p.container : "";
        return '<div class="whitespace-pre-wrap break-all border-t border-slate-200 dark:border-slate-700 mt-2 pt-1.5 text-purple-500 font-semibold">\\u2500\\u2500 ' + esc(name + ctr) + ' ' + "\\u2500".repeat(50) + '</div>';
      }
      return null;
    }

    function appendEntry(p) {
      if (emptyMsg && emptyMsg.parentNode) emptyMsg.remove();
      var header = maybeRunHeader(p);
      if (header) {
        var hdiv = document.createElement("div");
        hdiv.innerHTML = header;
        container.appendChild(hdiv.firstChild);
      }
      var html = formatEntry(p);
      if (!html) return;
      var div = document.createElement("div");
      div.className = "whitespace-pre-wrap break-all py-px";
      div.innerHTML = html;
      container.appendChild(div);
      lineCount++;
      lineCountEl.textContent = lineCount + " line" + (lineCount !== 1 ? "s" : "");
      if (follow) container.scrollTop = container.scrollHeight;
    }

    container.addEventListener("scroll", function() {
      var atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 50;
      if (!atBottom && follow) { follow = false; followBtn.className = "px-3 py-1 text-xs rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors"; }
      else if (atBottom && !follow) { follow = true; followBtn.className = "px-3 py-1 text-xs rounded-md border border-blue-500 bg-blue-500 text-white hover:bg-blue-600 transition-colors"; }
    });

    function killThisInstance() {
      if (!confirm("Kill instance " + instanceId + "?")) return;
      ctrlPost("/control/kill/" + encodeURIComponent(instanceId));
    }

    // Log polling
    var logCursor = null;
    async function fetchLogs(initial) {
      try {
        var params = new URLSearchParams();
        if (initial) params.set("lines", "500");
        if (logCursor) params.set("cursor", logCursor);
        var res = await fetch("/api/logs/agents/" + encodeURIComponent(agentName) + "/" + encodeURIComponent(instanceId) + "?" + params, { credentials: "same-origin" });
        if (!res.ok) throw new Error(res.status);
        var data = await res.json();
        for (var i = 0; i < data.entries.length; i++) appendEntry(data.entries[i]);
        if (data.cursor) logCursor = data.cursor;
        connStatus.textContent = "connected";
        connStatus.className = "text-xs text-green-500";
      } catch(e) {
        connStatus.textContent = "disconnected";
        connStatus.className = "text-xs text-red-500";
      }
    }
    fetchLogs(true);
    setInterval(function() { fetchLogs(false); }, 1500);

    // Scroll up to load older logs
    var loadingOlder = false;
    var oldestTime = null;
    container.addEventListener("scroll", async function() {
      if (container.scrollTop < 100 && !loadingOlder && lineCount > 0) {
        loadingOlder = true;
        try {
          // Find oldest entry time
          var firstEntry = container.querySelector(".whitespace-pre-wrap");
          // Use a before param to load older entries
          if (oldestTime === null) {
            // Get time from the first visible log entry's data
            var params = new URLSearchParams();
            params.set("lines", "50");
            if (oldestTime) params.set("before", String(oldestTime));
            var res = await fetch("/api/logs/agents/" + encodeURIComponent(agentName) + "/" + encodeURIComponent(instanceId) + "?" + params, { credentials: "same-origin" });
            if (res.ok) {
              var data = await res.json();
              if (data.entries.length > 0) {
                oldestTime = data.entries[0].time;
              }
            }
          }
        } catch(e) {}
        loadingOlder = false;
      }
    });
  </script>`;
}
