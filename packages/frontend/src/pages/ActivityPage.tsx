import { useEffect, useState, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useInvalidation } from "../hooks/useInvalidation";
import { useStatusStream } from "../hooks/StatusStreamContext";
import { TriggerTypeBadge } from "../components/Badge";
import { FilterSelect, MultiSelect } from "../components/FilterDropdown";
import type { MultiSelectOption } from "../components/FilterDropdown";
import { getActivity } from "../lib/api";
import type { ActivityRow } from "../lib/api";
import { fmtSmartTime } from "../lib/format";
import { agentHueStyle } from "../lib/color";

const PAGE_SIZE = 50;

const DEFAULT_STATUSES = ["pending", "running", "completed"];

const STATUS_OPTIONS: MultiSelectOption[] = [
  { value: "pending", label: "Pending", dot: "bg-amber-400" },
  { value: "running", label: "Running", dot: "bg-blue-500" },
  { value: "completed", label: "Completed", dot: "bg-green-500" },
  { value: "error", label: "Error", dot: "bg-red-500" },
  { value: "dead-letter", label: "Dead Letter", dot: "bg-red-300 dark:bg-red-800" },
];

const TRIGGER_TYPE_OPTIONS = [
  { value: "", label: "All Types" },
  { value: "schedule", label: "Schedule" },
  { value: "webhook", label: "Webhook" },
  { value: "manual", label: "Manual" },
  { value: "agent", label: "Agent" },
];

const STATUS_DOT_COLOR: Record<string, string> = {
  pending: "bg-amber-400",
  running: "bg-blue-500 animate-pulse",
  completed: "bg-green-500",
  error: "bg-red-500",
  "dead-letter": "bg-red-300 dark:bg-red-800",
  rerun: "bg-green-500",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  running: "Running",
  completed: "Completed",
  error: "Error",
  "dead-letter": "Dead Letter",
  rerun: "Rerun",
};

/** Row stripe color by status — subtle left border + background tint */
const ROW_STATUS_STYLES: Record<string, string> = {
  pending:
    "border-l-2 border-l-amber-400 dark:border-l-amber-500 bg-amber-50/40 dark:bg-amber-950/20",
  running:
    "border-l-2 border-l-blue-500 dark:border-l-blue-400 bg-blue-50/40 dark:bg-blue-950/20",
  completed:
    "border-l-2 border-l-green-500 dark:border-l-green-400",
  error:
    "border-l-2 border-l-red-500 dark:border-l-red-400 bg-red-50/30 dark:bg-red-950/20",
  "dead-letter":
    "border-l-2 border-l-red-300 dark:border-l-red-700 bg-red-50/20 dark:bg-red-950/10",
  rerun:
    "border-l-2 border-l-green-500 dark:border-l-green-400",
};

function parseStatuses(param: string | null): string[] {
  if (!param) return DEFAULT_STATUSES;
  const values = param.split(",").filter(Boolean);
  return values.length > 0 ? values : DEFAULT_STATUSES;
}

/** Build link to trigger detail page (uses instanceId) */
function triggerDetailPath(row: ActivityRow): string | null {
  if (row.instanceId) return `/dashboard/triggers/${encodeURIComponent(row.instanceId)}`;
  if (row.webhookReceiptId) return `/dashboard/webhooks/${encodeURIComponent(row.webhookReceiptId)}`;
  return null;
}

/** Human-readable trigger label */
function triggerLabel(row: ActivityRow): string {
  if (row.triggerSource) return `${row.triggerType}: ${row.triggerSource}`;
  return row.triggerType;
}

