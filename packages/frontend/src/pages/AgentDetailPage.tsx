import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useStatusStream } from "../hooks/StatusStreamContext";
import { useInvalidation } from "../hooks/useInvalidation";
import { StatCard } from "../components/StatCard";
import { StateBadge, TriggerTypeBadge, ResultBadge } from "../components/Badge";
import {
  getAgentDetail,
  getAgentRuns,
  getAgentLogs,
  triggerAgent,
  killAgentInstances,
  killInstance,
  enableAgent,
  disableAgent,
  updateAgentScale,
} from "../lib/api";
import type {
  AgentDetailData,
  RunRecord,
  LogEntry,
  AgentInstance,
} from "../lib/api";
import { RunModal } from "../components/RunModal";
import { fmtDur, fmtCost, fmtTokens, fmtDateTime, shortId } from "../lib/format";
import { agentHueStyle } from "../lib/color";

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
  const { agents, instances } = useStatusStream();
  const [detail, setDetail] = useState<AgentDetailData | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [runsTotal, setRunsTotal] = useState(0);
  const [runsPage, setRunsPage] = useState(1);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [scaleInput, setScaleInput] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [showRunModal, setShowRunModal] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const runsLimit = 20;

  const agent = agents.find((a) => a.name === name) ?? detail?.agent ?? null;
  const liveInstances = instances.filter((inst) => inst.agentName === name && inst.status === "running");
  const allRunning =
    liveInstances.length > 0
      ? liveInstances
      : detail?.runningInstances ?? [];

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

  // Load runs
  const refetchRuns = useCallback(() => {
    if (!name) return;
    getAgentRuns(name, runsPage, runsLimit)
      .then((d) => {
        setRuns(d.runs);
        setRunsTotal(d.total);
      })
      .catch(() => {});
  }, [name, runsPage]);

  useEffect(() => {
    refetchRuns();
  }, [refetchRuns]);

  useInvalidation("stats", name, refetchDetail);
  useInvalidation("runs", name, refetchRuns);

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

  const summary = detail?.summary;
  const totalPages = Math.ceil(runsTotal / runsLimit);

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
            style={agentHueStyle(name ?? "")}
          />
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">
            {name}
          </h1>
          {agent && <StateBadge state={agent.state} />}
          {agent && !agent.enabled && (
            <span className="text-xs text-slate-500 italic">(disabled)</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {agent && (
            <div className="flex items-center gap-1 mr-1">
              <span className="text-xs text-slate-500 dark:text-slate-400">Scale:</span>
              <input
                type="number"
                min={1}
                value={scaleInput}
                onChange={(e) => setScaleInput(e.target.value)}
                className="w-14 px-2 py-1 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-xs text-slate-900 dark:text-slate-200"
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
            onClick={() => handleAction(() => killAgentInstances(name))}
            disabled={!agent || agent.runningCount === 0}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
          >
            Kill
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

      {/* Stats */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Total Runs" value={`${summary.totalRuns}`} />
          <StatCard label="Success" value={`${summary.okRuns}`} />
          <StatCard label="Errors" value={`${summary.errorRuns}`} />
          <StatCard
            label="Avg Duration"
            value={summary.avgDurationMs ? fmtDur(summary.avgDurationMs) : "\u2014"}
          />
          <StatCard
            label="Total Tokens"
            value={fmtTokens(summary.totalTokens)}
          />
          <StatCard label="Total Cost" value={fmtCost(summary.totalCost)} />
        </div>
      )}

      {/* Running Instances */}
      {allRunning.length > 0 && (
        <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800">
            <h2 className="text-sm font-medium text-slate-900 dark:text-white">
              Running Instances ({allRunning.length})
            </h2>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800/50">
            {allRunning.map((inst: AgentInstance) => (
              <div
                key={inst.id}
                className="px-4 py-3 flex items-center justify-between"
              >
                <div>
                  <Link
                    to={`/dashboard/agents/${encodeURIComponent(name)}/instances/${encodeURIComponent(inst.id)}`}
                    className="text-sm font-mono text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {shortId(inst.id)}
                  </Link>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {inst.trigger} &middot; started{" "}
                    {new Date(inst.startedAt).toLocaleTimeString()}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-green-600 dark:text-green-400">
                    {inst.status}
                  </span>
                  <button
                    onClick={() =>
                      handleAction(() => killInstance(inst.id))
                    }
                    className="px-2 py-1 text-xs rounded bg-red-600 hover:bg-red-700 text-white transition-colors"
                  >
                    Kill
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Instance History */}
      <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-sm font-medium text-slate-900 dark:text-white">
            Instance History ({runsTotal})
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                  Instance
                </th>
                <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                  Trigger
                </th>
                <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                  Started
                </th>
                <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                  Duration
                </th>
                <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                  Tokens
                </th>
                <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                  Cost
                </th>
                <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                  Result
                </th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr
                  key={run.instance_id}
                  className="border-b border-slate-100 dark:border-slate-800/50 last:border-0 hover:bg-slate-100/50 dark:hover:bg-slate-800/30"
                >
                  <td className="px-4 py-2">
                    <Link
                      to={`/dashboard/agents/${encodeURIComponent(name)}/instances/${encodeURIComponent(run.instance_id)}`}
                      className="font-mono text-xs text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {shortId(run.instance_id)}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    <TriggerTypeBadge type={run.trigger_type} />
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                    {fmtDateTime(run.started_at)}
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-600 dark:text-slate-400">
                    {fmtDur(run.duration_ms)}
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-600 dark:text-slate-400">
                    {fmtTokens(run.total_tokens)}
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-600 dark:text-slate-400">
                    {fmtCost(run.cost_usd)}
                  </td>
                  <td className="px-4 py-2">
                    <ResultBadge result={run.result} />
                  </td>
                </tr>
              ))}
              {runs.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-6 text-center text-slate-500 dark:text-slate-400 text-xs"
                  >
                    No runs recorded
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-200 dark:border-slate-800">
            <button
              onClick={() => setRunsPage((p) => Math.max(1, p - 1))}
              disabled={runsPage <= 1}
              className="px-3 py-1 text-xs rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
            >
              Previous
            </button>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Page {runsPage} of {totalPages}
            </span>
            <button
              onClick={() =>
                setRunsPage((p) => Math.min(totalPages, p + 1))
              }
              disabled={runsPage >= totalPages}
              className="px-3 py-1 text-xs rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
            >
              Next
            </button>
          </div>
        )}
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
