import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  getProjectConfig,
  updateProjectScale,
  pauseScheduler,
  resumeScheduler,
} from "../lib/api";
import type { ProjectConfigData } from "../lib/api";
import { useStatusStream } from "../hooks/StatusStreamContext";
import { useInvalidation } from "../hooks/useInvalidation";

export function ProjectConfigPage() {
  const { schedulerInfo } = useStatusStream();
  const [config, setConfig] = useState<ProjectConfigData | null>(null);
  const [scaleInput, setScaleInput] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const refetchConfig = useCallback(() => {
    getProjectConfig()
      .then((d) => {
        setConfig(d);
        setScaleInput(String(d.projectScale));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refetchConfig();
  }, [refetchConfig]);

  useInvalidation("config", undefined, refetchConfig);

  const handleAction = useCallback(
    async (fn: () => Promise<unknown>, successMsg?: string) => {
      setActionError(null);
      setActionSuccess(null);
      try {
        await fn();
        if (successMsg) setActionSuccess(successMsg);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Action failed");
      }
    },
    [],
  );

  const handleScaleUpdate = useCallback(() => {
    const val = parseInt(scaleInput, 10);
    if (isNaN(val) || val < 1) return;
    handleAction(() => updateProjectScale(val), "Scale updated");
  }, [scaleInput, handleAction]);

  return (
    <div className="space-y-6">
      {/* Header */}
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
          Project Configuration
        </h1>
      </div>

      {actionError && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-400">
          {actionError}
        </div>
      )}
      {actionSuccess && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 text-sm text-green-700 dark:text-green-400">
          {actionSuccess}
        </div>
      )}

      {/* Project Scale */}
      <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-4">
        <h2 className="text-sm font-medium text-slate-900 dark:text-white mb-3">
          Project Scale
        </h2>
        <div className="flex items-center gap-3">
          <label
            htmlFor="project-scale"
            className="text-sm text-slate-500 dark:text-slate-400"
          >
            Default scale:
          </label>
          <input
            id="project-scale"
            type="number"
            min={1}
            value={scaleInput}
            onChange={(e) => setScaleInput(e.target.value)}
            className="w-20 px-2 py-1.5 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-sm text-slate-900 dark:text-slate-200"
          />
          <button
            onClick={handleScaleUpdate}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white transition-colors"
          >
            Update
          </button>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
          The default number of concurrent instances per agent. Individual agents
          can override this in their SKILL.md config.
        </p>
      </div>

      {/* Gateway Status */}
      <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-4">
        <h2 className="text-sm font-medium text-slate-900 dark:text-white mb-3">
          Gateway Status
        </h2>
        {config ? (
          <dl className="space-y-2 text-sm">
            {config.projectName && (
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">
                  Project
                </dt>
                <dd className="text-slate-700 dark:text-slate-300">
                  {config.projectName}
                </dd>
              </div>
            )}
            {config.gatewayPort != null && (
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Port</dt>
                <dd className="text-slate-700 dark:text-slate-300 font-mono">
                  {config.gatewayPort}
                </dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">
                Webhooks
              </dt>
              <dd>
                {config.webhooksActive ? (
                  <span className="text-green-600 dark:text-green-400 text-xs font-medium">
                    Active
                  </span>
                ) : (
                  <span className="text-slate-500 text-xs">Inactive</span>
                )}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Loading...
          </p>
        )}
      </div>

      {/* Scheduler Control */}
      <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-4">
        <h2 className="text-sm font-medium text-slate-900 dark:text-white mb-3">
          Scheduler Control
        </h2>
        {schedulerInfo ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-500 dark:text-slate-400">
                Status:
              </span>
              {schedulerInfo.paused ? (
                <span className="text-yellow-600 dark:text-yellow-400 font-medium">
                  Paused
                </span>
              ) : (
                <span className="text-green-600 dark:text-green-400 font-medium">
                  Running
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {schedulerInfo.paused ? (
                <button
                  onClick={() =>
                    handleAction(resumeScheduler, "Scheduler resumed")
                  }
                  className="px-4 py-2 text-sm font-medium rounded-md bg-green-600 hover:bg-green-700 text-white transition-colors"
                >
                  Resume All
                </button>
              ) : (
                <button
                  onClick={() =>
                    handleAction(pauseScheduler, "Scheduler paused")
                  }
                  className="px-4 py-2 text-sm font-medium rounded-md bg-yellow-600 hover:bg-yellow-700 text-white transition-colors"
                >
                  Pause All
                </button>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Pausing prevents new scheduled and webhook-triggered runs from
              starting. Running instances are not affected.
            </p>
          </div>
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Connecting to scheduler...
          </p>
        )}
      </div>
    </div>
  );
}