export function ActivityPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const agentFilter = searchParams.get("agent") || undefined;
  const triggerTypeFilter = searchParams.get("type") || undefined;
  const statusFilters = parseStatuses(searchParams.get("status"));

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
        if (value) {
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

  const setStatusFilters = useCallback(
    (statuses: string[]) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (statuses.length === 0 || statuses.length === STATUS_OPTIONS.length) {
          next.delete("status");
        } else {
          next.set("status", statuses.join(","));
        }
        next.delete("offset");
        return next;
      });
    },
    [setSearchParams],
  );

  const load = useCallback(
    (newOffset: number, isRefetch = false) => {
      if (!isRefetch) setLoading(true);
      const statusesToSend =
        statusFilters.length === STATUS_OPTIONS.length ? undefined : statusFilters;
      getActivity(PAGE_SIZE, newOffset, agentFilter, triggerTypeFilter, statusesToSend)
        .then((data) => {
          setRows(data.rows);
          setTotal(data.total);
          setOffset(newOffset);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    },
    [agentFilter, triggerTypeFilter, statusFilters],
  );

  useEffect(() => {
    load(0);
  }, [load]);

  const refetchPage = useCallback(() => {
    load(offset, true);
  }, [load, offset]);

  useInvalidation("runs", undefined, refetchPage);
  useInvalidation("triggers", undefined, refetchPage);

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const livePendingCount = agentFilter
    ? agents.find((a) => a.name === agentFilter)?.queuedWebhooks ?? 0
    : agents.reduce((sum, a) => sum + (a.queuedWebhooks || 0), 0);

  const agentOptions = [
    { value: "", label: "All Agents" },
    ...agents.map((a) => ({ value: a.name, label: a.name })),
  ];

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
        <div className="flex items-center gap-2 flex-wrap">
          <FilterSelect
            options={agentOptions}
            value={agentFilter || ""}
            onChange={(v) => setFilter("agent", v || undefined)}
            placeholder="All Agents"
          />
          <FilterSelect
            options={TRIGGER_TYPE_OPTIONS}
            value={triggerTypeFilter || ""}
            onChange={(v) => setFilter("type", v || undefined)}
            placeholder="All Types"
          />
          <MultiSelect
            options={STATUS_OPTIONS}
            selected={statusFilters}
            onChange={setStatusFilters}
            label="All Statuses"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <th className="text-left pl-6 pr-2 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Time
                </th>
                <th className="text-left px-2 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Instance
                </th>
                <th className="hidden sm:table-cell text-left px-2 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Trigger
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const detailPath = triggerDetailPath(row);
                return (
                  <tr
                    key={`${row.ts}-${i}`}
                    className={`border-b border-slate-100 dark:border-slate-800/50 last:border-b-0 hover:bg-slate-100/60 dark:hover:bg-slate-800/40 transition-colors ${
                      ROW_STATUS_STYLES[row.result] ?? ""
                    }`}
                  >
                    {/* Time — relative if < 6h, with status dot */}
                    <td
                      className="pl-4 pr-2 py-2.5 text-slate-600 dark:text-slate-400 text-xs whitespace-nowrap"
                      title={new Date(row.ts).toLocaleString()}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT_COLOR[row.result] ?? "bg-slate-400"}`}
                          title={STATUS_LABEL[row.result] ?? row.result}
                        />
                        {fmtSmartTime(row.ts)}
                      </span>
                    </td>

                    {/* Instance — full instanceId, colored like its agent */}
                    <td className="px-2 py-2.5">
                      {row.instanceId && row.agentName ? (
                        <Link
                          to={`/dashboard/agents/${encodeURIComponent(row.agentName)}/instances/${encodeURIComponent(row.instanceId)}`}
                          className="hover:underline flex items-center gap-1.5"
                          style={{ fontSize: "16px" }}
                        >
                          <span
                            className="agent-color-text font-mono"
                            style={agentHueStyle(row.agentName, agentNames)}
                          >
                            {row.instanceId}
                          </span>
                        </Link>
                      ) : row.agentName ? (
                        <Link
                          to={`/dashboard/agents/${encodeURIComponent(row.agentName)}`}
                          className="hover:underline flex items-center gap-1.5"
                          style={{ fontSize: "16px" }}
                        >
                          <span
                            className="agent-color-text"
                            style={agentHueStyle(row.agentName, agentNames)}
                          >
                            {row.agentName}
                          </span>
                        </Link>
                      ) : (
                        <span className="text-slate-400 text-xs">{"\u2014"}</span>
                      )}
                      {/* Mobile-only trigger display */}
                      <div className="sm:hidden mt-0.5">
                        {detailPath ? (
                          <Link to={detailPath} className="inline-flex items-center gap-1 hover:underline">
                            <TriggerTypeBadge type={row.triggerType} />
                            {row.triggerSource && (
                              <span className="text-xs text-slate-500 dark:text-slate-400">{row.triggerSource}</span>
                            )}
                          </Link>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <TriggerTypeBadge type={row.triggerType} />
                            {row.triggerSource && (
                              <span className="text-xs text-slate-500 dark:text-slate-400">{row.triggerSource}</span>
                            )}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Trigger — links to trigger detail (hidden on mobile) */}
                    <td className="hidden sm:table-cell px-2 py-2.5">
                      {detailPath ? (
                        <Link
                          to={detailPath}
                          className="inline-flex items-center gap-1.5 hover:underline"
                        >
                          <TriggerTypeBadge type={row.triggerType} />
                          {row.triggerSource && (
                            <span className="text-xs text-slate-600 dark:text-slate-400">
                              {row.triggerSource}
                            </span>
                          )}
                        </Link>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <TriggerTypeBadge type={row.triggerType} />
                          {row.triggerSource && (
                            <span className="text-xs text-slate-600 dark:text-slate-400">
                              {row.triggerSource}
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && !loading && (
                <tr>
                  <td
                    colSpan={3}
                    className="px-4 py-8 text-center text-slate-500 dark:text-slate-400"
                  >
                    No activity found
                  </td>
                </tr>
              )}
              {loading && rows.length === 0 && (
                <tr>
                  <td
                    colSpan={3}
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
