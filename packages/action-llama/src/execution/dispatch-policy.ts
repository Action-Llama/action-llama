/**
 * Centralized dispatch policy for all trigger types.
 *
 * Consolidates the "check paused → check pool → check runner → queue or execute"
 * decision that was previously duplicated across multiple call sites.
 */

import type { PoolRunner, RunnerPool } from "./runner-pool.js";
import type { WorkQueue } from "../shared/work-queue.js";

/**
 * Result of a dispatch decision.
 *
 * - `dispatched`: a runner is available and reserved for the caller to use
 * - `queued`: the work item was added to the persistent work queue
 * - `rejected`: the work item was not accepted (caller should report error)
 */
export type DispatchResult =
  | { action: "dispatched"; runner: PoolRunner }
  | { action: "queued"; dropped: boolean; cause: "agent-disabled" | "pool-unavailable" | "all-busy" }
  | { action: "rejected"; reason: string };

export interface DispatchOptions {
  /**
   * When true, queue the work item when no runner is available.
   * When false, reject instead of queueing (used by manual triggers
   * to give the user immediate feedback).
   * Default: true
   */
  queueWhenBusy?: boolean;
}

/**
 * Centralized dispatch decision for all trigger types.
 *
 * Given an agent name and a work item, decides whether to:
 * 1. Dispatch immediately (runner available)
 * 2. Queue for later (runner busy, agent paused, pool not ready)
 * 3. Reject outright (scheduler paused, pool empty/missing with queueWhenBusy=false)
 *
 * Callers remain responsible for prompt building and executeRun/runWithReruns
 * since those vary by trigger type.
 */
export function dispatchOrQueue<T>(
  agentName: string,
  workItem: T,
  deps: {
    pool: RunnerPool | undefined | null;
    workQueue: WorkQueue<T>;
    isPaused?: () => boolean;
    isAgentEnabled?: (name: string) => boolean;
  },
  opts: DispatchOptions = {},
): DispatchResult {
  const { pool, workQueue, isPaused, isAgentEnabled } = deps;
  const { queueWhenBusy = true } = opts;

  // 1. Global pause check — reject outright
  if (isPaused?.()) {
    return { action: "rejected", reason: "scheduler is paused" };
  }

  // 2. Agent disabled — queue for when it is re-enabled
  if (isAgentEnabled && !isAgentEnabled(agentName)) {
    const { dropped } = workQueue.enqueue(agentName, workItem);
    return { action: "queued", dropped: !!dropped, cause: "agent-disabled" };
  }

  // 3. Pool not available (not yet created, or scale = 0 check below)
  if (!pool) {
    if (queueWhenBusy) {
      const { dropped } = workQueue.enqueue(agentName, workItem);
      return { action: "queued", dropped: !!dropped, cause: "pool-unavailable" };
    }
    return { action: "rejected", reason: "runner pool not available" };
  }

  if (pool.size === 0) {
    return { action: "rejected", reason: "agent is disabled (scale=0)" };
  }

  // 4. Try to get an available runner
  const runner = pool.getAvailableRunner();
  if (runner) {
    return { action: "dispatched", runner };
  }

  // 5. All runners busy — queue or reject based on caller preference
  if (queueWhenBusy) {
    const { dropped } = workQueue.enqueue(agentName, workItem);
    return { action: "queued", dropped: !!dropped, cause: "all-busy" };
  }

  return { action: "rejected", reason: "no available runners (all busy)" };
}
