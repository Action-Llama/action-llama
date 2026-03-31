import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { useStatusStream } from "../hooks/StatusStreamContext";
import { useInvalidation } from "../hooks/useInvalidation";
import { StatCard } from "../components/StatCard";
import { TriggerTypeBadge, ResultBadge } from "../components/Badge";
import {
  getAgentDetail,
  getAgentRuns,
} from "../lib/api";
import type { AgentDetailData, RunRecord } from "../lib/api";
import { fmtDur, fmtCost, fmtTokens, fmtSmartTime, shortId } from "../lib/format";

const PAGE_SIZE = 20;

export function AgentStatsPage() {
  const { name } = useParams<{ name: string }>();
  const { agents } = useStatusStream();
  const [detail, setDetail] = useState<AgentDetailData | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [totalRuns, setTotalRuns] = useState(0);
  const [page, setPage] = useState(1);

  const refetch = useCallback(() => {
    if (!name) return;
    getAgentDetail(name)
      .then((d) => setDetail(d))
      .catch(() => {});
  }, [name]);

  const refetchRuns = useCallback(() => {
    if (!name) return;
    getAgentRuns(name, page, PAGE_SIZE)
      .then((d) => {
        setRuns(d.runs);
        setTotalRuns(d.total);
      })
      .catch(() => {});
  }, [name, page]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useEffect(() => {
    refetchRuns();
  }, [refetchRuns]);

  useInvalidation("stats", name, refetch);

  if (!name) return null;

  const summary = detail?.summary;
  const totalPages = Math.ceil(totalRuns / PAGE_SIZE);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link
            to={`/dashboard/agents/${encodeURIComponent(name)}`}
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
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">
              {name}
            </h1>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Stats
            </div>
          </div>
        </div>
        <Link
          to={`/dashboard/agents/${encodeURIComponent(name)}`}
          className="px-3 py-1.5 text-xs font-medium rounded-md bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors"
        >
          Back to Agent
        </Link>
      </div>

      {/* Stats Grid */}
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

      {/* Runs Table */}
      <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-sm font-medium text-slate-900 dark:text-white">Runs</h2>
          {totalRuns > 0 && (
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {totalRuns} total
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <th className="text-left pl-4 pr-2 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Time</th>
                <th className="text-left px-2 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Trigger</th>
                <th className="text-left px-2 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Instance</th>
                <th className="text-left px-2 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Result</th>
                <th className="text-left px-2 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Duration</th>
                <th className="text-left px-2 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Tokens</th>
                <th className="text-left px-2 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide pr-4">Cost</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run, i) => (
                <tr
                  key={`${run.instance_id}-${i}`}
                  className="border-b border-slate-100 dark:border-slate-800/50 last:border-b-0 hover:bg-slate-100/60 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <td className="pl-4 pr-2 py-2.5 text-slate-600 dark:text-slate-400 text-xs whitespace-nowrap" title={new Date(run.started_at).toLocaleString()}>
                    {fmtSmartTime(run.started_at)}
                  </td>
                  <td className="px-2 py-2.5">
                    <span className="inline-flex items-center gap-1.5">
                      <TriggerTypeBadge type={run.trigger_type} />
                      {run.trigger_source && (
                        <span className="text-xs text-slate-600 dark:text-slate-400">{run.trigger_source}</span>
                      )}
                    </span>
                  </td>
                  <td className="px-2 py-2.5">
                    <Link
                      to={`/dashboard/agents/${encodeURIComponent(name)}/instances/${encodeURIComponent(run.instance_id)}`}
                      className="font-mono text-xs text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {shortId(run.instance_id)}
                    </Link>
                  </td>
                  <td className="px-2 py-2.5">
                    <ResultBadge result={run.result} />
                  </td>
                  <td className="px-2 py-2.5 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                    {run.duration_ms ? fmtDur(run.duration_ms) : "\u2014"}
                  </td>
                  <td className="px-2 py-2.5 text-xs text-slate-600 dark:text-slate-400">
                    {fmtTokens(run.total_tokens)}
                  </td>
                  <td className="px-2 py-2.5 text-xs text-slate-600 dark:text-slate-400 pr-4">
                    {fmtCost(run.cost_usd)}
                  </td>
                </tr>
              ))}
              {runs.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-500 dark:text-slate-400 text-xs">
                    No runs yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-200 dark:border-slate-800">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
