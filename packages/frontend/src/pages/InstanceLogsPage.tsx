import { useContext, useEffect, useState, useCallback, useRef } from "react";
import { useQuery } from "../hooks/useQuery";
import { usePolling } from "../hooks/usePolling";
import { getInstanceLogs, getLocks, summarizeLogs } from "../lib/api";
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

  const [summaryText, setSummaryText] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

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
      const params: Record<string, string> = { lines: "100" };
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

  const handleSummarize = useCallback(async () => {
    if (!name || !id) return;
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const result = await summarizeLogs(name, id);
      if (result.error) {
        setSummaryError(result.error);
      } else {
        setSummaryText(result.summary);
      }
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : "Failed to summarize");
    } finally {
      setSummaryLoading(false);
    }
  }, [name, id]);

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
              onClick={handleSummarize}
              disabled={summaryLoading || logs.length === 0}
              className="px-2 py-1 text-xs rounded bg-purple-600 hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
            >
              {summaryLoading ? (
                <span className="flex items-center gap-1">
                  <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Summarizing…
                </span>
              ) : "Summarize"}
            </button>
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
          {summaryText && (
            <div className="relative mb-3">
              <div className="bg-purple-900/90 border border-purple-700 rounded-lg p-4 text-sm text-purple-100">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xs font-medium text-purple-300 mb-1">Summary</div>
                    <p className="leading-relaxed">{summaryText}</p>
                  </div>
                  <button
                    onClick={() => setSummaryText(null)}
                    className="text-purple-400 hover:text-purple-200 flex-shrink-0"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          )}
          {summaryError && (
            <div className="relative mb-3">
              <div className="bg-red-900/90 border border-red-700 rounded-lg p-3 text-sm text-red-200 flex items-center justify-between">
                <span>{summaryError}</span>
                <button
                  onClick={() => setSummaryError(null)}
                  className="text-red-400 hover:text-red-200 ml-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          )}
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
