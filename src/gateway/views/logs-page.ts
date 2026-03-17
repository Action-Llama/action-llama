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
  .log-line { white-space: pre-wrap; word-break: break-all; }
  .log-time { color: #64748b; }
  .log-level { font-weight: 600; }
  .log-level-trace { color: #64748b; }
  .log-level-debug { color: #94a3b8; }
  .log-level-info { color: #22c55e; }
  .log-level-warn { color: #eab308; }
  .log-level-error { color: #ef4444; }
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

    const levelNames = { 10: "TRACE", 20: "DEBUG", 30: "INFO", 40: "WARN", 50: "ERROR", 60: "FATAL" };
    const levelClasses = { 10: "trace", 20: "debug", 30: "info", 40: "warn", 50: "error", 60: "error" };

    function formatLogEntry(entry) {
      let time, level, msg;
      try {
        const parsed = JSON.parse(entry);
        time = parsed.time ? new Date(parsed.time).toLocaleTimeString() : "";
        const lvl = parsed.level || 30;
        level = levelNames[lvl] || "INFO";
        const cls = levelClasses[lvl] || "info";
        msg = parsed.msg || entry;
        return '<span class="log-time">' + esc(time) + '</span> <span class="log-level log-level-' + cls + '">' + level.padEnd(5) + '</span> ' + esc(msg);
      } catch {
        return esc(entry);
      }
    }

    function appendLine(entry) {
      if (emptyMsg && emptyMsg.parentNode) emptyMsg.remove();
      const div = document.createElement("div");
      div.className = "log-line";
      div.innerHTML = formatLogEntry(entry);
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
        for (const entry of data.entries) appendLine(JSON.stringify(entry));
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
