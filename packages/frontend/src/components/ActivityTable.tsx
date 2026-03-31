import { Link } from "react-router-dom";
import { TriggerTypeBadge, ResultBadge } from "./Badge";
import type { ActivityRow } from "../lib/api";
import { fmtSmartTime } from "../lib/format";
import { agentHueStyle } from "../lib/color";

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

/** Build link to trigger detail page */
function triggerDetailPath(row: ActivityRow): string | null {
  if (row.instanceId) return `/dashboard/triggers/${encodeURIComponent(row.instanceId)}`;
  if (row.webhookReceiptId) return `/dashboard/webhooks/${encodeURIComponent(row.webhookReceiptId)}`;
  return null;
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
          <th className="text-left pl-4 pr-2 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
            Time
          </th>
          <th className="text-left px-2 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
            Status
          </th>
          <th className="text-left px-2 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
            Trigger
          </th>
          <th className="text-left px-2 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
            Instance
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
              {/* Time — relative if < 6h */}
              <td
                className="pl-4 pr-2 py-2.5 text-slate-600 dark:text-slate-400 text-xs whitespace-nowrap"
                title={new Date(row.ts).toLocaleString()}
              >
                {fmtSmartTime(row.ts)}
              </td>

              {/* Status */}
              <td className="px-2 py-2.5">
                <ResultBadge result={row.result} deadLetterReason={row.deadLetterReason} />
              </td>

              {/* Trigger — links to trigger detail */}
              <td className="px-2 py-2.5">
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

              {/* Instance — full instanceId, colored like its agent */}
              <td className="px-2 py-2.5">
                {row.instanceId && row.agentName ? (
                  <Link
                    to={`/dashboard/agents/${encodeURIComponent(row.agentName)}/instances/${encodeURIComponent(row.instanceId)}`}
                    className="hover:underline flex items-center gap-1.5"
                    style={{ fontSize: "16px" }}
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0 agent-color-dot"
                      style={agentHueStyle(row.agentName, agentNames)}
                    />
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
                      className="w-2 h-2 rounded-full shrink-0 agent-color-dot"
                      style={agentHueStyle(row.agentName, agentNames)}
                    />
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
              </td>
            </tr>
          );
        })}
        {rows.length === 0 && loading && (
          <tr>
            <td
              colSpan={4}
              className="px-4 py-8 text-center text-slate-500 dark:text-slate-400"
            >
              Loading...
            </td>
          </tr>
        )}
        {rows.length === 0 && !loading && (
          <tr>
            <td
              colSpan={4}
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
