/**
 * Scheduler tools — Pi custom tools that give agents direct access
 * to scheduler services (locks, subagent calls, status, return values).
 *
 * These replace the old HTTP gateway routes + signal files with in-process
 * tool calls, since Pi sessions now run inside the scheduler process.
 */

import { Type, type Static } from "@sinclair/typebox";
import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { LockStore } from "../execution/lock-store.js";
import type { CallStore } from "../execution/call-store.js";
import type { StatusTracker } from "../tui/status-tracker.js";
import type { Logger } from "../shared/logger.js";
import type { WaitFilter } from "../execution/waiting-registry.js";
import { DEFAULT_WAIT_TIMEOUT } from "../shared/constants.js";

// ── Types ─────────────────────────────────────────────────────

export interface SchedulerToolsOpts {
  lockStore: LockStore;
  callStore: CallStore;
  /** Dispatch a call to a target agent. Returns { ok, reason? }. */
  dispatchCall: (entry: {
    callerAgent: string;
    callerInstanceId: string;
    targetAgent: string;
    context: string;
    depth: number;
    callId: string;
  }) => { ok: boolean; reason?: string };
  statusTracker?: StatusTracker;
  logger: Logger;
  /** Name of the agent these tools belong to. */
  agentName: string;
  /** Instance ID used as the lock holder and call caller. */
  instanceId: string;
  /** Current trigger depth (for subagent calls). */
  depth: number;
  /** Callback invoked when the agent calls return_value. */
  onReturnValue: (value: string) => void;
  /**
   * Callback invoked when the agent calls wait_for_trigger.
   * Returns a promise that resolves with the trigger payload when matched.
   */
  onWait?: (filter: import("../execution/waiting-registry.js").WaitFilter, timeoutMs: number) => Promise<any>;
  /** Default wait timeout in seconds (from agent/global config). */
  defaultWaitTimeout?: number;
}

// ── Tool definitions ──────────────────────────────────────────

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: undefined };
}

export function createSchedulerTools(opts: SchedulerToolsOpts): ToolDefinition[] {
  const tools = [
    createAcquireLockTool(opts),
    createReleaseLockTool(opts),
    createCallAgentTool(opts),
    createCheckCallTool(opts),
    createSetStatusTool(opts),
    createReturnValueTool(opts),
  ];

  if (opts.onWait) {
    tools.push(createWaitTool(opts));
  }

  return tools;
}

// ── acquire_lock ──────────────────────────────────────────────

const AcquireLockParams = Type.Object({
  resource_key: Type.String({ description: "URI identifying the resource to lock (e.g. lock://repo/main-branch)" }),
  ttl_seconds: Type.Optional(Type.Number({ description: "Lock TTL in seconds (default: 1800)" })),
});

function createAcquireLockTool(opts: SchedulerToolsOpts) {
  return defineTool({
    name: "acquire_lock",
    label: "Acquire Lock",
    description: "Acquire a distributed lock on a resource. Returns whether the lock was acquired. If another agent holds the lock, returns the holder's identity. Use URI format for resource keys (e.g. lock://repo/branch-name).",
    promptSnippet: "acquire_lock — acquire a distributed lock on a resource",
    parameters: AcquireLockParams,
    async execute(_toolCallId, params) {
      const result = opts.lockStore.acquire(params.resource_key, opts.instanceId, params.ttl_seconds);
      if (result.ok) {
        opts.logger.info({ resource: params.resource_key }, "lock acquired");
        return textResult(`Lock acquired on ${params.resource_key}`);
      }
      const reason = result.deadlock
        ? `Deadlock detected: ${result.cycle?.join(" → ")}`
        : `Lock held by ${result.holder}${result.reason ? ` (${result.reason})` : ""}`;
      opts.logger.info({ resource: params.resource_key, reason }, "lock acquire failed");
      return textResult(`Lock not acquired: ${reason}`);
    },
  });
}

// ── release_lock ──────────────────────────────────────────────

const ReleaseLockParams = Type.Object({
  resource_key: Type.String({ description: "URI identifying the resource to unlock" }),
});

function createReleaseLockTool(opts: SchedulerToolsOpts) {
  return defineTool({
    name: "release_lock",
    label: "Release Lock",
    description: "Release a distributed lock that you previously acquired.",
    promptSnippet: "release_lock — release a previously acquired lock",
    parameters: ReleaseLockParams,
    async execute(_toolCallId, params) {
      const result = opts.lockStore.release(params.resource_key, opts.instanceId);
      if (result.ok) {
        opts.logger.info({ resource: params.resource_key }, "lock released");
        return textResult(`Lock released on ${params.resource_key}`);
      }
      return textResult(`Could not release lock: ${result.reason}`);
    },
  });
}

