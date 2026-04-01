import { useEffect, useState, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "../hooks/useQuery";
import { useAgents } from "../hooks/StatusStreamContext";
import { FilterSelect, MultiSelect } from "../components/FilterDropdown";
import type { MultiSelectOption } from "../components/FilterDropdown";
import { getActivity } from "../lib/api";
import type { ActivityRow } from "../lib/api";
import { ActivityTable } from "../components/ActivityTable";

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

function parseStatuses(param: string | null): string[] {
  if (!param) return DEFAULT_STATUSES;
  const values = param.split(",").filter(Boolean);
  return values.length > 0 ? values : DEFAULT_STATUSES;
}

export function ActivityPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const agentFilter = searchParams.get("agent") || undefined;
  const triggerTypeFilter = searchParams.get("type") || undefined;
  const statusParam = searchParams.get("status");
  const statusFilters = useMemo(() => parseStatuses(statusParam), [statusParam]);

  const [offset, setOffset] = useState(0);
  const agents = useAgents();
  const agentNames = agents.map((a) => a.name);

  const statusFilterKey = statusFilters.join(",");
  const statusesToSend = statusFilters.length === STATUS_OPTIONS.length ? undefined : statusFilters;

  const { data, isLoading } = useQuery<{ rows: ActivityRow[]; total: number }>({
    key: `activity:${offset}:${agentFilter ?? ""}:${triggerTypeFilter ?? ""}:${statusFilterKey}`,
    fetcher: (signal) => getActivity(PAGE_SIZE, offset, agentFilter, triggerTypeFilter, statusesToSend, signal),
    invalidateOn: ["runs", "triggers"],
    keyChangeDebounceMs: 150,
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  // Reset offset when filters change
  useEffect(() => {
    setOffset(0);
  }, [agentFilter, triggerTypeFilter, statusFilterKey]);

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
          <ActivityTable
            rows={rows}
            agentNames={agentNames}
            loading={isLoading && rows.length === 0}
          />
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-200 dark:border-slate-800">
            <button
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0}
              className="px-3 py-1 text-xs rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
            >
              Previous
            </button>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Page {page} of {totalPages} ({total} total)
            </span>
            <button
              onClick={() => setOffset(offset + PAGE_SIZE)}
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
