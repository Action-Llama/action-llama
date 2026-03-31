import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
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
