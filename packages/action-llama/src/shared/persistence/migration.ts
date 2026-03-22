/**
 * Migration utilities for transitioning from legacy StateStore/StatsStore to unified persistence.
 * 
 * Provides atomic migration with rollback support and progress reporting.
 */

import type { StateStore } from "../state-store.js";
import type { StatsStore, RunRecord, CallEdgeRecord } from "../../stats/store.js";
import type { PersistenceStore } from "./index.js";
import { createEvent, EventTypes } from "./event-store.js";

export interface MigrationProgress {
  /** Current step being performed */
  step: string;
  /** Number of items processed */
  processed: number;
  /** Total items to process */
  total: number;
  /** Estimated completion percentage */
  percentage: number;
}

export interface MigrationOptions {
  /** Progress callback */
  onProgress?: (progress: MigrationProgress) => void;
  /** Batch size for processing large datasets */
  batchSize?: number;
  /** Whether to preserve original data after migration */
  preserveOriginal?: boolean;
}

export class LegacyMigrator {
  constructor(private newStore: PersistenceStore) {}

  /**
   * Migrate from legacy StateStore to new persistence layer.
   */
  async migrateStateStore(
    legacyStore: StateStore,
    options: MigrationOptions = {}
  ): Promise<void> {
    const { onProgress, preserveOriginal = true } = options;
    
    // Get all namespaces by querying common ones
    const commonNamespaces = ["locks", "lock-holders", "sessions", "calls", "containers"];
    let totalItems = 0;
    const namespaceData = new Map<string, Array<{ key: string; value: any }>>();
    
    // Count total items first
    for (const namespace of commonNamespaces) {
      try {
        const items = await legacyStore.list(namespace);
        namespaceData.set(namespace, items);
        totalItems += items.length;
      } catch (error) {
        // Namespace might not exist, skip
        continue;
      }
    }
    
    if (totalItems === 0) {
      onProgress?.({ step: "No data to migrate", processed: 0, total: 0, percentage: 100 });
      return;
    }
    
    let processed = 0;
    
    await this.newStore.transaction(async (store) => {
      for (const [namespace, items] of namespaceData) {
        onProgress?.({
          step: `Migrating namespace: ${namespace}`,
          processed,
          total: totalItems,
          percentage: Math.floor((processed / totalItems) * 100),
        });
        
        for (const item of items) {
          await store.kv.set(namespace, item.key, item.value);
          
          // Create audit event for the migration
          await store.events.stream("migration").append(createEvent(
            "state.migrated",
            {
              namespace,
              key: item.key,
              source: "legacy-state-store",
            },
            {
              source: "migrator",
              tags: ["migration", "state-store"],
            }
          ));
          
          processed++;
          
          if (processed % 100 === 0) {
            onProgress?.({
              step: `Migrating namespace: ${namespace}`,
              processed,
              total: totalItems,
              percentage: Math.floor((processed / totalItems) * 100),
            });
          }
        }
      }
      
      onProgress?.({
        step: "Migration completed",
        processed: totalItems,
        total: totalItems,
        percentage: 100,
      });
    });
    
    if (!preserveOriginal) {
      for (const namespace of namespaceData.keys()) {
        await legacyStore.deleteAll(namespace);
      }
    }
  }

