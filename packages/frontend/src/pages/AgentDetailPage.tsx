import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { useStatusStream } from "../hooks/StatusStreamContext";
import { useInvalidation } from "../hooks/useInvalidation";
import { usePolling } from "../hooks/usePolling";
import { ActivityTable } from "../components/ActivityTable";
import {
  getAgentLogs,
  getActivity,
} from "../lib/api";
import type {
  ActivityRow,
  LogEntry,
} from "../lib/api";


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

export function AgentDetailPage() {
  const { name } = useParams<{ name: string }>();
  const { agents } = useStatusStream();
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const cursorRef = useRef<string | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  const agent = agents.find((a) => a.name === name) ?? null;
  const agentNames = agents.map((a) => a.name);

  // Load activity
  const refetchActivity = useCallback(() => {
    if (!name) return;
    getActivity(5, 0, name).then((d) => setActivity(d.rows)).catch(() => {});
  }, [name]);

  useEffect(() => { refetchActivity(); }, [refetchActivity]);

  useInvalidation("runs", name, refetchActivity);

  // Poll logs
  usePolling(
    async (signal) => {
      if (!name) return;
      const params: Record<string, string> = { limit: "50" };
      if (cursorRef.current) params.cursor = cursorRef.current;
      const d = await getAgentLogs(name, params, signal);
      if (d.entries.length > 0) {
        setLogs((prev) => [...prev, ...d.entries].slice(-200));
        if (d.cursor) cursorRef.current = d.cursor;
      }
    },
    { intervalMs: 4000, enabled: !!name },
    [name],
  );

  // Scroll logs to bottom on new entries
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  if (!name) return null;

  return (
    <div className="space-y-6">
      {/* Activity */}
      <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium text-slate-900 dark:text-white">Activity</h2>
            {(agent?.queuedWebhooks ?? 0) > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                {agent!.queuedWebhooks} pending
              </span>
            )}
          </div>
          <Link
            to={`/activity?agent=${encodeURIComponent(name)}`}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            View all
          </Link>
        </div>
        <div className="overflow-x-auto">
          <ActivityTable
            rows={activity}
            agentNames={agentNames}
            emptyMessage="No activity yet"
          />
        </div>
      </div>

      {/* Recent Logs */}
      <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-sm font-medium text-slate-900 dark:text-white">
            Recent Logs
          </h2>
        </div>
        <div
          ref={logContainerRef}
          className="max-h-80 overflow-y-auto scrollbar-thin bg-slate-950 p-3"
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