// ── call_agent ────────────────────────────────────────────────

const CallAgentParams = Type.Object({
  target_agent: Type.String({ description: "Name of the agent to call" }),
  context: Type.String({ description: "Context/instructions to pass to the target agent" }),
});

function createCallAgentTool(opts: SchedulerToolsOpts) {
  return defineTool({
    name: "call_agent",
    label: "Call Agent",
    description: "Call another agent to perform a task. Returns a call_id that you can poll with check_call. The target agent runs asynchronously — use check_call to wait for its result.",
    promptSnippet: "call_agent — dispatch a task to another agent (returns call_id)",
    promptGuidelines: [
      "After calling call_agent, use check_call to poll for the result. Do not assume the call completes instantly.",
      "You cannot call yourself. The call will be rejected if the target agent is not available.",
    ],
    parameters: CallAgentParams,
    async execute(_toolCallId, params) {
      // Create a call entry in the call store
      const entry = opts.callStore.create({
        callerAgent: opts.agentName,
        callerInstanceId: opts.instanceId,
        targetAgent: params.target_agent,
        context: params.context,
        depth: opts.depth,
      });

      // Dispatch through the scheduler
      const result = opts.dispatchCall({
        callerAgent: opts.agentName,
        callerInstanceId: opts.instanceId,
        targetAgent: params.target_agent,
        context: params.context,
        depth: opts.depth,
        callId: entry.callId,
      });

      if (!result.ok) {
        opts.callStore.fail(entry.callId, result.reason || "dispatch rejected");
        opts.logger.warn({ target: params.target_agent, reason: result.reason }, "call_agent rejected");
        return textResult(`Call rejected: ${result.reason}`);
      }

      opts.logger.info({ target: params.target_agent, callId: entry.callId }, "call_agent dispatched");
      return textResult(`Call dispatched. call_id: ${entry.callId}\n\nUse check_call with this call_id to poll for the result.`);
    },
  });
}

// ── check_call ────────────────────────────────────────────────

const CheckCallParams = Type.Object({
  call_id: Type.String({ description: "The call_id returned by a previous call_agent" }),
});

function createCheckCallTool(opts: SchedulerToolsOpts) {
  return defineTool({
    name: "check_call",
    label: "Check Call",
    description: "Check the status of a previous call_agent. Returns the status (pending, running, completed, error) and the return value if completed.",
    promptSnippet: "check_call — poll the result of a previous call_agent",
    parameters: CheckCallParams,
    async execute(_toolCallId, params) {
      const result = opts.callStore.check(params.call_id, opts.instanceId);
      if (!result) {
        return textResult(`Call ${params.call_id} not found or not owned by this agent.`);
      }

      if (result.status === "completed") {
        const rv = result.returnValue ? `\n\nReturn value: ${result.returnValue}` : "";
        return textResult(`Call completed.${rv}`);
      }
      if (result.status === "error") {
        return textResult(`Call failed: ${result.errorMessage || "unknown error"}`);
      }
      return textResult(`Call status: ${result.status}. Use check_call again later to poll for completion.`);
    },
  });
}

// ── set_status ────────────────────────────────────────────────

const SetStatusParams = Type.Object({
  text: Type.String({ description: "Short status text to display (e.g. 'reviewing PR #42', 'waiting for build')" }),
});

function createSetStatusTool(opts: SchedulerToolsOpts) {
  return defineTool({
    name: "set_status",
    label: "Set Status",
    description: "Update your status text shown in the terminal dashboard. Use this to communicate what you're currently working on.",
    promptSnippet: "set_status — update your status in the dashboard",
    parameters: SetStatusParams,
    async execute(_toolCallId, params) {
      opts.statusTracker?.setAgentStatusText(opts.agentName, params.text);
      opts.logger.info({ status: params.text }, "status updated");
      return textResult(`Status updated: ${params.text}`);
    },
  });
}

// ── return_value ──────────────────────────────────────────────

const ReturnValueParams = Type.Object({
  value: Type.String({ description: "The value to return to the calling agent" }),
});

