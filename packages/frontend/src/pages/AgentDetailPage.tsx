import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useStatusStream } from "../hooks/StatusStreamContext";
import { useInvalidation } from "../hooks/useInvalidation";
import { StatCard } from "../components/StatCard";
import { StateBadge, TriggerTypeBadge, ResultBadge } from "../components/Badge";
import {
  getAgentDetail,
  getAgentLogs,
  getJobs,
  triggerAgent,
  killAgentInstances,
  killInstance,
  enableAgent,
  disableAgent,
  updateAgentScale,
} from "../lib/api";
import type {
  AgentDetailData,
  JobRow,
  LogEntry,
  AgentInstance,
} from "../lib/api";
import { RunModal } from "../components/RunModal";
import { fmtDur, fmtCost, fmtTokens, fmtRelativeTime, shortId } from "../lib/format";
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
  const agentNames = agents.map((a) => a.name);
  const [detail, setDetail] = useState<AgentDetailData | null>(null);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [jobsTotal, setJobsTotal] = useState(0);
  const [jobsPending, setJobsPending] = useState(0);
  const [triggersOffset, setTriggersOffset] = useState(0);
  const triggersLimit = 5;
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [scaleInput, setScaleInput] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [killingAll, setKillingAll] = useState(false);
  const [killingInstances, setKillingInstances] = useState<Set<string>>(new Set());
  const [showRunModal, setShowRunModal] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

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

  // Load jobs
  const refetchJobs = useCallback(() => {
    if (!name) return;
    getJobs(triggersLimit, triggersOffset, name)
      .then((d) => {
        setJobs(d.jobs);
        setJobsTotal(d.total);
        setJobsPending(d.totalPending);
      })
      .catch(() => {});
  }, [name, triggersOffset]);

  useEffect(() => {
    refetchJobs();
  }, [refetchJobs]);

  useInvalidation("stats", name, refetchDetail);
  useInvalidation("runs", name, refetchJobs);

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

  // Merge running instances into jobs list for the agent detail page
  const mergedJobs: JobRow[] = triggersOffset === 0
    ? (() => {
        const running: JobRow[] = liveInstances.map((inst) => {
          const sep = inst.trigger.indexOf(":");
          return {
            ts: new Date(inst.startedAt).getTime(),
            triggerType: sep > -1 ? inst.trigger.slice(0, sep) : inst.trigger,
            triggerSource: sep > -1 ? inst.trigger.slice(sep + 1).trim() : null,
            agentName: inst.agentName,
            instanceId: inst.id,
            result: "running",
            webhookReceiptId: null,
            deadLetterReason: null,
          };
        });
        const jobIds = new Set(jobs.map((j) => j.instanceId));
        const unique = running.filter((r) => !jobIds.has(r.instanceId));
        return [...unique, ...jobs].sort((a, b) => b.ts - a.ts);
      })()
    : jobs;

  const runningOnPage = triggersOffset === 0 ? liveInstances.length : 0;
  const adjustedJobsTotal = jobsTotal + runningOnPage;
  const triggersPage = Math.floor(triggersOffset / triggersLimit) + 1;
  const triggersTotalPages = Math.max(1, Math.ceil(adjustedJobsTotal / triggersLimit));

  // Use live pending count from SSE stream if available
  const livePending = agent?.queuedWebhooks ?? jobsPending;

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
                    onClick={async () => {
                      setKillingInstances((prev) => new Set(prev).add(inst.id));
                      setActionError(null);
                      try { await killInstance(inst.id); }
                      catch (err) { setActionError(err instanceof Error ? err.message : "Action failed"); }
                      finally {
                        setKillingInstances((prev) => {
                          const next = new Set(prev);
                          next.delete(inst.id);
                          return next;
                        });
                      }
                    }}
                    disabled={killingInstances.has(inst.id)}
                    className="px-2 py-1 text-xs rounded bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                  >
                    {killingInstances.has(inst.id) ? (
                      <span className="flex items-center gap-1">
                        <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Killing…
                      </span>
                    ) : "Kill"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Jobs */}
      <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium text-slate-900 dark:text-white">
              Jobs
            </h2>
            {livePending > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                {livePending} pending
              </span>
            )}
          </div>
          <Link
            to={`/jobs?agent=${encodeURIComponent(name)}`}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            View all
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide w-[1%] whitespace-nowrap">
                  Time
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide w-[1%] whitespace-nowrap">
                  Trigger
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Instance
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide w-[1%] whitespace-nowrap">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {mergedJobs.map((j, i) => (
                <tr
                  key={`${j.ts}-${i}`}
                  className="border-b border-slate-100 dark:border-slate-800/50 last:border-0"
                >
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-400 text-xs whitespace-nowrap">
                    {fmtRelativeTime(j.ts)}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {j.instanceId ? (
                      <Link
                        to={`/dashboard/triggers/${encodeURIComponent(j.instanceId)}`}
                        className="flex items-center gap-1.5 hover:opacity-80"
                      >
                        <TriggerTypeBadge type={j.triggerType} />
                      </Link>
                    ) : (
                      <TriggerTypeBadge type={j.triggerType} />
                    )}
                  </td>
                  <td className="px-4 py-2 min-w-0">
                    {j.instanceId ? (
                      <Link
                        to={`/dashboard/agents/${encodeURIComponent(name)}/instances/${encodeURIComponent(j.instanceId)}`}
                        className="font-mono text-xs text-blue-600 dark:text-blue-400 hover:underline truncate block"
                        title={j.instanceId}
                      >
                        {shortId(j.instanceId)}
                      </Link>
                    ) : (
                      <span className="text-xs text-slate-400">{"\u2014"}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    <ResultBadge result={j.result} deadLetterReason={j.deadLetterReason} />
                  </td>
                </tr>
              ))}
              {mergedJobs.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-6 text-center text-slate-500 dark:text-slate-400 text-xs"
                  >
                    No jobs yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {triggersTotalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-200 dark:border-slate-800">
            <button
              onClick={() => setTriggersOffset((o) => Math.max(0, o - triggersLimit))}
              disabled={triggersOffset === 0}
              className="px-3 py-1 text-xs rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
            >
              Previous
            </button>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Page {triggersPage} of {triggersTotalPages}
            </span>
            <button
              onClick={() => setTriggersOffset((o) => o + triggersLimit)}
              disabled={triggersOffset + triggersLimit >= adjustedJobsTotal}
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
