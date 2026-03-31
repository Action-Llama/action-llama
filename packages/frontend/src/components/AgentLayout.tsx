import { useState, useCallback, useEffect } from "react";
import { useParams, Link, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useStatusStream } from "../hooks/StatusStreamContext";
import { RunDropdown } from "./RunDropdown";
import { RunModal } from "./RunModal";
import { triggerAgent, killAgentInstances, getAgentDetail } from "../lib/api";
import type { AgentDetailData } from "../lib/api";

export function AgentLayout() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { agents } = useStatusStream();

  const [detail, setDetail] = useState<AgentDetailData | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [killingAll, setKillingAll] = useState(false);
  const [showRunModal, setShowRunModal] = useState(false);

  const agent = agents.find((a) => a.name === name) ?? detail?.agent ?? null;

  // Load detail on mount
  useEffect(() => {
    if (!name) return;
    getAgentDetail(name)
      .then((d) => setDetail(d))
      .catch(() => {});
  }, [name]);

  const handleAction = useCallback(async (fn: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await fn();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    }
  }, []);

  if (!name) return null;

  // Determine active tab
  const basePath = `/dashboard/agents/${encodeURIComponent(name)}`;
  const isActivity =
    location.pathname === basePath || location.pathname === basePath + "/";
  const isStats = location.pathname.endsWith("/stats");
  const isSettings =
    location.pathname.endsWith("/settings") ||
    location.pathname.endsWith("/admin");

  const tabClass = (active: boolean) =>
    `pb-2 text-sm font-medium transition-colors ${
      active
        ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400"
        : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
    }`;

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link
            to="/dashboard"
            className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            aria-label="Back to dashboard"
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
            {name}
          </h1>
          {agent && (
            <span
              id="agent-state"
              className={`text-sm ${
                agent.runningCount > 0
                  ? "text-green-600 dark:text-green-400"
                  : "text-slate-500 dark:text-slate-400"
              }`}
            >
              <span
                className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${
                  agent.runningCount > 0 ? "bg-green-500" : "bg-slate-400"
                }`}
              />
              {agent.runningCount > 0
                ? agent.scale > 1
                  ? `running ${agent.runningCount}/${agent.scale}`
                  : "running"
                : "idle"}
              {agent.scale > 1 && agent.runningCount === 0 && (
                <span className="text-xs text-slate-400 ml-1">×{agent.scale}</span>
              )}
            </span>
          )}
          {agent && !agent.enabled && (
            <span className="text-xs text-slate-500 italic">(disabled)</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <RunDropdown
            disabled={agent ? !agent.enabled : false}
            onQuickRun={async () => {
              try {
                const result = await triggerAgent(name!, undefined);
                if (result?.instanceId) {
                  navigate(
                    `/dashboard/agents/${encodeURIComponent(name!)}/instances/${encodeURIComponent(result.instanceId)}`
                  );
                }
              } catch (err) {
                setActionError(
                  err instanceof Error ? err.message : "Action failed"
                );
              }
            }}
            onRunWithPrompt={() => setShowRunModal(true)}
            onChat={() => navigate(`/chat/${encodeURIComponent(name!)}`)}
          />
          <button
            id="agent-kill-btn"
            onClick={async () => {
              setKillingAll(true);
              setActionError(null);
              try {
                await killAgentInstances(name);
              } catch (err) {
                setActionError(
                  err instanceof Error ? err.message : "Action failed"
                );
              } finally {
                setKillingAll(false);
              }
            }}
            disabled={!agent || agent.runningCount === 0 || killingAll}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
          >
            {killingAll ? (
              <span className="flex items-center gap-1">
                <svg
                  className="w-3 h-3 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                Killing…
              </span>
            ) : (
              "Kill"
            )}
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-6 border-b border-slate-200 dark:border-slate-800">
        <Link to={basePath} className={tabClass(isActivity)}>
          Activity
        </Link>
        <Link to={`${basePath}/stats`} className={tabClass(isStats)}>
          Stats
        </Link>
        <Link to={`${basePath}/settings`} className={tabClass(isSettings)}>
          Settings
        </Link>
      </div>

      {/* Action error banner */}
      {actionError && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-400">
          {actionError}
        </div>
      )}

      {/* Tab content */}
      <Outlet />

      {/* Run modal */}
      {showRunModal && name && (
        <RunModal
          agentName={name}
          onClose={() => setShowRunModal(false)}
          onRun={async (prompt) => {
            try {
              const result = await triggerAgent(name, prompt);
              if (result?.instanceId) {
                navigate(
                  `/dashboard/agents/${encodeURIComponent(name)}/instances/${encodeURIComponent(result.instanceId)}`
                );
              }
            } catch (err) {
              setActionError(
                err instanceof Error ? err.message : "Action failed"
              );
            }
          }}
        />
      )}
    </div>
  );
}
