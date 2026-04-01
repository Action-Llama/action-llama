/**
 * Drizzle ORM schema definitions for the consolidated action-llama database.
 *
 * All tables from the legacy separate databases are defined here:
 * - state         (formerly .al/state.db)
 * - runs, webhook_receipts, call_edges (formerly .al/stats.db)
 * - work_queue    (formerly .al/work-queue.db)
 * - queue         (shared SqliteQueue)
 * - kv_store, events, snapshots (persistence layer SqliteBackend)
 */

import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// State store (SqliteStateStore)
// ---------------------------------------------------------------------------

export const stateTable = sqliteTable(
  "state",
  {
    ns: text("ns").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at"),
  },
  (t) => [
    primaryKey({ columns: [t.ns, t.key] }),
    index("idx_state_expires").on(t.expiresAt),
  ]
);

export type StateRow = typeof stateTable.$inferSelect;
export type NewStateRow = typeof stateTable.$inferInsert;

// ---------------------------------------------------------------------------
// Stats — runs
// ---------------------------------------------------------------------------

export const runsTable = sqliteTable(
  "runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    instanceId: text("instance_id").notNull(),
    agentName: text("agent_name").notNull(),
    triggerType: text("trigger_type").notNull(),
    triggerSource: text("trigger_source"),
    result: text("result").notNull(),
    exitCode: integer("exit_code"),
    startedAt: integer("started_at").notNull(),
    durationMs: integer("duration_ms").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    costUsd: real("cost_usd").notNull().default(0),
    turnCount: integer("turn_count").notNull().default(0),
    errorMessage: text("error_message"),
    preHookMs: integer("pre_hook_ms"),
    postHookMs: integer("post_hook_ms"),
    webhookReceiptId: text("webhook_receipt_id"),
    triggerContext: text("trigger_context"),
  },
  (t) => [
    index("idx_runs_agent").on(t.agentName, t.startedAt),
    index("idx_runs_started").on(t.startedAt),
    index("idx_runs_result").on(t.result, t.startedAt),
  ]
);

export type RunRow = typeof runsTable.$inferSelect;
export type NewRunRow = typeof runsTable.$inferInsert;

// ---------------------------------------------------------------------------
// Stats — webhook_receipts
// ---------------------------------------------------------------------------

export const webhookReceiptsTable = sqliteTable(
  "webhook_receipts",
  {
    id: text("id").primaryKey(),
    deliveryId: text("delivery_id"),
    source: text("source").notNull(),
    eventSummary: text("event_summary"),
    timestamp: integer("timestamp").notNull(),
    headers: text("headers"),
    body: text("body"),
    matchedAgents: integer("matched_agents").notNull().default(0),
    status: text("status").notNull(),
    deadLetterReason: text("dead_letter_reason"),
  },
  (t) => [
    index("idx_wr_timestamp").on(t.timestamp),
    uniqueIndex("idx_wr_delivery").on(t.deliveryId),
  ]
);

export type WebhookReceiptRow = typeof webhookReceiptsTable.$inferSelect;
export type NewWebhookReceiptRow = typeof webhookReceiptsTable.$inferInsert;

// ---------------------------------------------------------------------------
// Stats — call_edges
// ---------------------------------------------------------------------------

export const callEdgesTable = sqliteTable(
  "call_edges",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    callerAgent: text("caller_agent").notNull(),
    callerInstance: text("caller_instance").notNull(),
    targetAgent: text("target_agent").notNull(),
    targetInstance: text("target_instance"),
    depth: integer("depth").notNull().default(0),
    startedAt: integer("started_at").notNull(),
    durationMs: integer("duration_ms"),
    status: text("status").notNull().default("pending"),
  },
  (t) => [
    index("idx_calls_caller").on(t.callerAgent, t.startedAt),
    index("idx_calls_target").on(t.targetAgent, t.startedAt),
    index("idx_calls_target_instance").on(t.targetInstance),
  ]
);

export type CallEdgeRow = typeof callEdgesTable.$inferSelect;
export type NewCallEdgeRow = typeof callEdgesTable.$inferInsert;

// ---------------------------------------------------------------------------
// Work queue (SqliteWorkQueue)
// ---------------------------------------------------------------------------

export const workQueueTable = sqliteTable(
  "work_queue",
  {
    id: text("id").notNull(),
    agent: text("agent").notNull(),
    payload: text("payload").notNull(),
    receivedAt: integer("received_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.agent, t.id] }),
    index("idx_wq_agent").on(t.agent),
  ]
);

export type WorkQueueRow = typeof workQueueTable.$inferSelect;
export type NewWorkQueueRow = typeof workQueueTable.$inferInsert;

// ---------------------------------------------------------------------------
// Generic queue (SqliteQueue)
// ---------------------------------------------------------------------------

export const queueTable = sqliteTable(
  "queue",
  {
    id: text("id").notNull(),
    name: text("name").notNull(),
    payload: text("payload").notNull(),
    enqueuedAt: integer("enqueued_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.name, t.id] }),
    index("idx_queue_name").on(t.name),
  ]
);

export type QueueRow = typeof queueTable.$inferSelect;
export type NewQueueRow = typeof queueTable.$inferInsert;

// ---------------------------------------------------------------------------
// Persistence layer — kv_store (SqliteBackend)
// ---------------------------------------------------------------------------

export const kvStoreTable = sqliteTable(
  "kv_store",
  {
    namespace: text("namespace").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.namespace, t.key] }),
    index("idx_kv_expires").on(t.expiresAt),
    index("idx_kv_namespace").on(t.namespace),
  ]
);

export type KvStoreRow = typeof kvStoreTable.$inferSelect;
export type NewKvStoreRow = typeof kvStoreTable.$inferInsert;

// ---------------------------------------------------------------------------
// Persistence layer — events (SqliteBackend)
// ---------------------------------------------------------------------------

export const eventsTable = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    stream: text("stream").notNull(),
    type: text("type").notNull(),
    data: text("data").notNull(),
    metadata: text("metadata"),
    timestamp: integer("timestamp").notNull(),
    version: integer("version").notNull().default(1),
    sequence: integer("sequence").notNull(),
  },
  (t) => [
    index("idx_events_stream").on(t.stream, t.sequence),
    index("idx_events_type").on(t.stream, t.type, t.timestamp),
    index("idx_events_timestamp").on(t.stream, t.timestamp),
  ]
);

export type EventRow = typeof eventsTable.$inferSelect;
export type NewEventRow = typeof eventsTable.$inferInsert;

// ---------------------------------------------------------------------------
// Persistence layer — snapshots (SqliteBackend)
// ---------------------------------------------------------------------------

export const snapshotsTable = sqliteTable(
  "snapshots",
  {
    stream: text("stream").notNull(),
    type: text("type").notNull(),
    data: text("data").notNull(),
    eventId: text("event_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.stream, t.type] }),
    index("idx_snapshots_stream").on(t.stream),
  ]
);

export type SnapshotRow = typeof snapshotsTable.$inferSelect;
export type NewSnapshotRow = typeof snapshotsTable.$inferInsert;
