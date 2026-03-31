import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { useInvalidation } from "../hooks/useInvalidation";
import { ResultBadge, TriggerTypeBadge } from "../components/Badge";
import {
  getInstanceDetail,
  getInstanceLogs,
  getLocks,
  killInstance,
} from "../lib/api";
import type { InstanceDetailData, LogEntry } from "../lib/api";
import { fmtDur, fmtCost, fmtTokens, fmtDateTime, shortId } from "../lib/format";

function formatLogEntry(entry: LogEntry): {
  text: string;
  className: string;
} {
  const msg = entry.msg || "";
  if (entry.text && (msg.includes("assistant") || msg.includes("response"))) {
    return {
      text: `${msg}: ${entry.text}`,
      className: "text-white font-bold",
    };
  }
  if (entry.cmd || msg.includes("bash") || msg.includes("command")) {
    return {
      text: entry.cmd ? `$ ${entry.cmd}` : msg,
      className: "text-cyan-400",
    };
  }
  if (entry.tool || msg.includes("tool")) {
    return {
      text: entry.tool ? `[tool] ${entry.tool}: ${entry.result ?? ""}` : msg,
      className: "text-blue-400",
    };
  }
  if (entry.level >= 50 || entry.err) {
    return { text: msg, className: "text-red-400" };
  }
  if (entry.level >= 40) {
    return { text: msg, className: "text-yellow-400" };
  }
  return { text: msg, className: "text-slate-300" };
}

