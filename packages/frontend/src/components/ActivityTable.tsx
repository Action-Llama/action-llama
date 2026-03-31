import { Link } from "react-router-dom";
import { TriggerBadge } from "./Badge";
import type { ActivityRow } from "../lib/api";
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
                {/* Mobile-only trigger display */}
                <div className="sm:hidden mt-0.5">
                  {(() => {
                    const badgeLabel =
                      row.triggerType === "webhook" && row.triggerSource
                        ? row.triggerSource
                        : row.triggerType;
                    const secondary =
                      row.triggerType !== "webhook" && row.triggerSource ? (
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          {row.triggerSource}
                        </span>
                      ) : null;
                    return detailPath ? (
                      <Link to={detailPath} className="inline-flex items-center gap-1 hover:underline">
                        <TriggerBadge label={badgeLabel} />
                        {secondary}
                      </Link>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <TriggerBadge label={badgeLabel} />
                        {secondary}
                      </span>
                    );
                  })()}
                </div>
              </td>

              {/* Trigger — links to trigger detail (hidden on mobile) */}
              <td className="hidden sm:table-cell px-2 py-2.5">
                {(() => {
                  const badgeLabel =
                    row.triggerType === "webhook" && row.triggerSource
                      ? row.triggerSource
                      : row.triggerType;
                  const secondary =
                    row.triggerType !== "webhook" && row.triggerSource ? (
                      <span className="text-xs text-slate-600 dark:text-slate-400">
                        {row.triggerSource}
                      </span>
                    ) : null;
                  return detailPath ? (
                    <Link
                      to={detailPath}
                      className="inline-flex items-center gap-1.5 hover:underline"
                    >
                      <TriggerBadge label={badgeLabel} />
                      {secondary}
                    </Link>
                  ) : (
                    <span className="inline-flex items-center gap-1.5">
                      <TriggerBadge label={badgeLabel} />
                      {secondary}
                    </span>
                  );
                })()}
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
