/**
 * Graceful shutdown handler for the scheduler.
 */

import type { Cron } from "croner";
import type { GatewayServer } from "../gateway/index.js";
import type { StateStore } from "../shared/state-store.js";
import type { Logger } from "../shared/logger.js";
import type { SchedulerContext } from "./execution.js";
import type { StatsStore } from "../stats/index.js";

export function registerShutdownHandlers(deps: {
  logger: Logger;
  schedulerCtx: SchedulerContext;
  cronJobs: Cron[];
  gateway?: GatewayServer;
  stateStore?: StateStore;
  statsStore?: StatsStore;
  telemetry?: any;
  watcherHandle: { stop: () => void };
}): void {
  const { logger, schedulerCtx, cronJobs, gateway, stateStore, statsStore, telemetry, watcherHandle } = deps;

  const shutdown = async () => {
    logger.info("Shutting down scheduler...");
    watcherHandle.stop();
    schedulerCtx.shuttingDown = true;
    schedulerCtx.workQueue.clearAll();
    schedulerCtx.workQueue.close();
    for (const job of cronJobs) {
      job.stop();
    }
    if (gateway) {
      await gateway.close();
      logger.info("Gateway server stopped");
    }
    if (stateStore) {
      await stateStore.close();
    }
    if (statsStore) {
      statsStore.close();
    }

    // Shutdown telemetry
    if (telemetry) {
      try {
        await telemetry.shutdown();
        logger.info("Telemetry shutdown completed");
      } catch (error: any) {
        logger.warn({ error: error.message }, "Error during telemetry shutdown");
      }
    }

    logger.info("All cron jobs stopped");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