export function InstanceDetailPage() {
  const { name, id } = useParams<{ name: string; id: string }>();
  const [detail, setDetail] = useState<InstanceDetailData | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [locks, setLocks] = useState<
    { resourceKey: string; holder?: string; heldSince?: string; agentName?: string }[]
  >([]);
  const [following, setFollowing] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [killing, setKilling] = useState(false);
  const [copied, setCopied] = useState(false);
  const [connected, setConnected] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  const isRunning = detail?.runningInstance != null;

  // Load detail
  const refetchDetail = useCallback(() => {
    if (!name || !id) return;
    getInstanceDetail(name, id)
      .then(setDetail)
      .catch(() => {});
  }, [name, id]);

  useEffect(() => {
    refetchDetail();
  }, [refetchDetail]);

  useInvalidation("instance", name, refetchDetail);

  // Poll logs
  useEffect(() => {
    if (!name || !id) return;
    const poll = () => {
      const params: Record<string, string> = { limit: "100" };
      if (cursorRef.current) params.cursor = cursorRef.current;
      getInstanceLogs(name, id, params)
        .then((d) => {
          setConnected(true);
          if (d.entries.length > 0) {
            setLogs((prev) => [...prev, ...d.entries]);
            if (d.cursor) cursorRef.current = d.cursor;
          }
        })
        .catch(() => setConnected(false));
    };
    poll();
    const interval = setInterval(poll, 1500);
    return () => clearInterval(interval);
  }, [name, id]);

  // Poll locks
  useEffect(() => {
    if (!isRunning) return;
    const poll = () => {
      getLocks()
        .then((d) => {
          setLocks(
            d.locks.filter(
              (l) => l.holder === id || (!l.holder && l.agentName === name),
            ),
          );
        })
        .catch(() => {});
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, [isRunning, id, name]);

  // Scroll follow
  useEffect(() => {
    if (following && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, following]);

  // Detect scroll-away to stop following
  const handleScroll = useCallback(() => {
    if (!logContainerRef.current) return;
    const el = logContainerRef.current;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setFollowing(atBottom);
  }, []);

  const handleAction = useCallback(async (fn: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await fn();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    }
  }, []);

  if (!name || !id) return null;

  const run = detail?.run;
  const parentEdge = detail?.parentEdge;
  const webhookReceipt = detail?.webhookReceipt;

  // Trigger detail
  let triggerDetail: React.ReactNode = null;
  if (parentEdge) {
    triggerDetail = (
      <span>
        Agent call from{" "}
        <Link
          to={`/dashboard/agents/${encodeURIComponent(parentEdge.caller_agent)}/instances/${encodeURIComponent(parentEdge.caller_instance)}`}
          className="text-blue-600 dark:text-blue-400 hover:underline"
        >
          {parentEdge.caller_agent}/{shortId(parentEdge.caller_instance)}
        </Link>
      </span>
    );
  } else if (webhookReceipt) {
    const receiptLink = run?.webhook_receipt_id
      ? `/dashboard/webhooks/${run.webhook_receipt_id}`
      : null;
    const content = (
      <span>
        Webhook: {webhookReceipt.source}
        {webhookReceipt.eventSummary && ` - ${webhookReceipt.eventSummary}`}
        {webhookReceipt.deliveryId && (
          <span className="text-slate-500 ml-1">
            ({webhookReceipt.deliveryId})
          </span>
        )}
      </span>
    );
    triggerDetail = receiptLink ? (
      <Link to={receiptLink} className="text-blue-600 dark:text-blue-400 hover:underline">
        {content}
      </Link>
    ) : content;
  } else if (run?.trigger_type === "schedule") {
    triggerDetail = <span>Scheduled</span>;
  } else if (run) {
    triggerDetail = (
      <span>
        {run.trigger_type}
        {run.trigger_source ? `: ${run.trigger_source}` : ""}
      </span>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link
            to={`/dashboard/agents/${encodeURIComponent(name)}`}
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
                  <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                )}
              </button>
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {name}
            </div>
          </div>
          {run && <ResultBadge result={run.result} />}
          {isRunning && !run && (
            <span className="text-xs text-green-600 dark:text-green-400 font-medium">
              running
            </span>
          )}
        </div>
        {isRunning && (
          <button
            onClick={async () => {
              setKilling(true);
              setActionError(null);
              try { await killInstance(id); }
              catch (err) { setActionError(err instanceof Error ? err.message : "Action failed"); }
              finally { setKilling(false); }
            }}
            disabled={killing}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
          >
            {killing ? (
              <span className="flex items-center gap-1">
                <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Killing…
              </span>
            ) : "Kill"}
          </button>
        )}
      </div>

      {actionError && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-400">
          {actionError}
        </div>
      )}

      {/* Info cards */}
      {run ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Run Info */}
          <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-4">
            <h2 className="text-sm font-medium text-slate-900 dark:text-white mb-3">
              Run Info
            </h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">
                  Trigger
                </dt>
                <dd className="text-slate-700 dark:text-slate-300 flex items-center gap-2">
                  <TriggerTypeBadge type={run.trigger_type} />
                  {triggerDetail}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">
                  Status
                </dt>
                <dd>
                  <ResultBadge result={run.result} />
                </dd>
              </div>
              {run.exit_code != null && (
                <div className="flex justify-between">
                  <dt className="text-slate-500 dark:text-slate-400">
                    Exit Code
                  </dt>
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
                <dt className="text-slate-500 dark:text-slate-400">
                  Started
                </dt>
                <dd className="text-slate-700 dark:text-slate-300">
                  {fmtDateTime(run.started_at)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">
                  Ended
                </dt>
                <dd className="text-slate-700 dark:text-slate-300">
                  {fmtDateTime(run.started_at + run.duration_ms)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">
                  Duration
                </dt>
                <dd className="text-slate-700 dark:text-slate-300">
                  {fmtDur(run.duration_ms)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">
                  Turns
                </dt>
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
                <dt className="text-slate-500 dark:text-slate-400">
                  Cache Read
                </dt>
                <dd className="text-slate-700 dark:text-slate-300">
                  {fmtTokens(run.cache_read_tokens)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">
                  Cache Write
                </dt>
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
      ) : isRunning ? (
        <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Instance is currently running. Telemetry data will be available once
            the run completes.
          </p>
        </div>
      ) : null}

      {/* Resource Locks */}
      {locks.length > 0 && (
        <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800">
            <h2 className="text-sm font-medium text-slate-900 dark:text-white">
              Resource Locks ({locks.length})
            </h2>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800/50">
            {locks.map((lock) => (
              <div
                key={lock.resourceKey}
                className="px-4 py-2.5 flex items-center justify-between"
              >
                <span className="text-sm font-mono text-slate-700 dark:text-slate-300">
                  {lock.resourceKey}
                </span>
                {lock.heldSince && (
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    since {new Date(lock.heldSince).toLocaleTimeString()}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Log Viewer */}
      <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-sm font-medium text-slate-900 dark:text-white">
            Logs
          </h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {logs.length} lines
            </span>
            <span
              className={`text-xs ${connected ? "text-green-500" : "text-red-500"}`}
            >
              {connected ? "Connected" : "Disconnected"}
            </span>
            <button
              onClick={() => setFollowing((f) => !f)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                following
                  ? "bg-blue-600 text-white"
                  : "bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
              }`}
            >
              Follow
            </button>
            <button
              onClick={() => {
                setLogs([]);
                cursorRef.current = null;
              }}
              className="px-2 py-1 text-xs rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors"
            >
              Clear
            </button>
          </div>
        </div>
        <div
          ref={logContainerRef}
          onScroll={handleScroll}
          className="max-h-96 overflow-y-auto scrollbar-thin bg-slate-950 p-3"
        >
          {logs.length > 0 ? (
            logs.map((entry, i) => {
              const { text, className } = formatLogEntry(entry);
              return (
                <div key={i} className="text-xs font-mono leading-5">
                  <span className="text-slate-600">
                    {new Date(entry.time).toLocaleTimeString()}
                  </span>{" "}
                  <span className={className}>{text}</span>
                </div>
              );
            })
          ) : (
            <div className="text-xs text-slate-500 text-center py-4">
              No log entries
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
