import { useEffect, useState, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { useStatusStream } from "../hooks/useStatusStream";
import { StateBadge, TriggerTypeBadge, ResultBadge } from "../components/Badge";
import {
  getTriggerHistory,
  triggerAgent,
  killAgentInstances,
  enableAgent,
  disableAgent,
  pauseScheduler,
  resumeScheduler,
} from "../lib/api";
import type { AgentStatus, TriggerHistoryRow } from "../lib/api";
import { fmtTokens, fmtSessionTime, fmtRelativeTime, shortId, shortName } from "../lib/format";

function formatScale(agent: AgentStatus): string {
  if (agent.state === "running" && agent.scale > 1) {
    return `${agent.runningCount}/${agent.scale}`;
  }
  if (agent.scale > 1) {
    return `\u00d7${agent.scale}`;
  }
  return "";
}

function ActionMenu({
  agent,
  isPaused,
  onAction,
}: {
  agent: AgentStatus;
  isPaused: boolean;
  onAction: (fn: () => Promise<unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="px-2 py-1 text-xs rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
      >
        Actions
        <svg className="w-3 h-3 ml-1 inline-block" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 mt-1 z-10 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md shadow-lg py-1 min-w-[100px]">
          <button
            onClick={() => { onAction(() => triggerAgent(agent.name)); setOpen(false); }}
            disabled={!agent.enabled || isPaused}
            className="w-full text-left px-3 py-1.5 text-xs text-green-700 dark:text-green-400 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Run
          </button>
          <button
            onClick={() => { onAction(() => killAgentInstances(agent.name)); setOpen(false); }}
            disabled={agent.runningCount === 0}
            className="w-full text-left px-3 py-1.5 text-xs text-red-700 dark:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Kill
          </button>
          <button
            onClick={() => { onAction(() => agent.enabled ? disableAgent(agent.name) : enableAgent(agent.name)); setOpen(false); }}
            className="w-full text-left px-3 py-1.5 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            {agent.enabled ? "Disable" : "Enable"}
          </button>
        </div>
      )}
    </div>
  );
}

export function DashboardPage() {
  const { agents, schedulerInfo, connected } = useStatusStream();
  const [triggers, setTriggers] = useState<TriggerHistoryRow[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);

  // Fetch recent triggers
  useEffect(() => {
    getTriggerHistory(10, 0, false)
      .then((data) => setTriggers(data.triggers))
      .catch(() => {});
  }, []);

  const totalTokens = agents.reduce(
    (sum, a) => sum + (a.cumulativeUsage?.totalTokens ?? 0),
    0,
  );

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

  const isPaused = schedulerInfo?.paused ?? false;

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

      {/* Paused banner */}
      {isPaused && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3 text-sm text-yellow-700 dark:text-yellow-400 font-medium">
          Scheduler is paused
        </div>
      )}

      {/* Token usage bar */}
      {totalTokens > 0 && (
        <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-3">
          <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">
            Token Usage by Agent{schedulerInfo?.startedAt ? ` (${fmtSessionTime(schedulerInfo.startedAt)})` : ""}
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

      {/* Agent table + Recent Triggers side by side */}
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Agent table */}
        <div className="lg:w-1/2">
          <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800">
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                      Agent
                    </th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                      State
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
                          title={agent.name}
                        >
                          {shortName(agent.name)}
                        </Link>
                        {agent.description && (
                          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate max-w-[200px]">
                            {agent.description}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
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
                      <td className="px-4 py-2.5 text-right">
                        {/* Desktop: inline buttons */}
                        <div className="hidden sm:flex items-center justify-end gap-1.5">
                          <button
                            onClick={() =>
                              handleAction(() => triggerAgent(agent.name))
                            }
                            disabled={!agent.enabled || isPaused}
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
                        {/* Mobile: dropdown */}
                        <div className="sm:hidden">
                          <ActionMenu agent={agent} isPaused={isPaused} onAction={handleAction} />
                        </div>
                      </td>
                    </tr>
                  ))}
                  {agents.length === 0 && (
                    <tr>
                      <td
                        colSpan={3}
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
        </div>

        {/* Recent Triggers */}
        <div className="lg:w-1/2">
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
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                      Time
                    </th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                      Type
                    </th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                      Instance
                    </th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                      Agent
                    </th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
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
                        {fmtRelativeTime(t.ts)}
                      </td>
                      <td className="px-4 py-2">
                        <TriggerTypeBadge type={t.triggerType} />
                      </td>
                      <td className="px-4 py-2">
                        {t.instanceId ? (
                          <Link
                            to={`/dashboard/agents/${encodeURIComponent(t.agentName ?? "")}/instances/${encodeURIComponent(t.instanceId)}`}
                            className="font-mono text-xs text-blue-600 dark:text-blue-400 hover:underline"
                            title={t.instanceId}
                          >
                            {shortId(t.instanceId)}
                          </Link>
                        ) : (
                          <span className="text-xs text-slate-400">{"\u2014"}</span>
                        )}
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
                        colSpan={5}
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
        </div>
      </div>
    </div>
  );
}
