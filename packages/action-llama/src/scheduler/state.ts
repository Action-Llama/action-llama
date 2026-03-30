/**
 * Shared mutable state container for the scheduler.
 *
 * Multiple modules close over this container to access state that is populated
 * after gateway startup (e.g. runner pools, cron jobs, scheduler context).
 * JS closures capture variable bindings, not values, so reading from this
 * container at invocation time preserves late binding.
 */

import type { Cron } from "croner";
import type { RunnerPool } from "../execution/runner-pool.js";
import type { SchedulerContext, WorkItem } from "../execution/execution.js";
import type { WorkQueue } from "../shared/work-queue.js";

export interface SchedulerState {
  runnerPools: Record<string, RunnerPool>;
  cronJobs: Cron[];
  schedulerCtx: SchedulerContext | null;
  workQueue: WorkQueue<WorkItem> | null;
}
