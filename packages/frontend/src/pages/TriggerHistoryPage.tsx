import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { TriggerTypeBadge, ResultBadge } from "../components/Badge";
import { getTriggerHistory } from "../lib/api";
import type { TriggerHistoryRow } from "../lib/api";
import { fmtDateTime, shortId } from "../lib/format";

const PAGE_SIZE = 50;

export function TriggerHistoryPage() {
  const [triggers, setTriggers] = useState<TriggerHistoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [showDeadLetters, setShowDeadLetters] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    (newOffset: number, deadLetters: boolean) => {
      setLoading(true);
      getTriggerHistory(PAGE_SIZE, newOffset, deadLetters)
        .then((data) => {
          setTriggers(data.triggers);
          setTotal(data.total);
          setOffset(newOffset);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    },
    [],
  );

  useEffect(() => {
    load(0, showDeadLetters);
  }, [showDeadLetters, load]);

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link
            to="/dashboard"
            className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </Link>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">
            Trigger History
          </h1>
        </div>
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
              {triggers.map((t, i) => (
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
                    {t.triggerSource ?? "\u2014"}
                  </td>
                  <td className="px-4 py-2.5">
                    {t.agentName ? (
                      <Link
                        to={`/dashboard/agents/${encodeURIComponent(t.agentName)}`}
                        className="text-blue-600 dark:text-blue-400 hover:underline text-xs"
                      >
                        {t.agentName}
                      </Link>
                    ) : (
                      <span className="text-slate-400 text-xs">\u2014</span>
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
                      <span className="text-slate-400 text-xs">\u2014</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <ResultBadge result={t.result} />
                  </td>
                </tr>
              ))}
              {triggers.length === 0 && !loading && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-slate-500 dark:text-slate-400"
                  >
                    No triggers found
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
              onClick={() => load(Math.max(0, offset - PAGE_SIZE), showDeadLetters)}
              disabled={offset === 0}
              className="px-3 py-1 text-xs rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
            >
              Previous
            </button>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Page {page} of {totalPages} ({total} total)
            </span>
            <button
              onClick={() => load(offset + PAGE_SIZE, showDeadLetters)}
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
