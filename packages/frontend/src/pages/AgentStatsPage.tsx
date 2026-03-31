import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { useStatusStream } from "../hooks/StatusStreamContext";
import { useInvalidation } from "../hooks/useInvalidation";
import { StatCard } from "../components/StatCard";
import {
  getAgentDetail,
} from "../lib/api";
import type { AgentDetailData } from "../lib/api";
import { fmtDur, fmtCost, fmtTokens } from "../lib/format";

export function AgentStatsPage() {
  const { name } = useParams<{ name: string }>();
  useStatusStream();
  const [detail, setDetail] = useState<AgentDetailData | null>(null);

  const refetch = useCallback(() => {
    if (!name) return;
    getAgentDetail(name)
      .then((d) => setDetail(d))
      .catch(() => {});
  }, [name]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useInvalidation("stats", name, refetch);

  if (!name) return null;

  const summary = detail?.summary;

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
    </div>
  );
}
