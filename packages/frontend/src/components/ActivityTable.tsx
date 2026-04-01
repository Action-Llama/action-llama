import { useState, useRef, useCallback, memo } from "react";
import { Link } from "react-router-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { TriggerBadge } from "./Badge";
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

interface ActivityTableRowProps {
  row: ActivityRow;
  index: number;
  agentNames: string[];
}

/** Memoized row component — per-row state does not affect other rows */
const ActivityTableRow = memo(function ActivityTableRow({
  row,
  index,
  agentNames,
}: ActivityTableRowProps) {
  // Per-row state — only this row re-renders when its summary changes
  const [isLoading, setIsLoading] = useState(false);
  const [localSummary, setLocalSummary] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState(false);

  const isDeadLetter = row.result === "dead-letter";
  const badge = triggerLabel(row);
  const instanceId = row.instanceId ?? "";

  // Effective summary: local (just generated) takes priority over DB value
  const effectiveSummary = instanceId
    ? (localSummary ?? row.summary ?? null)
    : null;

  const isExpanded = !collapsed;
  const isMobileExpanded = mobileExpanded;
  const canGenerate = canGenerateSummary(row);

  const handleGenerate = async () => {
    if (!row.agentName || !instanceId) return;
    setIsLoading(true);
    try {
      const result = await summarizeLogs(row.agentName, instanceId);
      if (result.summary) {
        setLocalSummary(result.summary);
      }
    } catch {
      // silently ignore errors
    } finally {
      setIsLoading(false);
    }
  };

  const toggleExpanded = () => {
    setCollapsed((prev) => !prev);
  };

  const toggleMobileExpanded = () => {
    setMobileExpanded((prev) => !prev);
  };

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

  // Agent instance ID element — large, colored, bold (matching dashboard agent row style)
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

  // Desktop summary cell content
  const desktopSummaryCell = (
    <td className="pl-0 pr-2 py-2.5 hidden md:table-cell align-top">
      {isLoading ? (
        <span className="text-xs text-slate-400 dark:text-slate-500 animate-pulse">
          Generating…
        </span>
      ) : effectiveSummary ? (
        <div className="flex items-start gap-1.5">
          <button
            onClick={() => toggleExpanded()}
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
              onClick={() => handleGenerate()}
              className="shrink-0 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 transition-colors"
              title="Regenerate summary"
            >
              ↻
            </button>
          )}
        </div>
      ) : canGenerate ? (
        <button
          onClick={() => handleGenerate()}
          className="text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
        >
          Generate
        </button>
      ) : (
        <span className="text-xs text-slate-300 dark:text-slate-600">—</span>
      )}
    </td>
  );

  return (
    <tr
      key={`${row.ts}-${index}`}
      className={`border-b border-slate-100 dark:border-slate-800/50 last:border-b-0 hover:bg-slate-100/60 dark:hover:bg-slate-800/40 transition-colors ${
        ROW_STATUS_STYLES[row.result] ?? ""
      }`}
    >
      {/* Time — relative if < 6h, with status dot */}
      <td
        className="pl-4 pr-1 py-2.5 text-slate-600 dark:text-slate-400 text-xs whitespace-nowrap align-top w-[1%]"
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

      {/* Instance — instance ID (large, colored) on top, trigger badge below */}
      <td className="pl-2 pr-2 py-2.5 whitespace-nowrap max-w-[200px]">
        <div className="flex flex-col gap-0.5">
          {/* Instance ID or agent name — large, colored, bold */}
          {agentEl}
          {/* Trigger badge below */}
          <div className="mt-0.5">
            {triggerEl}
          </div>
          {/* Dead letter reason if applicable */}
          {isDeadLetter && row.deadLetterReason && (
            <span className="text-xs text-red-500 dark:text-red-400">
              {row.deadLetterReason.replace(/_/g, " ")}
            </span>
          )}
          {/* Mobile-only summary section */}
          {canGenerate && (
            <div className="md:hidden mt-1">
              {isLoading ? (
                <span className="text-xs text-slate-400 dark:text-slate-500 animate-pulse">
                  Generating…
                </span>
              ) : effectiveSummary ? (
                <div>
                  <button
                    onClick={() => toggleMobileExpanded()}
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
                      onClick={() => handleGenerate()}
                      className="ml-2 text-xs text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 transition-colors"
                      title="Regenerate summary"
                    >
                      ↻ Regenerate
                    </button>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => handleGenerate()}
                  className="text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
                >
                  Generate summary
                </button>
              )}
            </div>
          )}
        </div>
      </td>

      {/* Summary column — desktop only */}
      {desktopSummaryCell}
    </tr>
  );
});

