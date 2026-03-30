/**
 * try-run-or-enqueue policy
 *
 * The "get an available runner or enqueue with drop-oldest" pattern appears at
 * four call sites:
 *   - scheduler/index.ts — webhook handler (two branches: building & no-runner)
 *   - scheduler/index.ts — cron handler
 *   - scheduler/gateway-setup.ts — triggerAgent control-API handler
 *
 * Centralising the logic here gives one place to change backpressure behaviour.
 */

import type { RunnerPool, PoolRunner } from "../../execution/runner-pool.js";
import type { WorkQueue, EnqueueResult } from "../../shared/work-queue.js";
import type { Logger } from "../../shared/logger.js";

export interface TryRunOrEnqueueResult<T> {
  /** Available runner ready to accept work, when one was free. */
  runner?: PoolRunner;
  /** Enqueue result when no runner was available (or pool not yet ready). */
  enqueued?: EnqueueResult<T>;
}

/**
 * Try to acquire an available runner from `pool`.
 *
 * - If `pool` is undefined (agents still building), the item is queued
 *   immediately without attempting runner acquisition.
 * - If all runners are busy, the item is enqueued instead.
 * - If the queue is at capacity the oldest item is silently dropped and a
 *   warning is logged.
 *
 * Callers must check whether the returned value has a `runner` or `enqueued`
 * field to know which path was taken.
 */
export function tryRunOrEnqueue<T>(
  pool: RunnerPool | undefined,
  queue: WorkQueue<T>,
  agentName: string,
  workItem: T,
  logger: Logger,
  logContext?: Record<string, unknown>,
): TryRunOrEnqueueResult<T> {
  const ctx = logContext ?? {};

  if (!pool) {
    const enqueued = queue.enqueue(agentName, workItem);
    if (enqueued.dropped) {
      logger.warn({ agent: agentName, ...ctx }, "queue full, oldest event dropped");
    }
    return { enqueued };
  }

  const runner = pool.getAvailableRunner();
  if (!runner) {
    const enqueued = queue.enqueue(agentName, workItem);
    logger.info(
      {
        agent: agentName,
        running: pool.runningJobCount,
        scale: pool.size,
        queueSize: queue.size(agentName),
        ...ctx,
      },
      "all runners busy, work queued",
    );
    if (enqueued.dropped) {
      logger.warn({ agent: agentName, ...ctx }, "queue full, oldest event dropped");
    }
    return { enqueued };
  }

  return { runner };
}
