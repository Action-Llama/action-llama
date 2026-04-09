import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useStatusStream } from "../hooks/StatusStreamContext";
import { TriggerBadge } from "../components/Badge";
import type { AgentStatus } from "../lib/api";
import { agentHueStyle } from "../lib/color";

const ROW_STATE_STYLES: Record<string, string> = {
  running:
    "border-l-2 border-l-blue-500 dark:border-l-blue-400 bg-blue-50/40 dark:bg-blue-950/20",
  building:
    "border-l-2 border-l-yellow-500 dark:border-l-yellow-400 bg-yellow-50/40 dark:bg-yellow-950/20",
  error:
    "border-l-2 border-l-red-500 dark:border-l-red-400 bg-red-50/30 dark:bg-red-950/20",
  idle: "",
};

const STATE_DOT_COLORS: Record<string, string> = {
  running: "bg-blue-500",
  building: "bg-yellow-500",
  error: "bg-red-500",
  idle: "bg-slate-400",
};

function StatusCell({ agent }: { agent: AgentStatus }) {
  const dotColor = STATE_DOT_COLORS[agent.state] ?? "bg-slate-400";
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${dotColor}`} title={agent.state} />
  );
}

export function DashboardPage() {
  const { agents, schedulerInfo } = useStatusStream();
  const agentNames = agents.map((a) => a.name);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 150);
    return () => clearTimeout(debounceRef.current);
  }, [searchQuery]);

  const isPaused = schedulerInfo?.paused ?? false;

  const filteredAgents = debouncedQuery
    ? agents.filter((a) => {
        const q = debouncedQuery.toLowerCase();
        return (
          a.name.toLowerCase().includes(q) ||
          (a.description?.toLowerCase().includes(q) ?? false)
        );
      })
    : agents;

  return (
    <div className="space-y-6">
      {isPaused && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3 text-sm text-yellow-700 dark:text-yellow-400 font-medium">
          Scheduler is paused
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">Agents</h1>
      </div>

      <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="flex items-center justify-end px-4 py-2.5 border-b border-slate-200 dark:border-slate-800">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search agents…"
              className="pl-3 pr-7 py-1 text-base rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 w-48"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                aria-label="Clear search"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <th className="w-10 px-2 py-2.5" />
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Agent
                </th>
                <th className="hidden lg:table-cell text-left px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Description
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredAgents.map((agent) => (
                <tr
                  key={agent.name}
                  className={`border-b border-slate-100 dark:border-slate-800/50 last:border-0 hover:bg-slate-100/50 dark:hover:bg-slate-800/30 ${ROW_STATE_STYLES[agent.state] ?? ""}`}
                >
                  <td className="w-10 px-2 py-2.5 align-middle text-center">
                    <StatusCell agent={agent} />
                  </td>
                  <td className="px-4 py-2.5 min-w-0 max-w-[240px]">
                    <Link
                      to={`/dashboard/agents/${encodeURIComponent(agent.name)}`}
                      className="font-medium hover:underline truncate block"
                      title={agent.name}
                    >
                      <span
                        className="agent-color-text truncate"
                        style={{ fontSize: "16px", ...agentHueStyle(agent.name, agentNames) }}
                      >
                        {agent.name}
                      </span>
                    </Link>
                    {!agent.enabled && (
                      <span className="ml-1 text-xs text-slate-500 italic">
                        (disabled)
                      </span>
                    )}
                    {(agent.triggers?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {agent.triggers!.map((t) => (
                          <TriggerBadge key={t} label={t} />
                        ))}
                      </div>
                    )}
                    {agent.description && (
                      <div className="lg:hidden text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                        {agent.description}
                      </div>
                    )}
                    {agent.lastError && (
                      <div
                        className="mt-1 text-xs text-red-600 dark:text-red-400 truncate"
                        title={agent.lastError}
                      >
                        {agent.lastError}
                      </div>
                    )}
                  </td>
                  <td className="hidden lg:table-cell px-4 py-2.5 text-xs text-slate-500 dark:text-slate-400 min-w-0 max-w-[300px] truncate">
                    {agent.description ?? "\u2014"}
                  </td>
                </tr>
              ))}
              {filteredAgents.length === 0 && debouncedQuery && (
                <tr>
                  <td
                    colSpan={3}
                    className="px-4 py-8 text-center text-slate-500 dark:text-slate-400"
                  >
                    No agents matching &lsquo;{debouncedQuery}&rsquo;
                  </td>
                </tr>
              )}
              {filteredAgents.length === 0 && !debouncedQuery && (
                <tr>
                  <td
                    colSpan={3}
                    className="px-4 py-8 text-center text-slate-500 dark:text-slate-400"
                  >
                    No agents found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