interface ActivityTableProps {
  rows: ActivityRow[];
  agentNames: string[];
  loading?: boolean;
  emptyMessage?: string;
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
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileExpanded, setIsMobileExpanded] = useState(false);

  const instanceId = row.instanceId ?? "";
  const isDeadLetter = row.result === "dead-letter";
  const badge = triggerLabel(row);
  const effectiveSummary = localSummary ?? row.summary ?? null;
  const canGenerate = canGenerateSummary(row);
  const isExpanded = !isCollapsed;

  const handleGenerate = useCallback(async () => {
    if (!row.agentName || !instanceId) return;
    setIsLoading(true);
    try {
      const result = await summarizeLogs(row.agentName, instanceId);
      if (result.summary) setLocalSummary(result.summary);
    } catch {
      // silently ignore
    } finally {
      setIsLoading(false);
    }
  }, [row.agentName, instanceId]);

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
    <div
      className={`flex border-b border-slate-100 dark:border-slate-800/50 last:border-b-0 hover:bg-slate-100/60 dark:hover:bg-slate-800/40 transition-colors ${
        ROW_STATUS_STYLES[row.result] ?? ""
      }`}
    >
      {/* Time cell */}
      <div
        className="pl-4 pr-1 py-2.5 text-slate-600 dark:text-slate-400 text-xs whitespace-nowrap flex-none w-[100px]"
        title={new Date(row.ts).toLocaleString()}
      >
        <span className="inline-flex items-center gap-1.5">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT_COLOR[row.result] ?? "bg-slate-400"}`}
            title={STATUS_LABEL[row.result] ?? row.result}
          />
          {fmtSmartTime(row.ts)}
        </span>
      </div>

      {/* Instance cell */}
      <div className="pl-2 pr-2 py-2.5 whitespace-nowrap max-w-[200px] flex-none">
        <div className="flex flex-col gap-0.5">
          {/* Instance ID or agent name — large, colored, bold */}
          {agentEl}
          {/* Trigger badge below */}
          <div className="mt-0.5">{triggerEl}</div>
          {/* Dead letter reason if applicable */}
          {isDeadLetter && row.deadLetterReason && (
            <span className="text-xs text-red-500 dark:text-red-400">
              {row.deadLetterReason.replace(/_/g, " ")}
            </span>
          )}
          {/* Mobile-only summary section */}
          {canGenerate && (
            <div className="md:hidden mt-1">
              {isLoading ? (
                <span className="text-xs text-slate-400 dark:text-slate-500 animate-pulse">
                  Generating…
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
                      onClick={handleGenerate}
                      className="ml-2 text-xs text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 transition-colors"
                      title="Regenerate summary"
                    >
                      ↻ Regenerate
                    </button>
                  )}
                </div>
              ) : (
                <button
                  onClick={handleGenerate}
                  className="text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
                >
                  Generate summary
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Summary cell — desktop only */}
      <div className="pl-0 pr-2 py-2.5 hidden md:block flex-1 min-w-0">
        {isLoading ? (
          <span className="text-xs text-slate-400 dark:text-slate-500 animate-pulse">
            Generating…
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
                onClick={handleGenerate}
                className="shrink-0 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 transition-colors"
                title="Regenerate summary"
              >
                ↻
              </button>
            )}
          </div>
        ) : canGenerate ? (
          <button
            onClick={handleGenerate}
            className="text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
          >
            Generate
          </button>
        ) : (
          <span className="text-xs text-slate-300 dark:text-slate-600">—</span>
        )}
      </div>
    </div>
  );
});

export function ActivityTable({
  rows,
  agentNames,
  loading = false,
  emptyMessage = "No activity found",
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

  return (
    <div className="w-full text-sm">
      {/* Header */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 sticky top-0 bg-slate-50 dark:bg-slate-900 z-10">
        <div className="pl-6 pr-1 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide flex-none w-[100px]">
          Time
        </div>
        <div className="pl-2 pr-2 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide flex-none max-w-[200px]">
          Instance
        </div>
        <div className="pl-0 pr-2 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide hidden md:block flex-1">
          Summary
        </div>
      </div>

      {/* Virtualized rows */}
      <div ref={parentRef} className="overflow-auto" style={{ maxHeight: "calc(100vh - 280px)" }}>
        <div style={{ height: `${virtualizer.getTotalSize()}px`, width: "100%", position: "relative" }}>
          {virtualizer.getVirtualItems().map((virtualRow) => (
            <div
              key={rows[virtualRow.index].instanceId ?? `${rows[virtualRow.index].ts}-${virtualRow.index}`}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <ActivityRowItem row={rows[virtualRow.index]} index={virtualRow.index} agentNames={agentNames} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