  /**
   * Migrate from legacy StatsStore to event-sourced analytics.
   */
  async migrateStatsStore(
    legacyStore: StatsStore,
    options: MigrationOptions = {}
  ): Promise<void> {
    const { onProgress, batchSize = 1000, preserveOriginal = true } = options;
    
    // Migration is complex because we need to convert SQL data to events
    // We'll query the runs and call_edges tables and convert them to events
    
    let processed = 0;
    
    onProgress?.({
      step: "Counting historical data",
      processed: 0,
      total: 0,
      percentage: 0,
    });
    
    // Use direct SQL to get all data efficiently
    const runs = await this.newStore.query.sql<any>(
      "SELECT * FROM runs ORDER BY started_at ASC"
    ).catch(() => []); // Table might not exist
    
    const callEdges = await this.newStore.query.sql<any>(
      "SELECT * FROM call_edges ORDER BY started_at ASC"
    ).catch(() => []);
    
    const totalItems = runs.length + callEdges.length;
    
    if (totalItems === 0) {
      onProgress?.({ step: "No stats data to migrate", processed: 0, total: 0, percentage: 100 });
      return;
    }
    
    await this.newStore.transaction(async (store) => {
      const statsStream = store.events.stream("stats");
      
      // Migrate run records to events
      onProgress?.({
        step: "Migrating run records",
        processed,
        total: totalItems,
        percentage: Math.floor((processed / totalItems) * 100),
      });
      
      for (const run of runs) {
        // Convert to run started event
        await statsStream.append(createEvent(
          EventTypes.RUN_STARTED,
          {
            instanceId: run.instance_id,
            agentName: run.agent_name,
            triggerType: run.trigger_type,
            triggerSource: run.trigger_source,
          },
          {
            source: "migrator",
            correlationId: run.instance_id,
            tags: ["migration", "stats"],
          }
        ));
        
        // Convert to run completed/failed event
        const eventType = run.result === "error" ? EventTypes.RUN_FAILED : EventTypes.RUN_COMPLETED;
        await statsStream.append(createEvent(
          eventType,
          {
            instanceId: run.instance_id,
            agentName: run.agent_name,
            result: run.result,
            exitCode: run.exit_code,
            durationMs: run.duration_ms,
            inputTokens: run.input_tokens,
            outputTokens: run.output_tokens,
            cacheReadTokens: run.cache_read_tokens,
            cacheWriteTokens: run.cache_write_tokens,
            totalTokens: run.total_tokens,
            costUsd: run.cost_usd,
            turnCount: run.turn_count,
            errorMessage: run.error_message,
            preHookMs: run.pre_hook_ms,
            postHookMs: run.post_hook_ms,
          },
          {
            source: "migrator",
            correlationId: run.instance_id,
            tags: ["migration", "stats"],
          }
        ));
        
        processed++;
        
        if (processed % 100 === 0) {
          onProgress?.({
            step: "Migrating run records",
            processed,
            total: totalItems,
            percentage: Math.floor((processed / totalItems) * 100),
          });
        }
      }
      
      // Migrate call edge records to events
      onProgress?.({
        step: "Migrating call records",
        processed,
        total: totalItems,
        percentage: Math.floor((processed / totalItems) * 100),
      });
      
      for (const call of callEdges) {
        // Convert to call initiated event
        await statsStream.append(createEvent(
          EventTypes.CALL_INITIATED,
          {
            callerAgent: call.caller_agent,
            callerInstance: call.caller_instance,
            targetAgent: call.target_agent,
            targetInstance: call.target_instance,
            depth: call.depth,
          },
          {
            source: "migrator",
            correlationId: call.caller_instance,
            tags: ["migration", "stats"],
          }
        ));
        
        // Convert to call completed/failed event if finished
        if (call.duration_ms !== null) {
          const eventType = call.status === "error" ? EventTypes.CALL_FAILED : EventTypes.CALL_COMPLETED;
          await statsStream.append(createEvent(
            eventType,
            {
              callerAgent: call.caller_agent,
              callerInstance: call.caller_instance,
              targetAgent: call.target_agent,
              targetInstance: call.target_instance,
              depth: call.depth,
              durationMs: call.duration_ms,
              status: call.status,
            },
            {
              source: "migrator",
              correlationId: call.caller_instance,
              tags: ["migration", "stats"],
            }
          ));
        }
        
        processed++;
        
        if (processed % 100 === 0) {
          onProgress?.({
            step: "Migrating call records",
            processed,
            total: totalItems,
            percentage: Math.floor((processed / totalItems) * 100),
          });
        }
      }
      
      // Create a migration completed event
      await store.events.stream("migration").append(createEvent(
        "stats.migrated",
        {
          runsCount: runs.length,
          callEdgesCount: callEdges.length,
          source: "legacy-stats-store",
        },
        {
          source: "migrator",
          tags: ["migration", "stats-store"],
        }
      ));
      
      onProgress?.({
        step: "Migration completed",
        processed: totalItems,
        total: totalItems,
        percentage: 100,
      });
    });
  }

  /**
   * Perform complete migration from all legacy stores.
   */
  async migrateAll(
    legacyStateStore?: StateStore,
    legacyStatsStore?: StatsStore,
    options: MigrationOptions = {}
  ): Promise<void> {
    const { onProgress } = options;
    
    onProgress?.({
      step: "Starting complete migration",
      processed: 0,
      total: 100,
      percentage: 0,
    });
    
    try {
      if (legacyStateStore) {
        onProgress?.({
          step: "Migrating state store",
          processed: 25,
          total: 100,
          percentage: 25,
        });
        
        await this.migrateStateStore(legacyStateStore, {
          ...options,
          onProgress: undefined, // Don't double-report
        });
      }
      
      if (legacyStatsStore) {
        onProgress?.({
          step: "Migrating stats store",
          processed: 50,
          total: 100,
          percentage: 50,
        });
        
        await this.migrateStatsStore(legacyStatsStore, {
          ...options,
          onProgress: undefined, // Don't double-report
        });
      }
      
      // Create final migration marker
      await this.newStore.events.stream("migration").append(createEvent(
        "migration.completed",
        {
          timestamp: Date.now(),
          version: "1.0.0",
        },
        {
          source: "migrator",
          tags: ["migration", "completion"],
        }
      ));
      
      onProgress?.({
        step: "All migrations completed",
        processed: 100,
        total: 100,
        percentage: 100,
      });
      
    } catch (error) {
      // Create error event
      await this.newStore.events.stream("migration").append(createEvent(
        "migration.failed",
        {
          error: error instanceof Error ? error.message : String(error),
          timestamp: Date.now(),
        },
        {
          source: "migrator",
          tags: ["migration", "error"],
        }
      ));
      
      throw error;
    }
  }
}

/**
 * Helper function to run migration with console progress reporting.
 */
export async function migrateFromLegacy(
  newStore: PersistenceStore,
  legacyStateStore?: StateStore,
  legacyStatsStore?: StatsStore,
  options: Omit<MigrationOptions, 'onProgress'> = {}
): Promise<void> {
  const migrator = new LegacyMigrator(newStore);
  
  await migrator.migrateAll(legacyStateStore, legacyStatsStore, {
    ...options,
    onProgress: (progress) => {
      console.log(`Migration: ${progress.step} (${progress.percentage}%)`);
    },
  });
}