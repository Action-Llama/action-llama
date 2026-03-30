/**
 * Wire up the al-subagent dispatch handler on the gateway.
 *
 * When a container issues an al-subagent call, the gateway invokes the dispatcher to
 * route the call to the target agent's runner pool.
 */

import type { GatewayServer } from "../gateway/index.js";
import type { StatusTracker } from "../tui/status-tracker.js";
import type { AgentConfig } from "../shared/config.js";
import type { RunnerPool } from "./runner-pool.js";
import type { SchedulerContext } from "./execution.js";
import {
  executeRun, drainQueues, makeTriggeredPrompt,
} from "./execution.js";
import { dispatchOrQueue } from "./dispatch-policy.js";

export function wireCallDispatcher(
  gateway: GatewayServer,
  schedulerCtx: SchedulerContext,
  statusTracker?: StatusTracker,
): void {
  const { agentConfigs, maxTriggerDepth, logger, runnerPools } = schedulerCtx;
  const callStore = gateway.callStore;

  gateway.setCallDispatcher((entry) => {
    // Global pause check — first regardless of other validations
    if (statusTracker?.isPaused()) {
      return { ok: false, reason: "scheduler is paused" };
    }
    // Call-specific validation (not part of dispatch policy)
    if (entry.callerAgent === entry.targetAgent) {
      return { ok: false, reason: "agent cannot call itself" };
    }
    if (entry.depth >= maxTriggerDepth) {
      return { ok: false, reason: "trigger depth limit reached" };
    }
    const targetConfig = agentConfigs.find((a) => a.name === entry.targetAgent);
    if (!targetConfig) {
      return { ok: false, reason: `target agent "${entry.targetAgent}" not found` };
    }
    const pool = runnerPools[entry.targetAgent];
    // Pool missing or scale=0 is a hard rejection for sub-agent calls (caller gets immediate error)
    if (!pool || pool.size === 0) {
      return { ok: false, reason: `target agent "${entry.targetAgent}" is disabled` };
    }

    const result = dispatchOrQueue(entry.targetAgent, {
      type: 'agent-trigger',
      sourceAgent: entry.callerAgent,
      context: entry.context,
      depth: entry.depth,
      callId: entry.callId,
    }, {
      pool,
      workQueue: schedulerCtx.workQueue,
      isAgentEnabled: schedulerCtx.isAgentEnabled,
    });

    if (result.action === "dispatched") {
      logger.info({ caller: entry.callerAgent, target: entry.targetAgent, depth: entry.depth }, "dispatching call");
      callStore?.setRunning(entry.callId);
      const prompt = makeTriggeredPrompt(targetConfig, entry.callerAgent, entry.context, schedulerCtx);
      executeRun(result.runner, prompt, { type: 'agent', source: entry.callerAgent }, entry.targetAgent, entry.depth + 1, schedulerCtx)
        .then(({ result: runResult, returnValue }) => {
          if (runResult === "completed" || runResult === "rerun") {
            callStore?.complete(entry.callId, returnValue);
          } else {
            callStore?.fail(entry.callId, "agent run failed");
          }
          return drainQueues(schedulerCtx);
        })
        .catch((err) => {
          callStore?.fail(entry.callId, err?.message || "unknown error");
          logger.error({ err, target: entry.targetAgent }, "called agent run failed");
        });
      return { ok: true };
    }
    if (result.action === "queued") {
      logger.info({ caller: entry.callerAgent, target: entry.targetAgent }, "all runners busy, call queued");
      drainQueues(schedulerCtx).catch((err) => {
        logger.error({ err }, "drain after al-subagent queue failed");
      });
      return { ok: true };
    }
    // rejected
    return { ok: false, reason: result.reason };
  });
}
