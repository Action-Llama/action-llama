import { useEffect, useState, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useInvalidation } from "../hooks/useInvalidation";
import { useStatusStream } from "../hooks/StatusStreamContext";
import { TriggerTypeBadge, ResultBadge } from "../components/Badge";
import { getActivity } from "../lib/api";
import type { ActivityRow } from "../lib/api";
import { fmtDateTime, shortId } from "../lib/format";
import { agentHueStyle } from "../lib/color";

const PAGE_SIZE = 50;

const STATUS_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "pending", label: "Pending" },
  { value: "running", label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "error", label: "Error" },
  { value: "dead-letter", label: "Dead Letter" },
];

export function ActivityPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const agentFilter = searchParams.get("agent") || undefined;
  const triggerTypeFilter = searchParams.get("type") || undefined;
  const statusFilter = searchParams.get("status") || "all";

  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const { agents } = useStatusStream();
  const agentNames = agents.map((a) => a.name);

  const setFilter = useCallback(
    (key: string, value: string | undefined) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (value && value !== "all") {
          next.set(key, value);
        } else {
          next.delete(key);
        }
        next.delete("offset");
        return next;
      });
    },
    [setSearchParams],
  );

  const load = useCallback(
    (newOffset: number) => {
      setLoading(true);
      getActivity(PAGE_SIZE, newOffset, agentFilter, triggerTypeFilter, statusFilter)
        .then((data) => {
          setRows(data.rows);
          setTotal(data.total);
          setOffset(newOffset);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    },
    [agentFilter, triggerTypeFilter, statusFilter],
  );

  useEffect(() => {
    load(0);
  }, [load]);

  const refetchPage = useCallback(() => {
    load(offset);
  }, [load, offset]);

  useInvalidation("runs", undefined, refetchPage);
  useInvalidation("triggers", undefined, refetchPage);

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Live pending count from SSE for badge display
  const livePendingCount = agentFilter
    ? agents.find((a) => a.name === agentFilter)?.queuedWebhooks ?? 0
    : agents.reduce((sum, a) => sum + (a.queuedWebhooks || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Activity</h1>
          {livePendingCount > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
              {livePendingCount} pending
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Agent filter */}
          <select
            value={agentFilter || ""}
            onChange={(e) => setFilter("agent", e.target.value || undefined)}
            className="text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white px-2 py-1"
          >
            <option value="">All Agents</option>
            {agents.map((a) => (
              <option key={a.name} value={a.name}>
                {a.name}
              </option>
            ))}
          </select>
          {/* Trigger type filter */}
          <select
            value={triggerTypeFilter || ""}
            onChange={(e) => setFilter("type", e.target.value || undefined)}
            className="text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white px-2 py-1"
          >
            <option value="">All Types</option>
            <option value="schedule">Schedule</option>
            <option value="webhook">Webhook</option>
            <option value="manual">Manual</option>
            <option value="agent">Agent</option>
          </select>
          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => setFilter("status", e.target.value)}
            className="text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white px-2 py-1"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Timestamp
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Type
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Source
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Agent
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Instance
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={`${row.ts}-${i}`}
                  className="border-b border-slate-100 dark:border-slate-800/50 last:border-0 hover:bg-slate-100/50 dark:hover:bg-slate-800/30"
                >
                  <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400 text-xs whitespace-nowrap">
                    {fmtDateTime(row.ts)}
                  </td>
                  <td className="px-4 py-2.5">
                    <TriggerTypeBadge type={row.triggerType} />
                  </td>
                  <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400 text-xs">
                    {row.triggerSource && row.webhookReceiptId ? (
                      <Link
                        to={`/dashboard/webhooks/${row.webhookReceiptId}`}
                        className="text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {row.triggerSource}
                      </Link>
                    ) : (
                      row.triggerSource ?? "\u2014"
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {row.agentName ? (
                      <Link
                        to={`/dashboard/agents/${encodeURIComponent(row.agentName)}`}
                        className="hover:underline text-xs flex items-center gap-1.5"
                      >
                        <span
                          className="w-2 h-2 rounded-full shrink-0 agent-color-dot"
                          style={agentHueStyle(row.agentName, agentNames)}
                        />
                        <span className="agent-color-text" style={agentHueStyle(row.agentName, agentNames)}>
                          {row.agentName}
                        </span>
                      </Link>
                    ) : (
                      <span className="text-slate-400 text-xs">{"\u2014"}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {row.instanceId && row.agentName ? (
                      <Link
                        to={`/dashboard/agents/${encodeURIComponent(row.agentName)}/instances/${encodeURIComponent(row.instanceId)}`}
                        className="font-mono text-xs text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {shortId(row.instanceId)}
                      </Link>
                    ) : (
                      <span className="text-slate-400 text-xs">{"\u2014"}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <ResultBadge result={row.result} deadLetterReason={row.deadLetterReason} />
                  </td>
                </tr>
              ))}
              {rows.length === 0 && !loading && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-slate-500 dark:text-slate-400"
                  >
                    No activity found
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-slate-500 dark:text-slate-400"
                  >
                    Loading...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-200 dark:border-slate-800">
            <button
              onClick={() => load(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0}
              className="px-3 py-1 text-xs rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
            >
              Previous
            </button>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Page {page} of {totalPages} ({total} total)
            </span>
            <button
              onClick={() => load(offset + PAGE_SIZE)}
              disabled={offset + PAGE_SIZE >= total}
              className="px-3 py-1 text-xs rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
