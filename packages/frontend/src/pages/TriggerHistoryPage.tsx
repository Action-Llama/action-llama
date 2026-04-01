import { useEffect, useState, useCallback, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "../hooks/useQuery";
import { useAgents, useInstances } from "../hooks/StatusStreamContext";
import { TriggerTypeBadge, ResultBadge } from "../components/Badge";
import { getTriggerHistory } from "../lib/api";
import type { TriggerHistoryRow } from "../lib/api";
import { fmtDateTime, shortId } from "../lib/format";
import { agentHueStyle } from "../lib/color";

const PAGE_SIZE = 50;

export function TriggerHistoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const agentFilter = searchParams.get("agent") || undefined;
  const triggerTypeFilter = searchParams.get("type") || undefined;

  const [offset, setOffset] = useState(0);
  const [showDeadLetters, setShowDeadLetters] = useState(false);
  const agents = useAgents();
  const instances = useInstances();
  const agentNames = agents.map((a) => a.name);

  const { data, isLoading } = useQuery<{ triggers: TriggerHistoryRow[]; total: number }>({
    key: `triggers:${offset}:${agentFilter ?? ""}:${triggerTypeFilter ?? ""}:${showDeadLetters}`,
    fetcher: (signal) => getTriggerHistory(PAGE_SIZE, offset, showDeadLetters, agentFilter, triggerTypeFilter, signal),
    invalidateOn: ["triggers"],
  });

  const triggers = data?.triggers ?? [];
  const total = data?.total ?? 0;

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

  useEffect(() => {
    setOffset(0);
  }, [agentFilter, triggerTypeFilter, showDeadLetters]);

  const mergedTriggers = useMemo(() => {
    // Only include running instances on the first page
    if (offset > 0) return triggers;
    const running: TriggerHistoryRow[] = instances
      .filter((inst) => {
        if (inst.status !== "running") return false;
        if (agentFilter && inst.agentName !== agentFilter) return false;
        if (triggerTypeFilter) {
          const sep = inst.trigger.indexOf(":");
          const type = sep > -1 ? inst.trigger.slice(0, sep) : inst.trigger;
          if (type !== triggerTypeFilter) return false;
        }
        return true;
      })
      .map((inst) => {
        const sep = inst.trigger.indexOf(":");
        return {
          ts: new Date(inst.startedAt).getTime(),
          triggerType: sep > -1 ? inst.trigger.slice(0, sep) : inst.trigger,
          triggerSource: sep > -1 ? inst.trigger.slice(sep + 1).trim() : undefined,
          agentName: inst.agentName,
          instanceId: inst.id,
          result: "running",
        };
      });
    const apiIds = new Set(triggers.map((t) => t.instanceId));
    const unique = running.filter((r) => !apiIds.has(r.instanceId));
    return [...unique, ...triggers].sort((a, b) => b.ts - a.ts);
  }, [instances, triggers, offset, agentFilter, triggerTypeFilter]);

  const runningCount = instances.filter((i) => {
    if (i.status !== "running") return false;
    if (agentFilter && i.agentName !== agentFilter) return false;
    if (triggerTypeFilter) {
      const sep = i.trigger.indexOf(":");
      const type = sep > -1 ? i.trigger.slice(0, sep) : i.trigger;
      if (type !== triggerTypeFilter) return false;
    }
    return true;
  }).length;
  const adjustedTotal = total + runningCount;

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(adjustedTotal / PAGE_SIZE));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">Triggers</h1>
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
          {/* Dead letters checkbox */}
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={showDeadLetters}
              onChange={(e) => setShowDeadLetters(e.target.checked)}
              className="rounded border-slate-300 dark:border-slate-700"
            />
            Show dead letters
          </label>
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
              {mergedTriggers.map((t, i) => (
                <tr
                  key={`${t.ts}-${i}`}
                  className="border-b border-slate-100 dark:border-slate-800/50 last:border-0 hover:bg-slate-100/50 dark:hover:bg-slate-800/30"
                >
                  <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400 text-xs whitespace-nowrap">
                    {fmtDateTime(t.ts)}
                  </td>
                  <td className="px-4 py-2.5">
                    <TriggerTypeBadge type={t.triggerType} />
                  </td>
                  <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400 text-xs">
                    {t.triggerSource && t.webhookReceiptId ? (
                      <Link
                        to={`/dashboard/webhooks/${t.webhookReceiptId}`}
                        className="text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {t.triggerSource}
                      </Link>
                    ) : (
                      t.triggerSource ?? "\u2014"
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {t.agentName ? (
                      <Link
                        to={`/dashboard/agents/${encodeURIComponent(t.agentName)}`}
                        className="hover:underline text-xs flex items-center gap-1.5"
                      >
                        <span className="agent-color-text" style={agentHueStyle(t.agentName, agentNames)}>
                          {t.agentName}
                        </span>
                      </Link>
                    ) : (
                      <span className="text-slate-400 text-xs">{"\u2014"}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {t.instanceId && t.agentName ? (
                      <Link
                        to={`/dashboard/agents/${encodeURIComponent(t.agentName)}/instances/${encodeURIComponent(t.instanceId)}`}
                        className="font-mono text-xs text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {shortId(t.instanceId)}
                      </Link>
                    ) : (
                      <span className="text-slate-400 text-xs">{"\u2014"}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <ResultBadge result={t.result} deadLetterReason={t.deadLetterReason} />
                  </td>
                </tr>
              ))}
              {mergedTriggers.length === 0 && !isLoading && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-slate-500 dark:text-slate-400"
                  >
                    No triggers found
                  </td>
                </tr>
              )}
              {isLoading && (
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
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0}
              className="px-3 py-1 text-xs rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
            >
              Previous
            </button>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Page {page} of {totalPages} ({adjustedTotal} total)
            </span>
            <button
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={offset + PAGE_SIZE >= adjustedTotal}
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
