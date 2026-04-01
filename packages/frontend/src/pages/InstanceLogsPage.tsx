import { useContext, useEffect, useState, useCallback, useRef } from "react";
import { useQuery } from "../hooks/useQuery";
import { usePolling } from "../hooks/usePolling";
import { getInstanceLogs, getLocks } from "../lib/api";
import type { LogEntry } from "../lib/api";
import { InstanceContext } from "../components/InstanceLayout";

function formatLogEntry(entry: LogEntry): {
  text: string;
  className: string;
} {
  const msg = entry.msg || "";
  if (entry.text && (msg.includes("assistant") || msg.includes("response"))) {
    return {
      text: `${msg}: ${entry.text}`,
      className: "text-white font-bold",
    };
  }
  if (entry.cmd || msg.includes("bash") || msg.includes("command")) {
    return {
      text: entry.cmd ? `$ ${entry.cmd}` : msg,
      className: "text-cyan-400",
    };
  }
  if (entry.tool || msg.includes("tool")) {
    return {
      text: entry.tool ? `[tool] ${entry.tool}: ${entry.result ?? ""}` : msg,
      className: "text-blue-400",
    };
  }
  if (entry.level >= 50 || entry.err) {
    return { text: msg, className: "text-red-400" };
  }
  if (entry.level >= 40) {
    return { text: msg, className: "text-yellow-400" };
  }
  return { text: msg, className: "text-slate-300" };
}

export function InstanceLogsPage() {
  const ctx = useContext(InstanceContext);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [following, setFollowing] = useState(true);
  const [connected, setConnected] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  const name = ctx?.name ?? "";
  const id = ctx?.id ?? "";
  const isRunning = ctx?.isRunning ?? false;

  // Poll locks
  const { data: locksData } = useQuery<{
    locks: {
      resourceKey: string;
      holder?: string;
      heldSince?: string;
      agentName?: string;
    }[];
  }>({
    key: `instance-locks:${id}`,
    fetcher: (signal) => getLocks(signal),
    pollIntervalMs: 5000,
    enabled: isRunning && !!ctx,
  });
  const locks = (locksData?.locks ?? []).filter(
    (l) => l.holder === id || (!l.holder && l.agentName === name),
  );

  // Poll logs (slower when not running)
  usePolling(
    async (signal) => {
      if (!name || !id) return;
      const params: Record<string, string> = { limit: "100" };
      if (cursorRef.current) params.cursor = cursorRef.current;
      try {
        const d = await getInstanceLogs(name, id, params, signal);
        setConnected(true);
        if (d.entries.length > 0) {
          setLogs((prev) => [...prev, ...d.entries]);
          if (d.cursor) cursorRef.current = d.cursor;
        }
      } catch {
        setConnected(false);
        throw undefined;
      }
    },
    { intervalMs: isRunning ? 3000 : 10000, enabled: !!name && !!id && !!ctx },
    [name, id, isRunning],
  );

  // Scroll follow
  useEffect(() => {
    if (following && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, following]);

  // Detect scroll-away to stop following
  const handleScroll = useCallback(() => {
    if (!logContainerRef.current) return;
    const el = logContainerRef.current;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setFollowing(atBottom);
  }, []);

  if (!ctx) return null;

  return (
    <div className="space-y-4">
      {/* Resource Locks */}
      {locks.length > 0 && (
        <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800">
            <h2 className="text-sm font-medium text-slate-900 dark:text-white">
              Resource Locks ({locks.length})
            </h2>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800/50">
            {locks.map((lock) => (
              <div
                key={lock.resourceKey}
                className="px-4 py-2.5 flex items-center justify-between"
              >
                <span className="text-sm font-mono text-slate-700 dark:text-slate-300">
                  {lock.resourceKey}
                </span>
                {lock.heldSince && (
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    since {new Date(lock.heldSince).toLocaleTimeString()}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Log Viewer */}
      <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-sm font-medium text-slate-900 dark:text-white">
            Logs
          </h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {logs.length} lines
            </span>
            <span
              className={`text-xs ${connected ? "text-green-500" : "text-red-500"}`}
            >
              {connected ? "Connected" : "Disconnected"}
            </span>
            <button
              onClick={() => setFollowing((f) => !f)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                following
                  ? "bg-blue-600 text-white"
                  : "bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
              }`}
            >
              Follow
            </button>
            <button
              onClick={() => {
                setLogs([]);
                cursorRef.current = null;
              }}
              className="px-2 py-1 text-xs rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors"
            >
              Clear
            </button>
          </div>
        </div>
        <div
          ref={logContainerRef}
          onScroll={handleScroll}
          className="min-h-[32rem] max-h-[calc(100vh-16rem)] overflow-y-auto scrollbar-thin bg-slate-950 p-3"
        >
          {logs.length > 0 ? (
            logs.map((entry, i) => {
              const { text, className } = formatLogEntry(entry);
              return (
                <div key={i} className="text-xs font-mono leading-5">
                  <span className="text-slate-600">
                    {new Date(entry.time).toLocaleTimeString()}
                  </span>{" "}
                  <span className={className}>{text}</span>
                </div>
              );
            })
          ) : (
            <div className="text-xs text-slate-500 text-center py-4">
              No log entries
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
