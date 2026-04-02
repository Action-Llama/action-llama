import { useState, useRef, useCallback, memo } from "react";
import { Link } from "react-router-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { TriggerBadge } from "./Badge";
import { SummarizeModal } from "./SummarizeModal";
import type { ActivityRow } from "../lib/api";
import { summarizeLogs } from "../lib/api";
import { fmtSmartTime } from "../lib/format";
import { agentHueStyle } from "../lib/color";

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

/** Build a trigger label from the row's trigger fields */
function triggerLabel(row: ActivityRow): string {
  // For webhooks: prefer "source event_summary" (e.g. "github issues opened")
  if (row.triggerType === "webhook" && row.triggerSource) {
    if (row.eventSummary && row.eventSummary !== row.triggerSource) {
      return `${row.triggerSource} ${row.eventSummary}`;
    }
    return row.triggerSource;
  }
  return row.triggerType;
}

/** Whether a row can have a summary generated */
function canGenerateSummary(row: ActivityRow): boolean {
  return (
    !!(row.agentName && row.instanceId) &&
    row.result !== "pending" &&
    row.result !== "running" &&
    row.result !== "dead-letter"
  );
}

interface ActivityRowItemProps {
  row: ActivityRow;
  index: number;
  agentNames: string[];
}

const ActivityRowItem = memo(function ActivityRowItem({ row, agentNames }: ActivityRowItemProps) {
  // Per-row UI state
  const [isLoading, setIsLoading] = useState(false);
  const [localSummary, setLocalSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileExpanded, setIsMobileExpanded] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const instanceId = row.instanceId ?? "";
  const isDeadLetter = row.result === "dead-letter";
  const badge = triggerLabel(row);
  const effectiveSummary = localSummary ?? row.summary ?? null;
  const canGenerate = canGenerateSummary(row);
  const isExpanded = !isCollapsed;

  const handleSummarize = useCallback(async (prompt: string) => {
    if (!row.agentName || !instanceId) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await summarizeLogs(row.agentName, instanceId, prompt);
      if (result.summary) setLocalSummary(result.summary);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to generate summary";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [row.agentName, instanceId]);

  const openModal = useCallback(() => setShowModal(true), []);
  const toggleExpanded = useCallback(() => setIsCollapsed((prev) => !prev), []);
  const toggleMobileExpanded = useCallback(() => setIsMobileExpanded((prev) => !prev), []);

  // Build trigger badge element (optionally wrapped in a link)
  const detailPath = row.instanceId
    ? `/dashboard/triggers/${encodeURIComponent(row.instanceId)}`
    : row.webhookReceiptId
      ? `/dashboard/webhooks/${encodeURIComponent(row.webhookReceiptId)}`
      : null;

  const triggerEl = detailPath ? (
    <Link to={detailPath} className="inline-flex items-center gap-1 hover:underline">
      <TriggerBadge label={badge} />
      {row.triggerType !== "webhook" && row.triggerSource && (
        <span className="text-xs text-slate-500 dark:text-slate-400">{row.triggerSource}</span>
      )}
    </Link>
  ) : (
    <span className="inline-flex items-center gap-1">
      <TriggerBadge label={badge} />
      {row.triggerType !== "webhook" && row.triggerSource && (
        <span className="text-xs text-slate-500 dark:text-slate-400">{row.triggerSource}</span>
      )}
    </span>
  );

  // Agent instance ID element — large, colored, bold
  const agentEl = !isDeadLetter && row.agentName && row.instanceId ? (
    <Link
      to={`/dashboard/agents/${encodeURIComponent(row.agentName)}/instances/${encodeURIComponent(row.instanceId)}`}
      className="font-medium hover:underline truncate block"
    >
      <span
        className="agent-color-text truncate text-sm md:text-base"
        style={agentHueStyle(row.agentName, agentNames)}
      >
        {row.instanceId}
      </span>
    </Link>
  ) : !isDeadLetter && row.agentName ? (
    <Link
      to={`/dashboard/agents/${encodeURIComponent(row.agentName)}`}
      className="font-medium hover:underline truncate block"
    >
      <span
        className="agent-color-text truncate text-sm md:text-base"
        style={agentHueStyle(row.agentName, agentNames)}
      >
        {row.agentName}
      </span>
    </Link>
  ) : null;

  return (
    <tr
      className={`border-b border-slate-100 dark:border-slate-800/50 last:border-b-0 hover:bg-slate-100/60 dark:hover:bg-slate-800/40 transition-colors ${
        ROW_STATUS_STYLES[row.result] ?? ""
      }`}
    >
      {showModal && (
        <SummarizeModal
          onClose={() => setShowModal(false)}
          onSubmit={handleSummarize}
        />
      )}
      {/* Time cell */}
      <td
        className="pl-4 pr-3 py-2.5 text-slate-600 dark:text-slate-400 text-xs whitespace-nowrap align-top"
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

      {/* Instance cell */}
      <td className="pl-2 pr-2 py-2.5 whitespace-nowrap max-w-[200px] align-top">
        <div className="flex flex-col gap-0.5">
          {agentEl}
          <div className="mt-0.5">{triggerEl}</div>
          {isDeadLetter && row.deadLetterReason && (
            <span className="text-xs text-red-500 dark:text-red-400">
              {row.deadLetterReason.replace(/_/g, " ")}
            </span>
          )}
          {canGenerate && (
            <div className="md:hidden mt-1 whitespace-normal">
              {isLoading ? (
                <span className="text-xs text-slate-400 dark:text-slate-500 animate-pulse">
                  Generating…
                </span>
              ) : error ? (
                <span className="text-xs text-red-500 dark:text-red-400" title={error}>
                  Failed to generate
                </span>
              ) : effectiveSummary ? (
                <div>
                  <button
                    onClick={toggleMobileExpanded}
                    className="text-xs text-slate-500 dark:text-slate-400 text-left hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                  >
                    {isMobileExpanded ? (
                      <span>{effectiveSummary}</span>
                    ) : (
                      <span>
                        {effectiveSummary.length > 60
                          ? `${effectiveSummary.slice(0, 60)}…`
                          : effectiveSummary}
                      </span>
                    )}
                  </button>
                  {isMobileExpanded && (
                    <button
                      onClick={openModal}
                      className="ml-2 text-xs text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 transition-colors"
                      title="Re-summarize"
                    >
                      ↻ Summarize
                    </button>
                  )}
                </div>
              ) : (
                <button
                  onClick={openModal}
                  className="text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
                >
                  Summarize
                </button>
              )}
            </div>
          )}
        </div>
      </td>

      {/* Summary cell — desktop only */}
      <td className="pl-0 pr-2 py-2.5 hidden md:table-cell align-top">
        {isLoading ? (
          <span className="text-xs text-slate-400 dark:text-slate-500 animate-pulse">
            Generating…
          </span>
        ) : error ? (
          <span className="text-xs text-red-500 dark:text-red-400" title={error}>
            Failed to generate — {error}
          </span>
        ) : effectiveSummary ? (
          <div className="flex items-start gap-1.5">
            <button
              onClick={toggleExpanded}
              className="text-xs text-slate-600 dark:text-slate-300 text-left hover:text-slate-900 dark:hover:text-white transition-colors"
              title={isExpanded ? "Collapse" : "Click to expand"}
            >
              {isExpanded ? (
                <span>{effectiveSummary}</span>
              ) : (
                <span className="line-clamp-2">{effectiveSummary}</span>
              )}
            </button>
            {canGenerate && (
              <button
                onClick={openModal}
                className="shrink-0 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 transition-colors"
                title="Re-summarize"
              >
                ↻
              </button>
            )}
          </div>
        ) : canGenerate ? (
          <button
            onClick={openModal}
            className="text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
          >
            Summarize
          </button>
        ) : (
          <span className="text-xs text-slate-300 dark:text-slate-600">—</span>
        )}
      </td>
    </tr>
  );
});

interface ActivityTableProps {
  rows: ActivityRow[];
  agentNames: string[];
  loading?: boolean;
  emptyMessage?: string;
  headerRight?: React.ReactNode;
}

export function ActivityTable({
  rows,
  agentNames,
  loading = false,
  emptyMessage = "No activity found",
  headerRight,
}: ActivityTableProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60,
    overscan: 10,
  });

  if (rows.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
        {loading ? "Loading..." : emptyMessage}
      </div>
    );
  }

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom = virtualItems.length > 0 ? totalSize - virtualItems[virtualItems.length - 1].end : 0;

  return (
    <div className="w-full text-sm">
      <div ref={parentRef} className="overflow-auto" style={{ maxHeight: "calc(100vh - 280px)" }}>
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900 z-10">
            <tr className="border-b border-slate-200 dark:border-slate-800">
              <th className="pl-6 pr-3 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide text-left whitespace-nowrap">
                Time
              </th>
              <th className="pl-2 pr-2 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide text-left whitespace-nowrap">
                Instance
              </th>
              <th className="pl-0 pr-2 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide text-left hidden md:table-cell w-full">
                <div className="flex items-center justify-between">
                  <span>Summary</span>
                  {headerRight}
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {paddingTop > 0 && (
              <tr><td colSpan={3} style={{ height: paddingTop }} /></tr>
            )}
            {virtualItems.map((virtualRow) => (
              <ActivityRowItem
                key={rows[virtualRow.index].instanceId ?? `${rows[virtualRow.index].ts}-${virtualRow.index}`}
                row={rows[virtualRow.index]}
                index={virtualRow.index}
                agentNames={agentNames}
              />
            ))}
            {paddingBottom > 0 && (
              <tr><td colSpan={3} style={{ height: paddingBottom }} /></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
