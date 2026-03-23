import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { useStatusStream } from "../hooks/useStatusStream";
import { StatCard } from "../components/StatCard";
import { StateBadge, TriggerTypeBadge, ResultBadge } from "../components/Badge";
import {
  getTriggerHistory,
  triggerAgent,
  killAgentInstances,
  enableAgent,
  disableAgent,
  pauseScheduler,
  resumeScheduler,
  getLocks,
} from "../lib/api";
import type { AgentStatus, TriggerHistoryRow } from "../lib/api";
import { fmtDur, fmtTime, fmtCost, fmtTokens, fmtDateTime } from "../lib/format";

function formatScale(agent: AgentStatus): string {
  if (agent.state === "running" && agent.scale > 1) {
    return `running ${agent.runningCount}/${agent.scale}`;
  }
  if (agent.scale > 1 && agent.state !== "running") {
    return `${agent.state} (\u00d7${agent.scale})`;
  }
  return agent.state;
}

export function DashboardPage() {
  const { agents, schedulerInfo, recentLogs, connected } = useStatusStream();
  const [triggers, setTriggers] = useState<TriggerHistoryRow[]>([]);
  const [locks, setLocks] = useState<
    { resourceKey: string; holder?: string; heldSince?: string; agentName?: string }[]
  >([]);
  const [actionError, setActionError] = useState<string | null>(null);

  // Fetch recent triggers
  useEffect(() => {
    getTriggerHistory(10, 0, false)
      .then((data) => setTriggers(data.triggers))
      .catch(() => {});
  }, []);

  // Poll locks
  useEffect(() => {
    const poll = () => {
      getLocks()
        .then((data) => setLocks(data.locks))
        .catch(() => {});
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, []);

  const totalTokens = agents.reduce(
    (sum, a) => sum + (a.cumulativeUsage?.totalTokens ?? 0),
    0,
  );
  const totalCost = agents.reduce(
    (sum, a) => sum + (a.cumulativeUsage?.cost ?? 0),
    0,
  );
  const runningCount = agents.filter((a) => a.state === "running").length;
  const errorCount = agents.filter((a) => a.state === "error").length;

  const handleAction = useCallback(
    async (fn: () => Promise<unknown>) => {
      setActionError(null);
      try {
        await fn();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Action failed");
      }
    },
    [],
  );

  const agentLocks = (name: string) =>
    locks.filter((l) => l.agentName === name || l.holder?.startsWith(name));

  return (
    <div className="space-y-6">
      {/* Connection status */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">
          Dashboard
        </h1>
        <div className="flex items-center gap-3">
          <span
            className={`text-xs ${connected ? "text-green-500" : "text-red-500"}`}
          >
            {connected ? "Connected" : "Disconnected"}
          </span>
          {schedulerInfo && (
            <button
              onClick={() =>
                handleAction(
                  schedulerInfo.paused ? resumeScheduler : pauseScheduler,
                )
              }
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                schedulerInfo.paused
                  ? "bg-green-600 hover:bg-green-700 text-white"
                  : "bg-yellow-600 hover:bg-yellow-700 text-white"
              }`}
            >
              {schedulerInfo.paused ? "Resume" : "Pause"}
            </button>
          )}
          <Link
            to="/dashboard/config"
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors"
          >
            Config
          </Link>
        </div>
      </div>

      {actionError && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-400">
          {actionError}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Agents" value={`${agents.length}`} />
        <StatCard
          label="Running"
          value={`${runningCount}${errorCount > 0 ? ` / ${errorCount} err` : ""}`}
        />
        <StatCard
          label="Session Tokens"
          value={fmtTokens(totalTokens)}
          id="total-tokens"
        />
        <StatCard
          label="Session Cost"
          value={fmtCost(totalCost)}
          id="total-cost"
        />
      </div>

      {/* Token usage bar */}
      {totalTokens > 0 && (
        <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-3">
          <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">
            Token Usage by Agent
          </div>
          <div className="flex h-3 rounded-full overflow-hidden bg-slate-200 dark:bg-slate-800">
            {agents
              .filter((a) => (a.cumulativeUsage?.totalTokens ?? 0) > 0)
              .map((a, i) => {
                const pct =
                  ((a.cumulativeUsage?.totalTokens ?? 0) / totalTokens) * 100;
                const colors = [
                  "bg-blue-500",
                  "bg-green-500",
                  "bg-purple-500",
                  "bg-amber-500",
                  "bg-pink-500",
                  "bg-cyan-500",
                ];
                return (
                  <div
                    key={a.name}
                    className={`${colors[i % colors.length]} transition-all`}
                    style={{ width: `${pct}%` }}
                    title={`${a.name}: ${fmtTokens(a.cumulativeUsage?.totalTokens ?? 0)}`}
                  />
                );
              })}
          </div>
          <div className="flex flex-wrap gap-3 mt-2">
            {agents
              .filter((a) => (a.cumulativeUsage?.totalTokens ?? 0) > 0)
              .map((a, i) => {
                const colors = [
                  "bg-blue-500",
                  "bg-green-500",
                  "bg-purple-500",
                  "bg-amber-500",
                  "bg-pink-500",
                  "bg-cyan-500",
                ];
                return (
                  <span
                    key={a.name}
                    className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400"
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${colors[i % colors.length]}`}
                    />
                    {a.name}:{" "}
                    {fmtTokens(a.cumulativeUsage?.totalTokens ?? 0)}
                  </span>
                );
              })}
          </div>
        </div>
      )}

      {/* Agent table (desktop) */}
      <div className="hidden sm:block">
        <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Agent
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  State
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Last Run
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Duration
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Next Run
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Tokens
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Locks
                </th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr
                  key={agent.name}
                  className="border-b border-slate-100 dark:border-slate-800/50 last:border-0 hover:bg-slate-100/50 dark:hover:bg-slate-800/30"
                >
                  <td className="px-4 py-2.5">
                    <Link
                      to={`/dashboard/agents/${encodeURIComponent(agent.name)}`}
                      className="font-medium text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {agent.name}
                    </Link>
                    {agent.description && (
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate max-w-[200px]">
                        {agent.description}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <StateBadge state={agent.state} />
                    {agent.scale > 1 && (
                      <span className="ml-1 text-xs text-slate-500">
                        {formatScale(agent)}
                      </span>
                    )}
                    {!agent.enabled && (
                      <span className="ml-1 text-xs text-slate-500 italic">
                        (disabled)
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400">
                    {fmtTime(agent.lastRunAt)}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400">
                    {agent.lastRunDuration != null
                      ? fmtDur(agent.lastRunDuration)
                      : "\u2014"}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400">
                    {fmtTime(agent.nextRunAt)}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400">
                    {fmtTokens(agent.cumulativeUsage?.totalTokens ?? 0)}
                  </td>
                  <td className="px-4 py-2.5">
                    {agentLocks(agent.name).length > 0 ? (
                      <span className="text-xs text-amber-600 dark:text-amber-400">
                        {agentLocks(agent.name).length} lock
                        {agentLocks(agent.name).length !== 1 ? "s" : ""}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">\u2014</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() =>
                          handleAction(() => triggerAgent(agent.name))
                        }
                        disabled={!agent.enabled}
                        className="px-2 py-1 text-xs rounded bg-green-600 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                        title="Trigger run"
                      >
                        Run
                      </button>
                      <button
                        onClick={() =>
                          handleAction(() => killAgentInstances(agent.name))
                        }
                        disabled={agent.runningCount === 0}
                        className="px-2 py-1 text-xs rounded bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                        title="Kill all instances"
                      >
                        Kill
                      </button>
                      <button
                        onClick={() =>
                          handleAction(() =>
                            agent.enabled
                              ? disableAgent(agent.name)
                              : enableAgent(agent.name),
                          )
                        }
                        className={`px-2 py-1 text-xs rounded transition-colors ${
                          agent.enabled
                            ? "bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600"
                            : "bg-blue-600 hover:bg-blue-700 text-white"
                        }`}
                      >
                        {agent.enabled ? "Disable" : "Enable"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {agents.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-8 text-center text-slate-500 dark:text-slate-400"
                  >
                    No agents found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Agent cards (mobile) */}
      <div className="sm:hidden space-y-3">
        {agents.map((agent) => (
          <div
            key={agent.name}
            className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-4"
          >
            <div className="flex items-center justify-between mb-2">
              <Link
                to={`/dashboard/agents/${encodeURIComponent(agent.name)}`}
                className="font-medium text-blue-600 dark:text-blue-400 hover:underline"
              >
                {agent.name}
              </Link>
              <StateBadge state={agent.state} />
            </div>
            {agent.description && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                {agent.description}
              </p>
            )}
            <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 dark:text-slate-400 mb-3">
              <div>
                Last: {fmtTime(agent.lastRunAt)}
              </div>
              <div>
                Duration:{" "}
                {agent.lastRunDuration != null
                  ? fmtDur(agent.lastRunDuration)
                  : "\u2014"}
              </div>
              <div>
                Next: {fmtTime(agent.nextRunAt)}
              </div>
              <div>
                Tokens:{" "}
                {fmtTokens(agent.cumulativeUsage?.totalTokens ?? 0)}
              </div>
            </div>
            {!agent.enabled && (
              <div className="text-xs text-slate-500 italic mb-2">
                Disabled
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() =>
                  handleAction(() => triggerAgent(agent.name))
                }
                disabled={!agent.enabled}
                className="px-2 py-1 text-xs rounded bg-green-600 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
              >
                Run
              </button>
              <button
                onClick={() =>
                  handleAction(() => killAgentInstances(agent.name))
                }
                disabled={agent.runningCount === 0}
                className="px-2 py-1 text-xs rounded bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
              >
                Kill
              </button>
              <button
                onClick={() =>
                  handleAction(() =>
                    agent.enabled
                      ? disableAgent(agent.name)
                      : enableAgent(agent.name),
                  )
                }
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  agent.enabled
                    ? "bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600"
                    : "bg-blue-600 hover:bg-blue-700 text-white"
                }`}
              >
                {agent.enabled ? "Disable" : "Enable"}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Recent Triggers */}
      <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-sm font-medium text-slate-900 dark:text-white">
            Recent Triggers
          </h2>
          <Link
            to="/dashboard/triggers"
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            View all
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                  Time
                </th>
                <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                  Type
                </th>
                <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                  Agent
                </th>
                <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {triggers.map((t, i) => (
                <tr
                  key={`${t.ts}-${i}`}
                  className="border-b border-slate-100 dark:border-slate-800/50 last:border-0"
                >
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-400 text-xs whitespace-nowrap">
                    {fmtDateTime(t.ts)}
                  </td>
                  <td className="px-4 py-2">
                    <TriggerTypeBadge type={t.triggerType} />
                  </td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-400">
                    {t.agentName ? (
                      <Link
                        to={`/dashboard/agents/${encodeURIComponent(t.agentName)}`}
                        className="text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {t.agentName}
                      </Link>
                    ) : (
                      "\u2014"
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <ResultBadge result={t.result} />
                  </td>
                </tr>
              ))}
              {triggers.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-6 text-center text-slate-500 dark:text-slate-400 text-xs"
                  >
                    No recent triggers
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-sm font-medium text-slate-900 dark:text-white">
            Recent Activity
          </h2>
        </div>
        <div className="max-h-64 overflow-y-auto scrollbar-thin">
          {recentLogs.length > 0 ? (
            <div className="divide-y divide-slate-100 dark:divide-slate-800/50">
              {recentLogs.map((log, i) => (
                <div key={i} className="px-4 py-2 text-xs font-mono">
                  <span className="text-slate-500 dark:text-slate-500">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>{" "}
                  <span className="text-blue-600 dark:text-blue-400 font-medium">
                    [{log.agent}]
                  </span>{" "}
                  <span className="text-slate-700 dark:text-slate-300">
                    {log.message}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-4 py-6 text-center text-slate-500 dark:text-slate-400 text-xs">
              No recent activity
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
