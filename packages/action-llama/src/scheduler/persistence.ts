// packages/action-llama/src/scheduler/persistence.ts

import type { GlobalConfig } from "../shared/config.js";
import type { Logger } from "../shared/logger.js";
import type { StateStore } from "../shared/state-store.js";
import type { StatsStore } from "../stats/index.js";
import type { WorkItem } from "../execution/execution.js";
import type { WorkQueue } from "../shared/work-queue.js";

export interface PersistenceResult {
  sharedDb: any;
  stateStore: StateStore | undefined;
  statsStore: StatsStore | undefined;
  workQueue: WorkQueue<WorkItem>;
}

/**
 * Run database migrations, create state/stats stores, and create the work queue.
 * All persistence concerns are co-located here for independent testability.
 */
export async function createPersistence(
  projectPath: string,
  globalConfig: GlobalConfig,
  logger: Logger,
): Promise<PersistenceResult> {
  // Run database migrations and open the consolidated DB connection
  const { runMigrations } = await import("../db/migrate.js");
  const { resolve: resolvePath } = await import("path");
  const { dbPath } = await import("../shared/paths.js");
  const consolidatedDbPath = dbPath(projectPath);
  const { fileURLToPath } = await import("url");
  const migrationsFolder = resolvePath(
    fileURLToPath(new URL("../../drizzle", import.meta.url))
  );
  const sharedDb = runMigrations(consolidatedDbPath, migrationsFolder);
  logger.info("Database: SQLite (.al/action-llama.db)");

  // Create persistent state store (using shared DB)
  let stateStore: StateStore | undefined;
  {
    const { SqliteStateStore } = await import("../shared/state-store-sqlite.js");
    stateStore = new SqliteStateStore(sharedDb);
    logger.info("State store: SQLite (.al/action-llama.db)");
  }

  // Create stats store (using shared DB)
  let statsStore: StatsStore | undefined;
  {
    const { StatsStore: StatsStoreClass } = await import("../stats/index.js");
    statsStore = new StatsStoreClass(sharedDb);
    // Auto-prune old data on startup
    const retentionDays = globalConfig.historyRetentionDays ?? 14;
    const pruned = statsStore.prune(retentionDays);
    if (pruned.runs > 0 || pruned.callEdges > 0 || pruned.receipts > 0) {
      logger.info({ prunedRuns: pruned.runs, prunedCallEdges: pruned.callEdges, prunedReceipts: pruned.receipts, retentionDays }, "Pruned old stats data");
    }
    logger.info("Stats store: SQLite (.al/action-llama.db)");
  }

  // Create work queue (before Docker builds so incoming webhooks can be queued)
  const queueSize = globalConfig.workQueueSize ?? globalConfig.webhookQueueSize ?? 20;
  const { SqliteWorkQueue } = await import("../events/event-queue-sqlite.js");
  const workQueue = new SqliteWorkQueue<WorkItem>(queueSize, sharedDb);

  return { sharedDb, stateStore, statsStore, workQueue };
}
