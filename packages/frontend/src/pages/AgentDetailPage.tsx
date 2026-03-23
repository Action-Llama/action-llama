import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { useStatusStream } from "../hooks/useStatusStream";
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
import { fmtDur, fmtCost, fmtTokens, fmtDateTime } from "../lib/format";

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
  const { agents, instances } = useStatusStream();
  const [detail, setDetail] = useState<AgentDetailData | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [runsTotal, setRunsTotal] = useState(0);
  const [runsPage, setRunsPage] = useState(1);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [scaleInput, setScaleInput] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const cursorRef = useRef<string | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const runsLimit = 20;

  const agent = agents.find((a) => a.name === name) ?? detail?.agent ?? null;
  const liveInstances = instances.filter((inst) => inst.agentName === name);
  const allRunning =
    liveInstances.length > 0
      ? liveInstances
      : detail?.runningInstances ?? [];

  // Load detail
  useEffect(() => {
    if (!name) return;
    getAgentDetail(name)
      .then((d) => {
        setDetail(d);
        if (d.agent) setScaleInput(String(d.agent.scale));
      })
      .catch(() => {});
  }, [name]);

  // Load runs
  useEffect(() => {
    if (!name) return;
    getAgentRuns(name, runsPage, runsLimit)
      .then((d) => {
        setRuns(d.runs);
        setRunsTotal(d.total);
      })
      .catch(() => {});
  }, [name, runsPage]);

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
  const config = detail?.agentConfig;
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
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">
            {name}
          </h1>
          {agent && <StateBadge state={agent.state} />}
          {agent && !agent.enabled && (
            <span className="text-xs text-slate-500 italic">(disabled)</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleAction(() => triggerAgent(name))}
            disabled={agent ? !agent.enabled : false}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-green-600 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
          >
            Run
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

      {/* Configuration */}
      {config && (
        <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-4">
          <h2 className="text-sm font-medium text-slate-900 dark:text-white mb-3">
            Configuration
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            {config.description && (
              <div className="sm:col-span-2">
                <span className="text-slate-500 dark:text-slate-400">
                  Description:
                </span>{" "}
                <span className="text-slate-700 dark:text-slate-300">
                  {config.description}
                </span>
              </div>
            )}
            <div>
              <span className="text-slate-500 dark:text-slate-400">
                Scale:
              </span>{" "}
              <input
                type="number"
                min={1}
                value={scaleInput}
                onChange={(e) => setScaleInput(e.target.value)}
                className="w-16 px-2 py-1 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-sm text-slate-900 dark:text-slate-200 mx-1"
              />
              <button
                onClick={handleScaleUpdate}
                className="px-2 py-1 text-xs rounded bg-blue-600 hover:bg-blue-700 text-white transition-colors"
              >
                Update
              </button>
            </div>
            {config.schedule && (
              <div>
                <span className="text-slate-500 dark:text-slate-400">
                  Schedule:
                </span>{" "}
                <code className="text-xs bg-slate-200 dark:bg-slate-800 px-1.5 py-0.5 rounded font-mono">
                  {config.schedule}
                </code>
              </div>
            )}
            {config.timeout && (
              <div>
                <span className="text-slate-500 dark:text-slate-400">
                  Timeout:
                </span>{" "}
                <span className="text-slate-700 dark:text-slate-300">
                  {fmtDur(config.timeout * 1000)}
                </span>
              </div>
            )}
            {config.models && config.models.length > 0 && (
              <div className="sm:col-span-2">
                <span className="text-slate-500 dark:text-slate-400">
                  Models:
                </span>
                <div className="mt-1 space-y-1">
                  {config.models.map((m, i) => (
                    <div
                      key={i}
                      className="text-xs text-slate-600 dark:text-slate-400"
                    >
                      {m.provider}/{m.model}
                      {m.thinkingLevel ? ` (${m.thinkingLevel})` : ""}
                      <span className="text-slate-400 dark:text-slate-500 ml-1">
                        [{m.authType}]
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {config.credentials && config.credentials.length > 0 && (
              <div>
                <span className="text-slate-500 dark:text-slate-400">
                  Credentials:
                </span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {config.credentials.map((c) => (
                    <span
                      key={c}
                      className="px-1.5 py-0.5 text-xs bg-slate-200 dark:bg-slate-800 rounded font-mono"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {config.webhooks && config.webhooks.length > 0 && (
              <div className="sm:col-span-2">
                <span className="text-slate-500 dark:text-slate-400">
                  Webhooks:
                </span>
                <div className="mt-1 space-y-1">
                  {config.webhooks.map((w, i) => (
                    <div
                      key={i}
                      className="text-xs text-slate-600 dark:text-slate-400"
                    >
                      {w.source ?? "unknown"}{" "}
                      {w.events?.join(", ")}
                      {w.repos && w.repos.length > 0 && (
                        <span className="ml-1">
                          repos: {w.repos.join(", ")}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {config.hooks && (config.hooks.pre?.length || config.hooks.post?.length) && (
              <div className="sm:col-span-2">
                <span className="text-slate-500 dark:text-slate-400">
                  Hooks:
                </span>
                <div className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                  {config.hooks.pre && config.hooks.pre.length > 0 && (
                    <div>
                      Pre: {config.hooks.pre.join(", ")}
                    </div>
                  )}
                  {config.hooks.post && config.hooks.post.length > 0 && (
                    <div>
                      Post: {config.hooks.post.join(", ")}
                    </div>
                  )}
                </div>
              </div>
            )}
            {config.params && Object.keys(config.params).length > 0 && (
              <div className="sm:col-span-2">
                <span className="text-slate-500 dark:text-slate-400">
                  Params:
                </span>
                <pre className="mt-1 text-xs bg-slate-200 dark:bg-slate-800 p-2 rounded overflow-x-auto">
                  {JSON.stringify(config.params, null, 2)}
                </pre>
              </div>
            )}
          </div>
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
                    {inst.id.slice(0, 8)}
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
                      {run.instance_id.slice(0, 8)}
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
    </div>
  );
}
