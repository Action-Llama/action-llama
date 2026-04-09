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
}

// ── Tool definitions ──────────────────────────────────────────

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: undefined };
}

export function createSchedulerTools(opts: SchedulerToolsOpts): ToolDefinition[] {
  return [
    createAcquireLockTool(opts),
    createReleaseLockTool(opts),
    createCallAgentTool(opts),
    createCheckCallTool(opts),
    createSetStatusTool(opts),
    createReturnValueTool(opts),
  ];
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
