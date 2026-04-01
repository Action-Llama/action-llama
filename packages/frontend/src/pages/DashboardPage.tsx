import { useEffect, useState, useCallback, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useStatusStream } from "../hooks/StatusStreamContext";
import { TriggerBadge } from "../components/Badge";
import {
  triggerAgent,
  killAgentInstances,
  enableAgent,
  disableAgent,
} from "../lib/api";
import type { AgentStatus } from "../lib/api";
import { RunModal } from "../components/RunModal";
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

function SpinnerIcon() {
  return (
    <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function ActionMenu({
  agent,
  isPaused,
  onAction,
  onRunClick,
  killingAgents,
  onKillAgent,
}: {
  agent: AgentStatus;
  isPaused: boolean;
  onAction: (fn: () => Promise<unknown>) => void;
  onRunClick: () => void;
  killingAgents: Set<string>;
  onKillAgent: (agentName: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="px-2 py-1 text-xs rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
      >
        Actions
        <svg className="w-3 h-3 ml-1 inline-block" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 mt-1 z-10 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md shadow-lg py-1 min-w-[100px]">
          <button
            onClick={() => { onRunClick(); setOpen(false); }}
            disabled={!agent.enabled || isPaused}
            className="w-full text-left px-3 py-1.5 text-xs text-green-700 dark:text-green-400 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Run
          </button>
          <button
            onClick={() => { onKillAgent(agent.name); setOpen(false); }}
            disabled={agent.runningCount === 0 || killingAgents.has(agent.name)}
            className="w-full text-left px-3 py-1.5 text-xs text-red-700 dark:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {killingAgents.has(agent.name) ? (
              <span className="flex items-center gap-1">
                <SpinnerIcon />
                Killing…
              </span>
            ) : "Kill"}
          </button>
          <button
            onClick={() => { onAction(() => agent.enabled ? disableAgent(agent.name) : enableAgent(agent.name)); setOpen(false); }}
            className="w-full text-left px-3 py-1.5 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            {agent.enabled ? "Disable" : "Enable"}
          </button>
        </div>
      )}
    </div>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { agents, schedulerInfo } = useStatusStream();
  const agentNames = agents.map((a) => a.name);
  const [actionError, setActionError] = useState<string | null>(null);
  const [killingAgents, setKillingAgents] = useState<Set<string>>(new Set());
  const [runModalAgent, setRunModalAgent] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Debounce search input
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 150);
    return () => clearTimeout(debounceRef.current);
  }, [searchQuery]);

  const handleAction = useCallback(
    async (fn: () => Promise<unknown>) => {
      setActionError(null);
      try {
        await fn();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Action failed");
      }
    },
    [],
  );

  const handleKillAgent = useCallback(async (agentName: string) => {
    setKillingAgents((prev) => new Set(prev).add(agentName));
    setActionError(null);
    try {
      await killAgentInstances(agentName);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setKillingAgents((prev) => {
        const next = new Set(prev);
        next.delete(agentName);
        return next;
      });
    }
  }, []);

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
      {actionError && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-400">
          {actionError}
        </div>
      )}

      {/* Paused banner */}
      {isPaused && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3 text-sm text-yellow-700 dark:text-yellow-400 font-medium">
          Scheduler is paused
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">Agents</h1>
      </div>

      {/* Agents table — full width */}
      <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
        {/* Header with search */}
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
                <th className="text-right px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Actions
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
                      <span className="agent-color-text truncate" style={{ fontSize: "16px", ...agentHueStyle(agent.name, agentNames) }}>
                        {agent.name}
                      </span>
                    </Link>
                    {!agent.enabled && (
                      <span className="ml-1 text-xs text-slate-500 italic">
                        (disabled)
                      </span>
                    )}
                    {/* Trigger badges (schedule, webhook labels) */}
                    {(agent.triggers?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {agent.triggers!.map((t) => (
                          <TriggerBadge key={t} label={t} />
                        ))}
                      </div>
                    )}
                    {/* Description under name on small screens */}
                    {agent.description && (
                      <div className="lg:hidden text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                        {agent.description}
                      </div>
                    )}
                  </td>
                  <td className="hidden lg:table-cell px-4 py-2.5 text-xs text-slate-500 dark:text-slate-400 min-w-0 max-w-[300px] truncate">
                    {agent.description ?? "\u2014"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {/* Desktop: inline buttons */}
                    <div className="hidden sm:flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => setRunModalAgent(agent.name)}
                        disabled={!agent.enabled || isPaused}
                        className="px-2 py-1 text-xs rounded bg-green-600 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                        title="Trigger run"
                      >
                        Run
                      </button>
                      <button
                        onClick={() => handleKillAgent(agent.name)}
                        disabled={agent.runningCount === 0 || killingAgents.has(agent.name)}
                        className="px-2 py-1 text-xs rounded bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                        title="Kill all instances"
                      >
                        {killingAgents.has(agent.name) ? (
                          <span className="flex items-center gap-1">
                            <SpinnerIcon />
                            Killing…
                          </span>
                        ) : "Kill"}
                      </button>
                      <button
                        onClick={() =>
                          handleAction(() =>
                            agent.enabled
                              ? disableAgent(agent.name)
                              : enableAgent(agent.name),
                          )
                        }
                        className={`px-2 py-1 text-xs rounded transition-colors ${
                          agent.enabled
                            ? "bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600"
                            : "bg-blue-600 hover:bg-blue-700 text-white"
                        }`}
                      >
                        {agent.enabled ? "Disable" : "Enable"}
                      </button>
                    </div>
                    {/* Mobile: dropdown */}
                    <div className="sm:hidden">
                      <ActionMenu agent={agent} isPaused={isPaused} onAction={handleAction} onRunClick={() => setRunModalAgent(agent.name)} killingAgents={killingAgents} onKillAgent={handleKillAgent} />
                    </div>
                  </td>
                </tr>
              ))}
              {filteredAgents.length === 0 && debouncedQuery && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-8 text-center text-slate-500 dark:text-slate-400"
                  >
                    No agents matching &lsquo;{debouncedQuery}&rsquo;
                  </td>
                </tr>
              )}
              {filteredAgents.length === 0 && !debouncedQuery && (
                <tr>
                  <td
                    colSpan={4}
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

      {runModalAgent && (
        <RunModal
          agentName={runModalAgent}
          onClose={() => setRunModalAgent(null)}
          onRun={async (prompt) => {
            const agentName = runModalAgent;
            try {
              const result = await triggerAgent(agentName, prompt);
              if (result?.instanceId) {
                navigate(`/dashboard/agents/${encodeURIComponent(agentName)}/instances/${encodeURIComponent(result.instanceId)}`);
              }
            } catch (err) {
              setActionError(err instanceof Error ? err.message : "Action failed");
            }
          }}
        />
      )}
    </div>
  );
}
