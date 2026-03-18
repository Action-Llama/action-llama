function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderLogsPage(agentName: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(agentName)} — Logs — Action Llama</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background: #0f172a; color: #e2e8f0; padding: 16px; display: flex; flex-direction: column; height: 100vh; height: 100dvh; }
  .top-bar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; flex-shrink: 0; flex-wrap: wrap; }
  .top-bar a { color: #60a5fa; text-decoration: none; font-size: 0.9rem; }
  .top-bar a:hover { text-decoration: underline; }
  h1 { font-size: 1.2rem; color: #f8fafc; }
  .agent-state { font-size: 0.85rem; color: #94a3b8; }
  .state-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; vertical-align: middle; }
  .controls { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; flex-shrink: 0; flex-wrap: wrap; }
  .controls button { background: #334155; color: #e2e8f0; border: 1px solid #475569; border-radius: 4px; padding: 6px 14px; cursor: pointer; font-size: 0.8rem; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
  .controls button:hover { background: #475569; }
  .controls button.active { background: #3b82f6; border-color: #3b82f6; }
  .controls .status { font-size: 0.8rem; color: #64748b; }
  .log-container { flex: 1; background: #1e293b; border-radius: 8px; padding: 12px; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.75rem; line-height: 1.5; overflow-y: auto; min-height: 0; -webkit-overflow-scrolling: touch; }
  .log-line { white-space: pre-wrap; word-break: break-all; padding: 1px 0; }
  .log-time { color: #64748b; }
  .log-msg { color: #cbd5e1; }
  .log-assistant { color: #f8fafc; font-weight: 500; }
  .log-assistant-cont { color: #f8fafc; padding-left: 7.5em; display: block; }
  .log-bash { color: #22d3ee; }
  .log-tool { color: #60a5fa; }
  .log-tool-error { color: #ef4444; }
  .log-lifecycle { color: #c084fc; font-weight: 600; }
  .log-completed { color: #22c55e; font-weight: 600; }
  .log-dim { color: #64748b; }
  .log-warn { color: #eab308; }
  .log-error { color: #ef4444; font-weight: 600; }
  .log-detail { color: #64748b; padding-left: 7.5em; display: block; font-size: 0.9em; }
  .run-header { border-top: 1px solid #334155; margin-top: 8px; padding-top: 6px; color: #c084fc; font-weight: 600; }
  .empty { color: #475569; font-style: italic; }
  .connection-status { font-size: 0.75rem; padding: 2px 8px; border-radius: 3px; }
  .connection-status.connected { color: #22c55e; }
  .connection-status.disconnected { color: #ef4444; }

  @media (max-width: 640px) {
    body { padding: 10px; }
    h1 { font-size: 1.05rem; }
    .top-bar { gap: 8px; margin-bottom: 8px; }
    .top-bar a { font-size: 0.8rem; }
    .controls button { padding: 8px 14px; font-size: 0.8rem; }
    .log-container { padding: 10px; font-size: 0.65rem; line-height: 1.45; border-radius: 6px; }
    .agent-state { font-size: 0.75rem; }
  }

  @media (min-width: 641px) {
    body { padding: 24px; }
    .log-container { padding: 16px; font-size: 0.8rem; line-height: 1.6; }
  }
</style>
</head>
<body>
  <div class="top-bar">
    <a href="/dashboard">&larr; Dashboard</a>
    <h1>${escapeHtml(agentName)}</h1>
    <span class="agent-state" id="agent-state"></span>
  </div>

  <div class="controls">
    <button id="follow-btn" class="active" onclick="toggleFollow()">Follow</button>
    <button onclick="clearLogs()">Clear</button>
    <span class="status" id="line-count">0 lines</span>
    <span class="connection-status connected" id="conn-status">connected</span>
  </div>

  <div class="log-container" id="log-container">
    <div class="empty" id="empty-msg">Waiting for logs...</div>
  </div>

  <script>
    const agentName = ${JSON.stringify(agentName)};
    const container = document.getElementById("log-container");
    const emptyMsg = document.getElementById("empty-msg");
    const followBtn = document.getElementById("follow-btn");
    const lineCountEl = document.getElementById("line-count");
    const connStatus = document.getElementById("conn-status");
    const agentStateEl = document.getElementById("agent-state");

    const stateColors = { running: "#22c55e", building: "#eab308", error: "#ef4444", idle: "#6b7280" };
    let follow = true;
    let lineCount = 0;

    function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

    function toggleFollow() {
      follow = !follow;
      followBtn.classList.toggle("active", follow);
      if (follow) container.scrollTop = container.scrollHeight;
    }

    function clearLogs() {
      container.innerHTML = "";
      lineCount = 0;
      lineCountEl.textContent = "0 lines";
    }

    const SKIP_MSGS = new Set(["event", "tool done"]);

    function fmtTime(ts) {
      return new Date(ts).toLocaleTimeString("en-US", { hour12: false });
    }

    function formatEntry(p) {
      var time = '<span class="log-time">' + esc(fmtTime(p.time)) + '</span>  ';
      var msg = p.msg || "";
      var lvl = p.level || 30;

      // Skip noise
      if (SKIP_MSGS.has(msg)) return null;
      if (lvl <= 20 && msg !== "tool start") return null;

      // Assistant text
      if (msg === "assistant") {
        var text = p.text || "";
        if (!text) return null;
        var lines = text.split("\\n");
        var out = time + '<span class="log-assistant">' + esc(lines[0]) + '</span>';
        for (var i = 1; i < lines.length; i++) {
          out += '<span class="log-assistant-cont">' + esc(lines[i]) + '</span>';
        }
        return out;
      }

      // Bash command
      if (msg === "bash") {
        return time + '<span class="log-bash">$ ' + esc(p.cmd || "") + '</span>';
      }

      // Tool start
      if (msg === "tool start") {
        return time + '<span class="log-tool">\\u25b8 ' + esc(p.tool || "unknown") + '</span>';
      }

      // Tool error
      if (msg === "tool error") {
        var out = time + '<span class="log-tool-error">\\u2717 ' + esc(p.tool || "unknown") + ' failed</span>';
        if (p.cmd) out += '<span class="log-detail">$ ' + esc(String(p.cmd)) + '</span>';
        if (p.result) out += '<span class="log-detail">' + esc(String(p.result).slice(0, 300)) + '</span>';
        return out;
      }

      // Run start
      if (msg.startsWith && msg.startsWith("Starting ")) {
        var ctr = p.container ? ' <span class="log-dim">(' + esc(p.container) + ')</span>' : "";
        return time + '<span class="log-lifecycle">' + esc(msg) + '</span>' + ctr;
      }

      // Run completed
      if (msg === "run completed" || msg === "run completed, rerun requested") {
        var suffix = msg.includes("rerun") ? ' <span class="log-warn">(rerun requested)</span>' : "";
        return time + '<span class="log-completed">Run completed</span>' + suffix;
      }

      // Container lifecycle
      if (msg === "container launched") {
        var ctr = p.container ? ' ' + esc(p.container) : "";
        return time + '<span class="log-dim">Container launched' + ctr + '</span>';
      }
      if (msg === "container finished" || msg === "container finished (rerun requested)") {
        var el = p.elapsed ? ' (' + esc(p.elapsed) + ')' : "";
        return time + '<span class="log-dim">Container finished' + el + '</span>';
      }
      if (msg === "container starting") {
        var model = p.modelId ? ' <span class="log-dim">model=' + esc(p.modelId) + '</span>' : "";
        return time + '<span class="log-lifecycle">Container starting: ' + esc(p.agentName || "") + '</span>' + model;
      }
      if (msg === "creating agent session" || msg === "session created, sending prompt") {
        return time + '<span class="log-dim">' + esc(msg) + '</span>';
      }

      // Errors
      if (lvl >= 50) {
        var detail = p.err ? '<span class="log-detail">' + esc(JSON.stringify(p.err).slice(0, 300)) + '</span>' : "";
        return time + '<span class="log-error">ERROR: ' + esc(msg) + '</span>' + detail;
      }

      // Warnings
      if (lvl >= 40) {
        return time + '<span class="log-warn">WARN: ' + esc(msg) + '</span>';
      }

      // Catch-all
      return time + '<span class="log-dim">' + esc(msg) + '</span>';
    }

    function maybeRunHeader(p) {
      var msg = p.msg || "";
      if (msg.startsWith && msg.startsWith("Starting ") && (msg.includes(" run") || msg.includes(" container run"))) {
        var name = p.name || "agent";
        var ctr = p.container ? "  " + p.container : "";
        return '<div class="log-line run-header">\\u2500\\u2500 ' + esc(name + ctr) + ' ' + "\\u2500".repeat(50) + '</div>';
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
      div.className = "log-line";
      div.innerHTML = html;
      container.appendChild(div);
      lineCount++;
      lineCountEl.textContent = lineCount + " line" + (lineCount !== 1 ? "s" : "");
      if (follow) container.scrollTop = container.scrollHeight;
    }

    // Pause follow when user scrolls up
    container.addEventListener("scroll", () => {
      const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 50;
      if (!atBottom && follow) {
        follow = false;
        followBtn.classList.remove("active");
      } else if (atBottom && !follow) {
        follow = true;
        followBtn.classList.add("active");
      }
    });

    // Log polling via cursor-based API
    let logCursor = null;
    let pollTimer = null;
    async function fetchLogs(initial) {
      try {
        const params = new URLSearchParams();
        if (initial) params.set("lines", "100");
        if (logCursor) params.set("cursor", logCursor);
        const res = await fetch("/api/logs/agents/" + encodeURIComponent(agentName) + "?" + params, { credentials: "same-origin" });
        if (!res.ok) throw new Error(res.status);
        const data = await res.json();
        for (const entry of data.entries) appendEntry(entry);
        if (data.cursor) logCursor = data.cursor;
        connStatus.textContent = "connected";
        connStatus.className = "connection-status connected";
      } catch {
        connStatus.textContent = "disconnected";
        connStatus.className = "connection-status disconnected";
      }
    }
    fetchLogs(true);
    pollTimer = setInterval(function() { fetchLogs(false); }, 1500);

    // Status stream for agent state
    const statusEs = new EventSource("/dashboard/api/status-stream");
    statusEs.onmessage = function(e) {
      const data = JSON.parse(e.data);
      if (data.agents) {
        const agent = data.agents.find(a => a.name === agentName);
        if (agent) {
          const color = stateColors[agent.state] || "#6b7280";
          agentStateEl.innerHTML = '<span class="state-dot" style="background:' + color + '"></span> ' + esc(agent.state);
        }
      }
    };
  </script>
</body>
</html>`;
}
