import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useStatusStream } from "../hooks/StatusStreamContext";
import { useInvalidation } from "../hooks/useInvalidation";
import { StateBadge, TriggerTypeBadge, ResultBadge } from "../components/Badge";
import {
  getAgentDetail,
  getAgentLogs,
  getActivity,
  triggerAgent,
  killAgentInstances,
  enableAgent,
  disableAgent,
  updateAgentScale,
} from "../lib/api";
import type {
  AgentDetailData,
  ActivityRow,
  LogEntry,
} from "../lib/api";
import { RunModal } from "../components/RunModal";
import { fmtSmartTime } from "../lib/format";
import { agentHueStyle } from "../lib/color";

const ROW_STATUS_STYLES: Record<string, string> = {
  pending: "border-l-2 border-l-amber-400 dark:border-l-amber-500 bg-amber-50/40 dark:bg-amber-950/20",
  running: "border-l-2 border-l-blue-500 dark:border-l-blue-400 bg-blue-50/40 dark:bg-blue-950/20",
  completed: "border-l-2 border-l-green-500 dark:border-l-green-400",
  error: "border-l-2 border-l-red-500 dark:border-l-red-400 bg-red-50/30 dark:bg-red-950/20",
  "dead-letter": "border-l-2 border-l-red-300 dark:border-l-red-700 bg-red-50/20 dark:bg-red-950/10",
  rerun: "border-l-2 border-l-green-500 dark:border-l-green-400",
};

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
  const navigate = useNavigate();
  const { agents } = useStatusStream();
  const agentNames = agents.map((a) => a.name);
  const [detail, setDetail] = useState<AgentDetailData | null>(null);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [scaleInput, setScaleInput] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [killingAll, setKillingAll] = useState(false);
  const [showRunModal, setShowRunModal] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  const agent = agents.find((a) => a.name === name) ?? detail?.agent ?? null;

  // Load detail
  const refetchDetail = useCallback(() => {
    if (!name) return;
    getAgentDetail(name)
      .then((d) => {
        setDetail(d);
        if (d.agent) setScaleInput(String(d.agent.scale));
      })
      .catch(() => {});
  }, [name]);

  useEffect(() => {
    refetchDetail();
  }, [refetchDetail]);

  // Load activity
  const refetchActivity = useCallback(() => {
    if (!name) return;
    getActivity(5, 0, name).then((d) => setActivity(d.rows)).catch(() => {});
  }, [name]);

  useEffect(() => { refetchActivity(); }, [refetchActivity]);

  useInvalidation("stats", name, refetchDetail);
  useInvalidation("runs", name, refetchActivity);

  // Poll logs
  useEffect(() => {
    if (!name) return;
    const poll = () => {
      const params: Record<string, string> = { limit: "50" };
      if (cursorRef.current) params.cursor = cursorRef.current;
      getAgentLogs(name, params)
        .then((d) => {
          if (d.entries.length > 0) {
            setLogs((prev) => [...prev, ...d.entries].slice(-200));
            if (d.cursor) cursorRef.current = d.cursor;
          }
        })
        .catch(() => {});
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, [name]);

  // Scroll logs to bottom on new entries
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  // Sync scale input when agent updates
  useEffect(() => {
    if (agent) setScaleInput(String(agent.scale));
  }, [agent?.scale]);

  const handleAction = useCallback(async (fn: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await fn();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    }
  }, []);

  const handleScaleUpdate = useCallback(() => {
    if (!name) return;
    const val = parseInt(scaleInput, 10);
    if (isNaN(val) || val < 1) return;
    handleAction(() => updateAgentScale(name, val));
  }, [name, scaleInput, handleAction]);

  if (!name) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link
            to="/dashboard"
            className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </Link>
          <span
            className="w-3 h-3 rounded-full shrink-0 agent-color-dot"
            style={agentHueStyle(name ?? "", agentNames)}
          />
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">
            {name}
          </h1>
          {agent && <StateBadge state={agent.state} />}
          {agent && !agent.enabled && (
            <span className="text-xs text-slate-500 italic">(disabled)</span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {agent && (
            <div className="flex items-center gap-1 mr-1">
              <span className="text-xs text-slate-500 dark:text-slate-400">Scale:</span>
              <input
                type="number"
                min={1}
                value={scaleInput}
                onChange={(e) => setScaleInput(e.target.value)}
                className="w-16 px-2 py-1 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-base text-slate-900 dark:text-slate-200"
              />
              <button
                onClick={handleScaleUpdate}
                className="px-2 py-1.5 text-xs font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white transition-colors"
              >
                Set
              </button>
            </div>
          )}
          <button
            onClick={() => setShowRunModal(true)}
            disabled={agent ? !agent.enabled : false}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-green-600 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
          >
            Run
          </button>
          <Link
            to={`/chat/${encodeURIComponent(name)}`}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-purple-600 hover:bg-purple-700 text-white transition-colors"
          >
            Chat
          </Link>
          <button
            onClick={async () => {
              setKillingAll(true);
              setActionError(null);
              try { await killAgentInstances(name); }
              catch (err) { setActionError(err instanceof Error ? err.message : "Action failed"); }
              finally { setKillingAll(false); }
            }}
            disabled={!agent || agent.runningCount === 0 || killingAll}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
          >
            {killingAll ? (
              <span className="flex items-center gap-1">
                <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Killing…
              </span>
            ) : "Kill"}
          </button>
          {agent && (
            <button
              onClick={() =>
                handleAction(() =>
                  agent.enabled
                    ? disableAgent(name)
                    : enableAgent(name),
                )
              }
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                agent.enabled
                  ? "bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600"
                  : "bg-blue-600 hover:bg-blue-700 text-white"
              }`}
            >
              {agent.enabled ? "Disable" : "Enable"}
            </button>
          )}
          <Link
            to={`/dashboard/agents/${encodeURIComponent(name)}/stats`}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            Stats
          </Link>
          <Link
            to={`/dashboard/agents/${encodeURIComponent(name)}/skill`}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors"
          >
            View Skill
          </Link>
        </div>
      </div>

      {actionError && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-400">
          {actionError}
        </div>
      )}

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
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <th className="text-left pl-4 pr-2 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Time</th>
                <th className="text-left px-2 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Status</th>
                <th className="text-left px-2 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Trigger</th>
                <th className="text-left px-2 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Instance</th>
              </tr>
            </thead>
            <tbody>
              {activity.map((row, i) => (
                <tr
                  key={`${row.ts}-${i}`}
                  className={`border-b border-slate-100 dark:border-slate-800/50 last:border-b-0 hover:bg-slate-100/60 dark:hover:bg-slate-800/40 transition-colors ${ROW_STATUS_STYLES[row.result] ?? ""}`}
                >
                  <td className="pl-4 pr-2 py-2.5 text-slate-600 dark:text-slate-400 text-xs whitespace-nowrap" title={new Date(row.ts).toLocaleString()}>
                    {fmtSmartTime(row.ts)}
                  </td>
                  <td className="px-2 py-2.5">
                    <ResultBadge result={row.result} deadLetterReason={row.deadLetterReason} />
                  </td>
                  <td className="px-2 py-2.5">
                    {row.instanceId ? (
                      <Link to={`/dashboard/triggers/${encodeURIComponent(row.instanceId)}`} className="inline-flex items-center gap-1.5 hover:underline">
                        <TriggerTypeBadge type={row.triggerType} />
                        {row.triggerSource && <span className="text-xs text-slate-600 dark:text-slate-400">{row.triggerSource}</span>}
                      </Link>
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        <TriggerTypeBadge type={row.triggerType} />
                        {row.triggerSource && <span className="text-xs text-slate-600 dark:text-slate-400">{row.triggerSource}</span>}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2.5">
                    {row.instanceId ? (
                      <Link
                        to={`/dashboard/agents/${encodeURIComponent(name)}/instances/${encodeURIComponent(row.instanceId)}`}
                        className="font-mono text-xs text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {row.instanceId}
                      </Link>
                    ) : (
                      <span className="text-slate-400 text-xs">{"\u2014"}</span>
                    )}
                  </td>
                </tr>
              ))}
              {activity.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-slate-500 dark:text-slate-400 text-xs">No activity yet</td>
                </tr>
              )}
            </tbody>
          </table>
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

      {showRunModal && name && (
        <RunModal
          agentName={name}
          onClose={() => setShowRunModal(false)}
          onRun={async (prompt) => {
            try {
              const result = await triggerAgent(name, prompt);
              if (result?.instanceId) {
                navigate(`/dashboard/agents/${encodeURIComponent(name)}/instances/${encodeURIComponent(result.instanceId)}`);
              }
            } catch (err) {
              setActionError(err instanceof Error ? err.message : "Action failed");
            }
          }}
        />
      )}
    </div>
  );
}
