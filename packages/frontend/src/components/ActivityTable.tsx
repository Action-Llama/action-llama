import { useState } from "react";
import { Link } from "react-router-dom";
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

interface ActivityTableProps {
  rows: ActivityRow[];
  agentNames: string[];
  loading?: boolean;
  emptyMessage?: string;
}

export function ActivityTable({
  rows,
  agentNames,
  loading = false,
  emptyMessage = "No activity found",
}: ActivityTableProps) {
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [localSummaries, setLocalSummaries] = useState<Map<string, string>>(new Map());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [mobileExpandedIds, setMobileExpandedIds] = useState<Set<string>>(new Set());

  const handleGenerate = async (agentName: string, instanceId: string) => {
    setLoadingIds((prev) => new Set(prev).add(instanceId));
    try {
      const result = await summarizeLogs(agentName, instanceId);
      if (result.summary) {
        setLocalSummaries((prev) => new Map(prev).set(instanceId, result.summary));
      }
    } catch {
      // silently ignore errors
    } finally {
      setLoadingIds((prev) => {
        const next = new Set(prev);
        next.delete(instanceId);
        return next;
      });
    }
  };

  const toggleExpanded = (instanceId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(instanceId)) {
        next.delete(instanceId);
      } else {
        next.add(instanceId);
      }
      return next;
    });
  };

  const toggleMobileExpanded = (instanceId: string) => {
    setMobileExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(instanceId)) {
        next.delete(instanceId);
      } else {
        next.add(instanceId);
      }
      return next;
    });
  };

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-slate-200 dark:border-slate-800">
          <th className="text-left pl-6 pr-1 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide w-[1%] whitespace-nowrap">
            Time
          </th>
          <th className="text-left pl-2 pr-2 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
            Instance
          </th>
          <th className="text-left px-2 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide hidden md:table-cell">
            Summary
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => {
          const isDeadLetter = row.result === "dead-letter";
          const badge = triggerLabel(row);
          const instanceId = row.instanceId ?? "";

          // Effective summary: local (just generated) takes priority over DB value
          const effectiveSummary = instanceId
            ? (localSummaries.get(instanceId) ?? row.summary ?? null)
            : null;

          const isLoading = instanceId ? loadingIds.has(instanceId) : false;
          const isExpanded = instanceId ? expandedIds.has(instanceId) : false;
          const isMobileExpanded = instanceId ? mobileExpandedIds.has(instanceId) : false;
          const canGenerate = canGenerateSummary(row);

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
            <td className="px-2 py-2.5 hidden md:table-cell align-top">
              {isLoading ? (
                <span className="text-xs text-slate-400 dark:text-slate-500 animate-pulse">
                  Generating…
                </span>
              ) : effectiveSummary ? (
                <div className="flex items-start gap-1.5">
                  <button
                    onClick={() => instanceId && toggleExpanded(instanceId)}
                    className="text-xs text-slate-600 dark:text-slate-300 text-left hover:text-slate-900 dark:hover:text-white transition-colors"
                    title={isExpanded ? "Collapse" : "Click to expand"}
                  >
                    {isExpanded ? (
                      <span>{effectiveSummary}</span>
                    ) : (
                      <span className="line-clamp-1 max-w-xs">{effectiveSummary}</span>
                    )}
                  </button>
                  {canGenerate && (
                    <button
                      onClick={() => row.agentName && instanceId && handleGenerate(row.agentName, instanceId)}
                      className="shrink-0 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 transition-colors"
                      title="Regenerate summary"
                    >
                      ↻
                    </button>
                  )}
                </div>
              ) : canGenerate ? (
                <button
                  onClick={() => row.agentName && instanceId && handleGenerate(row.agentName, instanceId)}
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
              key={`${row.ts}-${i}`}
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
              <td className="pl-2 pr-2 py-2.5">
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
                            onClick={() => instanceId && toggleMobileExpanded(instanceId)}
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
                              onClick={() => row.agentName && instanceId && handleGenerate(row.agentName, instanceId)}
                              className="ml-2 text-xs text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 transition-colors"
                              title="Regenerate summary"
                            >
                              ↻ Regenerate
                            </button>
                          )}
                        </div>
                      ) : (
                        <button
                          onClick={() => row.agentName && instanceId && handleGenerate(row.agentName, instanceId)}
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
        })}
        {rows.length === 0 && loading && (
          <tr>
            <td
              colSpan={3}
              className="px-4 py-8 text-center text-slate-500 dark:text-slate-400"
            >
              Loading...
            </td>
          </tr>
        )}
        {rows.length === 0 && !loading && (
          <tr>
            <td
              colSpan={3}
              className="px-4 py-8 text-center text-slate-500 dark:text-slate-400"
            >
              {emptyMessage}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
