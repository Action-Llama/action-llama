import { useContext } from "react";
import { ResultBadge } from "../components/Badge";
import { fmtDur, fmtCost, fmtTokens, fmtDateTime } from "../lib/format";
import { InstanceContext } from "../components/InstanceLayout";

export function InstanceTelemetryPage() {
  const ctx = useContext(InstanceContext);

  if (!ctx) return null;

  const { detail, isRunning } = ctx;
  const run = detail?.run;

  if (!run && isRunning) {
    return (
      <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6 text-center">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Instance is currently running. Telemetry data will be available once
          the run completes.
        </p>
      </div>
    );
  }

  if (!run) {
    return null;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Run Info */}
      <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-4">
        <h2 className="text-sm font-medium text-slate-900 dark:text-white mb-3">
          Run Info
        </h2>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-500 dark:text-slate-400">Status</dt>
            <dd>
              <ResultBadge result={run.result} />
            </dd>
          </div>
          {run.exit_code != null && (
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Exit Code</dt>
              <dd
                className={
                  run.exit_code === 0
                    ? "text-green-600 dark:text-green-400"
                    : "text-red-600 dark:text-red-400"
                }
              >
                {run.exit_code}
              </dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-slate-500 dark:text-slate-400">Started</dt>
            <dd className="text-slate-700 dark:text-slate-300">
              {fmtDateTime(run.started_at)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500 dark:text-slate-400">Ended</dt>
            <dd className="text-slate-700 dark:text-slate-300">
              {fmtDateTime(run.started_at + run.duration_ms)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500 dark:text-slate-400">Duration</dt>
            <dd className="text-slate-700 dark:text-slate-300">
              {fmtDur(run.duration_ms)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500 dark:text-slate-400">Turns</dt>
            <dd className="text-slate-700 dark:text-slate-300">
              {run.turn_count}
            </dd>
          </div>
          {run.error_message && (
            <div>
              <dt className="text-slate-500 dark:text-slate-400 mb-1">
                Error
              </dt>
              <dd className="text-red-600 dark:text-red-400 text-xs bg-red-50 dark:bg-red-900/20 rounded p-2 font-mono break-all">
                {run.error_message}
              </dd>
            </div>
          )}
        </dl>
      </div>

      {/* Token Usage */}
      <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-4">
        <h2 className="text-sm font-medium text-slate-900 dark:text-white mb-3">
          Token Usage
        </h2>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-500 dark:text-slate-400">Input</dt>
            <dd className="text-slate-700 dark:text-slate-300">
              {fmtTokens(run.input_tokens)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500 dark:text-slate-400">Output</dt>
            <dd className="text-slate-700 dark:text-slate-300">
              {fmtTokens(run.output_tokens)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500 dark:text-slate-400">Cache Read</dt>
            <dd className="text-slate-700 dark:text-slate-300">
              {fmtTokens(run.cache_read_tokens)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500 dark:text-slate-400">Cache Write</dt>
            <dd className="text-slate-700 dark:text-slate-300">
              {fmtTokens(run.cache_write_tokens)}
            </dd>
          </div>
          <div className="flex justify-between border-t border-slate-200 dark:border-slate-800 pt-2 mt-2">
            <dt className="text-slate-500 dark:text-slate-400 font-medium">
              Total
            </dt>
            <dd className="text-slate-700 dark:text-slate-300 font-medium">
              {fmtTokens(run.total_tokens)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500 dark:text-slate-400 font-medium">
              Cost
            </dt>
            <dd className="text-slate-700 dark:text-slate-300 font-medium">
              {fmtCost(run.cost_usd)}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
