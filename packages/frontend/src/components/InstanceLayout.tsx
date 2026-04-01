import React, { useState, useCallback } from "react";
import { useParams, Link, Outlet, useLocation } from "react-router-dom";
import { useQuery } from "../hooks/useQuery";
import { ResultBadge } from "./Badge";
import { getInstanceDetail, killInstance } from "../lib/api";
import type { InstanceDetailData } from "../lib/api";

export interface InstanceContextValue {
  detail: InstanceDetailData | null;
  name: string;
  id: string;
  isRunning: boolean;
}

export const InstanceContext = React.createContext<InstanceContextValue | null>(null);

export function InstanceLayout() {
  const { name, id } = useParams<{ name: string; id: string }>();
  const location = useLocation();
  const [killing, setKilling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: detail } = useQuery<InstanceDetailData>({
    key: `instance-detail:${name}:${id}`,
    fetcher: (signal) => getInstanceDetail(name!, id!, signal),
    invalidateOn: ["instance"],
    invalidateAgent: name,
    enabled: !!name && !!id,
  });

  const isRunning = detail?.runningInstance != null;

  const handleKill = useCallback(async () => {
    if (!id) return;
    setKilling(true);
    setActionError(null);
    try {
      await killInstance(id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setKilling(false);
    }
  }, [id]);

  if (!name || !id) return null;

  const basePath = `/dashboard/agents/${encodeURIComponent(name)}/instances/${encodeURIComponent(id)}`;
  const isLogs =
    location.pathname === basePath || location.pathname === basePath + "/";
  const isTrigger = location.pathname.endsWith("/trigger");
  const isTelemetry = location.pathname.endsWith("/telemetry");

  const tabClass = (active: boolean) =>
    `pb-2 text-sm font-medium transition-colors flex items-center gap-1.5 ${
      active
        ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400"
        : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
    }`;

  const run = detail?.run;

  const contextValue: InstanceContextValue = {
    detail: detail ?? null,
    name,
    id,
    isRunning,
  };

  return (
    <InstanceContext.Provider value={contextValue}>
      <div className="space-y-4">
        {/* Header row */}
        <div className="space-y-1">
        <nav className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
          <Link to="/dashboard" className="hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
            Agents
          </Link>
          <span>›</span>
          <Link to={`/dashboard/agents/${encodeURIComponent(name)}`} className="hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
            {name}
          </Link>
          <span>›</span>
        </nav>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div>
              <div className="flex items-center gap-1.5">
                <h1 className="text-xl font-bold text-slate-900 dark:text-white font-mono break-all">
                  {id}
                </h1>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(id);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                  title="Copy instance ID"
                >
                  {copied ? (
                    <svg
                      className="w-4 h-4 text-green-500"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  ) : (
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                      />
                    </svg>
                  )}
                </button>
              </div>
            </div>
            {run && <ResultBadge result={run.result} />}
            {isRunning && !run && (
              <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                running
              </span>
            )}
          </div>
          {isRunning && (
            <button
              onClick={handleKill}
              disabled={killing}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
            >
              {killing ? (
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
          )}
        </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-6 border-b border-slate-200 dark:border-slate-800">
          <Link to={basePath} className={tabClass(isLogs)}>
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            Logs
          </Link>
          <Link to={`${basePath}/trigger`} className={tabClass(isTrigger)}>
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
            Trigger
          </Link>
          <Link to={`${basePath}/telemetry`} className={tabClass(isTelemetry)}>
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
            Telemetry
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
      </div>
    </InstanceContext.Provider>
  );
}
