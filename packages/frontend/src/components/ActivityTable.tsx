import { Link } from "react-router-dom";
import { TriggerBadge } from "./Badge";
import type { ActivityRow } from "../lib/api";
import { fmtSmartTime, shortId } from "../lib/format";
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
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-slate-200 dark:border-slate-800">
          <th className="text-left pl-6 pr-1 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide w-[1%] whitespace-nowrap">
            Time
          </th>
          <th className="text-left pl-2 pr-2 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
            Trigger
          </th>
          <th className="text-left pl-2 pr-2 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide hidden sm:table-cell">
            Agent
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => {
          const isDeadLetter = row.result === "dead-letter";
          const badge = triggerLabel(row);

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

          // Agent instance ID element (colored, linked)
          const agentEl = !isDeadLetter && row.agentName && row.instanceId ? (
            <Link
              to={`/dashboard/agents/${encodeURIComponent(row.agentName)}/instances/${encodeURIComponent(row.instanceId)}`}
              className="hover:underline"
            >
              <span
                className="agent-color-text font-medium font-mono text-xs"
                style={agentHueStyle(row.agentName, agentNames)}
              >
                {shortId(row.instanceId)}
              </span>
            </Link>
          ) : !isDeadLetter && row.agentName ? (
            <Link
              to={`/dashboard/agents/${encodeURIComponent(row.agentName)}`}
              className="hover:underline"
            >
              <span
                className="agent-color-text font-medium text-xs"
                style={agentHueStyle(row.agentName, agentNames)}
              >
                {row.agentName}
              </span>
            </Link>
          ) : null;

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

              {/* Trigger — badge with dead-letter reason; on mobile also shows agent below */}
              <td className="pl-2 pr-2 py-2.5">
                <div className="flex flex-col gap-0.5">
                  {triggerEl}
                  {isDeadLetter && row.deadLetterReason && (
                    <span className="text-xs text-red-500 dark:text-red-400">
                      {row.deadLetterReason.replace(/_/g, " ")}
                    </span>
                  )}
                  {/* Mobile: show agent instance below trigger */}
                  {agentEl && (
                    <span className="sm:hidden">{agentEl}</span>
                  )}
                </div>
              </td>

              {/* Agent — instance ID (hidden on mobile, shown in trigger cell instead) */}
              <td className="pl-2 pr-2 py-2.5 hidden sm:table-cell align-top">
                {agentEl ?? <span className="text-slate-400 text-xs">{"\u2014"}</span>}
              </td>
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
