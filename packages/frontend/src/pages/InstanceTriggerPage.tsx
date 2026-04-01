import { useContext, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { TriggerTypeBadge, ResultBadge } from "../components/Badge";
import { getTriggerDetail } from "../lib/api";
import type { TriggerDetailData } from "../lib/api";
import { fmtDateTime, shortId } from "../lib/format";
import { agentHueStyle } from "../lib/color";
import { decodeBody } from "../lib/decode-body";
import { useStatusStream } from "../hooks/StatusStreamContext";
import { InstanceContext } from "../components/InstanceLayout";

function prettyJson(raw: string | null | undefined): string {
  if (!raw) return "\u2014";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export function InstanceTriggerPage() {
  const ctx = useContext(InstanceContext);
  const { agents } = useStatusStream();
  const agentNames = agents.map((a) => a.name);

  const [trigger, setTrigger] = useState<TriggerDetailData | null | undefined>(
    undefined,
  );

  const id = ctx?.id;
  const detail = ctx?.detail;

  useEffect(() => {
    if (!id) return;
    getTriggerDetail(id)
      .then((data) => setTrigger(data.trigger))
      .catch(() => setTrigger(null));
  }, [id]);

  if (!ctx) return null;
  // ctx is guaranteed non-null below

  if (trigger === undefined) {
    return (
      <div className="text-center py-12 text-slate-500 dark:text-slate-400">
        Loading...
      </div>
    );
  }

  // Fallback: show basic info from run data if trigger detail not available
  if (trigger === null) {
    const run = detail?.run;
    if (!run) {
      return (
        <div className="text-center py-12 text-slate-500 dark:text-slate-400">
          Trigger details not available.
        </div>
      );
    }
    return (
      <div className="space-y-4">
        <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800">
            <h2 className="text-sm font-medium text-slate-900 dark:text-white">
              Overview
            </h2>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800/50">
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Trigger Type
              </span>
              <TriggerTypeBadge type={run.trigger_type} />
            </div>
            {run.trigger_source && (
              <div className="px-4 py-3 flex items-center justify-between">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Source
                </span>
                <span className="text-xs text-slate-700 dark:text-slate-300">
                  {run.trigger_source}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Overview card */}
      <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-sm font-medium text-slate-900 dark:text-white">
            Overview
          </h2>
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-800/50">
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Trigger Type
            </span>
            <TriggerTypeBadge type={trigger.triggerType} />
          </div>
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Agent
            </span>
            <Link
              to={`/dashboard/agents/${encodeURIComponent(trigger.agentName)}`}
              className="hover:underline text-xs flex items-center gap-1.5"
            >
              <span
                className="agent-color-text"
                style={agentHueStyle(trigger.agentName, agentNames)}
              >
                {trigger.agentName}
              </span>
            </Link>
          </div>
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Instance
            </span>
            <span className="font-mono text-xs text-slate-700 dark:text-slate-300">
              {trigger.instanceId}
            </span>
          </div>
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Time
            </span>
            <span className="text-xs text-slate-700 dark:text-slate-300">
              {fmtDateTime(trigger.startedAt)}
            </span>
          </div>
          {trigger.triggerSource && (
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Source
              </span>
              <span className="text-xs text-slate-700 dark:text-slate-300">
                {trigger.triggerSource}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Webhook details */}
      {trigger.triggerType === "webhook" && trigger.webhook && (
        <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800">
            <h2 className="text-sm font-medium text-slate-900 dark:text-white">
              Webhook Details
            </h2>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800/50">
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Receipt ID
              </span>
              <Link
                to={`/dashboard/webhooks/${encodeURIComponent(trigger.webhook.receiptId)}`}
                className="font-mono text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                {shortId(trigger.webhook.receiptId)}
              </Link>
            </div>
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Source
              </span>
              <span className="text-xs text-slate-700 dark:text-slate-300">
                {trigger.webhook.source}
              </span>
            </div>
            {trigger.webhook.eventSummary && (
              <div className="px-4 py-3 flex items-center justify-between">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Event
                </span>
                <span className="text-xs text-slate-700 dark:text-slate-300">
                  {trigger.webhook.eventSummary}
                </span>
              </div>
            )}
            {trigger.webhook.deliveryId && (
              <div className="px-4 py-3 flex items-center justify-between">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Delivery ID
                </span>
                <span className="font-mono text-xs text-slate-700 dark:text-slate-300">
                  {trigger.webhook.deliveryId}
                </span>
              </div>
            )}
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Status
              </span>
              <ResultBadge
                result={
                  trigger.webhook.status === "processed"
                    ? "completed"
                    : "dead-letter"
                }
              />
            </div>
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Matched Agents
              </span>
              <span className="text-xs text-slate-700 dark:text-slate-300">
                {trigger.webhook.matchedAgents}
              </span>
            </div>
          </div>
          {trigger.webhook.headers && (
            <div className="border-t border-slate-200 dark:border-slate-800">
              <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-800/50">
                <h3 className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Headers
                </h3>
              </div>
              <pre className="px-4 py-3 text-xs font-mono text-slate-700 dark:text-slate-300 overflow-x-auto whitespace-pre-wrap break-all">
                {prettyJson(trigger.webhook.headers)}
              </pre>
            </div>
          )}
          {(() => {
            const decoded = decodeBody(
              trigger.webhook!.body,
              trigger.webhook!.headers,
            );
            return (
              <>
                {decoded && (
                  <div className="border-t border-slate-200 dark:border-slate-800">
                    <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-800/50">
                      <h3 className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                        {decoded.label}
                      </h3>
                    </div>
                    <pre className="px-4 py-3 text-xs font-mono text-slate-700 dark:text-slate-300 overflow-x-auto whitespace-pre-wrap break-all max-h-96 overflow-y-auto">
                      {decoded.content}
                    </pre>
                  </div>
                )}
                {trigger.webhook!.body && (
                  <div className="border-t border-slate-200 dark:border-slate-800">
                    <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-800/50">
                      <h3 className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                        {decoded ? "Raw Body" : "Body"}
                      </h3>
                    </div>
                    <pre className="px-4 py-3 text-xs font-mono text-slate-700 dark:text-slate-300 overflow-x-auto whitespace-pre-wrap break-all">
                      {prettyJson(trigger.webhook!.body)}
                    </pre>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* Agent trigger details */}
      {trigger.triggerType === "agent" && (
        <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800">
            <h2 className="text-sm font-medium text-slate-900 dark:text-white">
              Agent Trigger Details
            </h2>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800/50">
            {trigger.callerAgent ? (
              <>
                <div className="px-4 py-3 flex items-center justify-between">
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    Called by
                  </span>
                  <Link
                    to={`/dashboard/agents/${encodeURIComponent(trigger.callerAgent)}`}
                    className="hover:underline text-xs flex items-center gap-1.5"
                  >
                    <span
                      className="agent-color-text"
                      style={agentHueStyle(trigger.callerAgent, agentNames)}
                    >
                      {trigger.callerAgent}
                    </span>
                  </Link>
                </div>
                {trigger.callerInstance && (
                  <div className="px-4 py-3 flex items-center justify-between">
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      Caller Instance
                    </span>
                    <Link
                      to={`/dashboard/agents/${encodeURIComponent(trigger.callerAgent)}/instances/${encodeURIComponent(trigger.callerInstance)}`}
                      className="font-mono text-xs text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {shortId(trigger.callerInstance)}
                    </Link>
                  </div>
                )}
                {trigger.callDepth !== undefined && (
                  <div className="px-4 py-3 flex items-center justify-between">
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      Call Depth
                    </span>
                    <span className="text-xs text-slate-700 dark:text-slate-300">
                      {trigger.callDepth}
                    </span>
                  </div>
                )}
              </>
            ) : (
              <div className="px-4 py-3">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Caller information not available
                </span>
              </div>
            )}
          </div>
          {trigger.triggerContext && (
            <div className="border-t border-slate-200 dark:border-slate-800">
              <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-800/50">
                <h3 className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Trigger Context
                </h3>
              </div>
              <pre className="px-4 py-3 text-xs font-mono text-slate-700 dark:text-slate-300 overflow-x-auto whitespace-pre-wrap break-all">
                {trigger.triggerContext}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Manual trigger details */}
      {trigger.triggerType === "manual" && (
        <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800">
            <h2 className="text-sm font-medium text-slate-900 dark:text-white">
              Manual Trigger Details
            </h2>
          </div>
          {trigger.triggerContext ? (
            <div>
              <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-800/50">
                <h3 className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Prompt
                </h3>
              </div>
              <pre className="px-4 py-3 text-xs font-mono text-slate-700 dark:text-slate-300 overflow-x-auto whitespace-pre-wrap break-all">
                {trigger.triggerContext}
              </pre>
            </div>
          ) : (
            <div className="px-4 py-3">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Prompt not available (run predates context tracking)
              </span>
            </div>
          )}
        </div>
      )}

      {/* Schedule trigger details */}
      {trigger.triggerType === "schedule" && (
        <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800">
            <h2 className="text-sm font-medium text-slate-900 dark:text-white">
              Schedule Trigger Details
            </h2>
          </div>
          <div className="px-4 py-3">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Scheduled run at {fmtDateTime(trigger.startedAt)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