function createReturnValueTool(opts: SchedulerToolsOpts) {
  return defineTool({
    name: "return_value",
    label: "Return Value",
    description: "Return a value to the agent that called you. Only useful when this agent was invoked via call_agent by another agent. The calling agent will see this value when it uses check_call.",
    promptSnippet: "return_value — return a value to the calling agent",
    parameters: ReturnValueParams,
    async execute(_toolCallId, params) {
      opts.onReturnValue(params.value);
      opts.logger.info("return value set");
      return textResult(`Return value set. It will be visible to the calling agent via check_call.`);
    },
  });
}

// ── wait_for_trigger ──────────────────────────────────────────

/**
 * Parse a human-readable duration string to milliseconds.
 * Supports: "30s", "5m", "2h", "1h30m".
 */
function parseDuration(duration: string): number | null {
  const parts = duration.match(/(\d+)\s*(s|m|h)/g);
  if (!parts) return null;
  let totalMs = 0;
  for (const part of parts) {
    const match = part.match(/(\d+)\s*(s|m|h)/);
    if (!match) return null;
    const value = parseInt(match[1], 10);
    switch (match[2]) {
      case "s": totalMs += value * 1000; break;
      case "m": totalMs += value * 60_000; break;
      case "h": totalMs += value * 3_600_000; break;
    }
  }
  return totalMs > 0 ? totalMs : null;
}

const WaitForTriggerParams = Type.Object({
  type: Type.Union([Type.Literal("webhook"), Type.Literal("agent_trigger")], {
    description: "The type of trigger to wait for",
  }),
  source: Type.Optional(Type.String({ description: "Webhook source name to match (e.g. 'github')" })),
  event: Type.Optional(Type.String({ description: "Event type to match (e.g. 'pull_request')" })),
  match: Type.Optional(Type.Record(Type.String(), Type.String(), {
    description: "Dot-path equality predicates on the trigger payload (e.g. {\"action\": \"closed\", \"pull_request.merged\": \"true\"})",
  })),
  source_agent: Type.Optional(Type.String({ description: "For agent_trigger: only match triggers from this agent" })),
  timeout: Type.Optional(Type.String({ description: "How long to wait before timing out (e.g. '30m', '2h'). Defaults to agent/project config." })),
});

function createWaitTool(opts: SchedulerToolsOpts) {
  return defineTool({
    name: "wait_for_trigger",
    label: "Wait for Trigger",
    description: "Suspend this agent and wait for a specific trigger (webhook event or agent trigger) before resuming. The agent's container is paused while waiting to save resources. When the trigger arrives, the agent resumes with the trigger payload.",
    promptSnippet: "wait_for_trigger — suspend and wait for a webhook or agent trigger",
    promptGuidelines: [
      "Use this to build multi-step workflows. For example: process a PR opened event, then wait for it to merge.",
      "The agent is suspended while waiting — no resources are consumed. You will resume exactly where you left off.",
      "The timeout defaults to 30 minutes. Use the timeout parameter for longer waits.",
    ],
    parameters: WaitForTriggerParams,
    async execute(_toolCallId, params) {
      if (!opts.onWait) {
        return textResult("Error: wait_for_trigger is not available in this context.");
      }

      // Build the filter
      let filter: WaitFilter;
      if (params.type === "webhook") {
        filter = {
          type: "webhook",
          source: params.source,
          event: params.event,
          match: params.match,
        };
      } else {
        filter = {
          type: "agent-trigger",
          sourceAgent: params.source_agent,
        };
      }

      // Parse timeout
      const defaultTimeoutMs = (opts.defaultWaitTimeout ?? DEFAULT_WAIT_TIMEOUT) * 1000;
      const timeoutMs = params.timeout ? (parseDuration(params.timeout) ?? defaultTimeoutMs) : defaultTimeoutMs;

      opts.logger.info({ filter, timeoutMs }, "agent requesting wait_for_trigger");
      opts.statusTracker?.setAgentStatusText(opts.agentName, `waiting for ${params.type}${params.event ? `: ${params.event}` : ""}`);

      try {
        const payload = await opts.onWait(filter, timeoutMs);

        opts.logger.info("wait_for_trigger resolved with trigger payload");
        opts.statusTracker?.setAgentStatusText(opts.agentName, null);

        const payloadStr = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
        return textResult(`Trigger received. Payload:\n\n${payloadStr}`);
      } catch (err: any) {
        opts.logger.warn({ err: err.message }, "wait_for_trigger failed");
        opts.statusTracker?.setAgentStatusText(opts.agentName, null);
        return textResult(`Wait failed: ${err.message}`);
      }
    },
  });
}
