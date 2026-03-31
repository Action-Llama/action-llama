import { eq, and, gt, lt, desc, sql, asc } from "drizzle-orm";
import { createDb } from "../db/connection.js";
import { applyMigrations } from "../db/migrate.js";
import { runsTable, webhookReceiptsTable, callEdgesTable } from "../db/schema.js";
import type { AppDb } from "../db/connection.js";

export interface RunRecord {
  instanceId: string;
  agentName: string;
  triggerType: string;
  triggerSource?: string;
  result: string;
  exitCode?: number;
  startedAt: number;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  turnCount?: number;
  errorMessage?: string;
  preHookMs?: number;
  postHookMs?: number;
  webhookReceiptId?: string;
  triggerContext?: string;
}

export interface WebhookReceipt {
  id: string;
  deliveryId?: string;
  source: string;
  eventSummary?: string;
  timestamp: number;
  headers?: string;
  body?: string;
  matchedAgents: number;
  status: "processed" | "dead-letter";
  deadLetterReason?: "validation_failed" | "no_match" | "parse_error";
}

export interface TriggerHistoryRow {
  ts: number;
  instanceId: string | null;
  agentName: string | null;
  triggerType: string;
  triggerSource: string | null;
  result: string;
  webhookReceiptId: string | null;
  deadLetterReason: string | null;
}

export interface CallEdgeRecord {
  callerAgent: string;
  callerInstance: string;
  targetAgent: string;
  targetInstance?: string;
  depth: number;
  startedAt: number;
  durationMs?: number;
  status?: string;
}

export interface RunQuery {
  agent?: string;
  since?: number;
  limit?: number;
}

export interface AgentSummary {
  agentName: string;
  totalRuns: number;
  okRuns: number;
  errorRuns: number;
  avgDurationMs: number;
  totalTokens: number;
  totalCost: number;
  avgPreHookMs: number | null;
  avgPostHookMs: number | null;
}

export interface CallEdgeSummary {
  callerAgent: string;
  targetAgent: string;
  count: number;
  avgDepth: number;
  avgDurationMs: number | null;
}

/**
 * SQLite-backed StatsStore using Drizzle ORM.
 *
 * Supports two constructor signatures:
 *   new StatsStore(dbPath: string)  — creates its own connection (backward compat)
 *   new StatsStore(db: AppDb)       — uses a shared connection (preferred)
 */
export class StatsStore {
  private db: AppDb;
  private ownDb: boolean;

  constructor(dbOrPath: string | AppDb) {
    if (typeof dbOrPath === "string") {
      this.db = createDb(dbOrPath);
      this.ownDb = true;
      applyMigrations(this.db);
    } else {
      this.db = dbOrPath;
      this.ownDb = false;
    }
  }

  recordRun(run: RunRecord): void {
    this.db.insert(runsTable).values({
      instanceId: run.instanceId,
      agentName: run.agentName,
      triggerType: run.triggerType,
      triggerSource: run.triggerSource ?? null,
      result: run.result,
      exitCode: run.exitCode ?? null,
      startedAt: run.startedAt,
      durationMs: run.durationMs,
      inputTokens: run.inputTokens ?? 0,
      outputTokens: run.outputTokens ?? 0,
      cacheReadTokens: run.cacheReadTokens ?? 0,
      cacheWriteTokens: run.cacheWriteTokens ?? 0,
      totalTokens: run.totalTokens ?? 0,
      costUsd: run.costUsd ?? 0,
      turnCount: run.turnCount ?? 0,
      errorMessage: run.errorMessage ?? null,
      preHookMs: run.preHookMs ?? null,
      postHookMs: run.postHookMs ?? null,
      webhookReceiptId: run.webhookReceiptId ?? null,
      triggerContext: run.triggerContext ?? null,
    }).run();
  }

  recordCallEdge(edge: CallEdgeRecord): number {
    const result = this.db.insert(callEdgesTable).values({
      callerAgent: edge.callerAgent,
      callerInstance: edge.callerInstance,
      targetAgent: edge.targetAgent,
      targetInstance: edge.targetInstance ?? null,
      depth: edge.depth,
      startedAt: edge.startedAt,
      durationMs: edge.durationMs ?? null,
      status: edge.status ?? "pending",
    }).run();
    return Number(result.lastInsertRowid);
  }

  updateCallEdge(id: number, updates: { durationMs?: number; status?: string; targetInstance?: string }): void {
    this.db.update(callEdgesTable)
      .set({
        durationMs: updates.durationMs ?? undefined,
        status: updates.status ?? undefined,
        targetInstance: updates.targetInstance
          ? updates.targetInstance
          : undefined,
      })
      .where(eq(callEdgesTable.id, id))
      .run();
  }

  queryRunsByAgentPaginated(agent: string, limit: number, offset: number): any[] {
    return (this.db as any).$client
      .prepare("SELECT * FROM runs WHERE agent_name = ? ORDER BY started_at DESC LIMIT ? OFFSET ?")
      .all(agent, limit, offset);
  }

  countRunsByAgent(agent: string): number {
    const row = (this.db as any).$client
      .prepare("SELECT COUNT(*) as count FROM runs WHERE agent_name = ?")
      .get(agent) as any;
    return row?.count ?? 0;
  }

  queryRunByInstanceId(instanceId: string): any | undefined {
    return (this.db as any).$client
      .prepare("SELECT * FROM runs WHERE instance_id = ? LIMIT 1")
      .get(instanceId) as any;
  }

  queryCallEdgeByTargetInstance(targetInstance: string): { caller_agent: string; caller_instance: string; target_agent: string; target_instance: string; depth: number; started_at: number; duration_ms: number | null; status: string } | undefined {
    return (this.db as any).$client
      .prepare("SELECT * FROM call_edges WHERE target_instance = ? LIMIT 1")
      .get(targetInstance) as any;
  }

  queryRuns(query: RunQuery = {}): any[] {
    const since = query.since ?? 0;
    const limit = query.limit ?? 100;
    if (query.agent) {
      return (this.db as any).$client
        .prepare("SELECT * FROM runs WHERE agent_name = ? AND started_at >= ? ORDER BY started_at DESC LIMIT ?")
        .all(query.agent, since, limit);
    }
    return (this.db as any).$client
      .prepare("SELECT * FROM runs WHERE started_at >= ? ORDER BY started_at DESC LIMIT ?")
      .all(since, limit);
  }

  queryAgentSummary(query: { agent?: string; since?: number } = {}): AgentSummary[] {
    const since = query.since ?? 0;
    const client = (this.db as any).$client;
    if (query.agent) {
      return client.prepare(`
        SELECT
          agent_name as agentName,
          COUNT(*) as totalRuns,
          SUM(CASE WHEN result IN ('completed', 'rerun') THEN 1 ELSE 0 END) as okRuns,
          SUM(CASE WHEN result = 'error' THEN 1 ELSE 0 END) as errorRuns,
          AVG(duration_ms) as avgDurationMs,
          SUM(total_tokens) as totalTokens,
          SUM(cost_usd) as totalCost,
          AVG(pre_hook_ms) as avgPreHookMs,
          AVG(post_hook_ms) as avgPostHookMs
        FROM runs
        WHERE agent_name = ? AND started_at >= ?
        GROUP BY agent_name
      `).all(query.agent, since) as AgentSummary[];
    }
    return client.prepare(`
      SELECT
        agent_name as agentName,
        COUNT(*) as totalRuns,
        SUM(CASE WHEN result IN ('completed', 'rerun') THEN 1 ELSE 0 END) as okRuns,
        SUM(CASE WHEN result = 'error' THEN 1 ELSE 0 END) as errorRuns,
        AVG(duration_ms) as avgDurationMs,
        SUM(total_tokens) as totalTokens,
        SUM(cost_usd) as totalCost,
        AVG(pre_hook_ms) as avgPreHookMs,
        AVG(post_hook_ms) as avgPostHookMs
      FROM runs
      WHERE started_at >= ?
      GROUP BY agent_name
      ORDER BY totalRuns DESC
    `).all(since) as AgentSummary[];
  }

  queryGlobalSummary(since: number = 0): { totalRuns: number; okRuns: number; errorRuns: number; totalTokens: number; totalCost: number } {
    const row = (this.db as any).$client.prepare(`
      SELECT
        COUNT(*) as totalRuns,
        SUM(CASE WHEN result IN ('completed', 'rerun') THEN 1 ELSE 0 END) as okRuns,
        SUM(CASE WHEN result = 'error' THEN 1 ELSE 0 END) as errorRuns,
        SUM(total_tokens) as totalTokens,
        SUM(cost_usd) as totalCost
      FROM runs
      WHERE started_at >= ?
    `).get(since) as any;
    return {
      totalRuns: row.totalRuns ?? 0,
      okRuns: row.okRuns ?? 0,
      errorRuns: row.errorRuns ?? 0,
      totalTokens: row.totalTokens ?? 0,
      totalCost: row.totalCost ?? 0,
    };
  }

  queryCallGraph(query: { since?: number } = {}): CallEdgeSummary[] {
    const since = query.since ?? 0;
    return (this.db as any).$client.prepare(`
      SELECT
        caller_agent as callerAgent,
        target_agent as targetAgent,
        COUNT(*) as count,
        AVG(depth) as avgDepth,
        AVG(duration_ms) as avgDurationMs
      FROM call_edges
      WHERE started_at >= ?
      GROUP BY caller_agent, target_agent
      ORDER BY count DESC
    `).all(since) as CallEdgeSummary[];
  }

  recordWebhookReceipt(receipt: WebhookReceipt): void {
    this.db.insert(webhookReceiptsTable).values({
      id: receipt.id,
      deliveryId: receipt.deliveryId ?? null,
      source: receipt.source,
      eventSummary: receipt.eventSummary ?? null,
      timestamp: receipt.timestamp,
      headers: receipt.headers ?? null,
      body: receipt.body ?? null,
      matchedAgents: receipt.matchedAgents,
      status: receipt.status,
      deadLetterReason: receipt.deadLetterReason ?? null,
    }).run();
  }

  updateWebhookReceiptStatus(id: string, matchedAgents: number, status: "processed" | "dead-letter", deadLetterReason?: string): void {
    this.db.update(webhookReceiptsTable)
      .set({ matchedAgents, status, deadLetterReason: deadLetterReason ?? null })
      .where(eq(webhookReceiptsTable.id, id))
      .run();
  }

  findWebhookReceiptByDeliveryId(deliveryId: string): WebhookReceipt | undefined {
    const row = (this.db as any).$client
      .prepare("SELECT * FROM webhook_receipts WHERE delivery_id = ? LIMIT 1")
      .get(deliveryId) as any;
    return row ? this.mapReceipt(row) : undefined;
  }

  getWebhookSourcesBatch(ids: string[]): Record<string, string> {
    if (ids.length === 0) return {};
    const client = (this.db as any).$client;
    const placeholders = ids.map(() => "?").join(",");
    const rows = client.prepare(
      `SELECT id, source FROM webhook_receipts WHERE id IN (${placeholders})`
    ).all(...ids) as { id: string; source: string }[];
    return Object.fromEntries(rows.map((r) => [r.id, r.source]));
  }

  getWebhookReceipt(id: string): WebhookReceipt | undefined {
    const row = (this.db as any).$client
      .prepare("SELECT * FROM webhook_receipts WHERE id = ? LIMIT 1")
      .get(id) as any;
    return row ? this.mapReceipt(row) : undefined;
  }

  queryTriggerHistory(opts: { since: number; limit: number; offset: number; includeDeadLetters: boolean; agentName?: string; triggerType?: string }): TriggerHistoryRow[] {
    const { since, limit, offset, includeDeadLetters, agentName, triggerType } = opts;
    const client = (this.db as any).$client;

    if (agentName && triggerType) {
      return client.prepare(`
        SELECT started_at AS ts, instance_id AS instanceId, agent_name AS agentName,
               trigger_type AS triggerType, trigger_source AS triggerSource,
               result, webhook_receipt_id AS webhookReceiptId,
               NULL AS deadLetterReason
        FROM runs WHERE started_at > ? AND agent_name = ? AND trigger_type = ?
        ORDER BY ts DESC LIMIT ? OFFSET ?
      `).all(since, agentName, triggerType, limit, offset) as TriggerHistoryRow[];
    }
    if (agentName) {
      return client.prepare(`
        SELECT started_at AS ts, instance_id AS instanceId, agent_name AS agentName,
               trigger_type AS triggerType, trigger_source AS triggerSource,
               result, webhook_receipt_id AS webhookReceiptId,
               NULL AS deadLetterReason
        FROM runs WHERE started_at > ? AND agent_name = ?
        ORDER BY ts DESC LIMIT ? OFFSET ?
      `).all(since, agentName, limit, offset) as TriggerHistoryRow[];
    }
    if (triggerType) {
      if (includeDeadLetters && triggerType === "webhook") {
        return client.prepare(`
          SELECT started_at AS ts, instance_id AS instanceId, agent_name AS agentName,
                 trigger_type AS triggerType, trigger_source AS triggerSource,
                 result, webhook_receipt_id AS webhookReceiptId,
                 NULL AS deadLetterReason
          FROM runs WHERE started_at > ? AND trigger_type = ?
          UNION ALL
          SELECT timestamp AS ts, NULL AS instanceId, NULL AS agentName,
                 'webhook' AS triggerType, source AS triggerSource,
                 'dead-letter' AS result, id AS webhookReceiptId,
                 dead_letter_reason AS deadLetterReason
          FROM webhook_receipts WHERE status = 'dead-letter' AND timestamp > ?
          ORDER BY ts DESC LIMIT ? OFFSET ?
        `).all(since, triggerType, since, limit, offset) as TriggerHistoryRow[];
      }
      return client.prepare(`
        SELECT started_at AS ts, instance_id AS instanceId, agent_name AS agentName,
               trigger_type AS triggerType, trigger_source AS triggerSource,
               result, webhook_receipt_id AS webhookReceiptId,
               NULL AS deadLetterReason
        FROM runs WHERE started_at > ? AND trigger_type = ?
        ORDER BY ts DESC LIMIT ? OFFSET ?
      `).all(since, triggerType, limit, offset) as TriggerHistoryRow[];
    }
    if (includeDeadLetters) {
      return client.prepare(`
        SELECT started_at AS ts, instance_id AS instanceId, agent_name AS agentName,
               trigger_type AS triggerType, trigger_source AS triggerSource,
               result, webhook_receipt_id AS webhookReceiptId,
               NULL AS deadLetterReason
        FROM runs WHERE started_at > ?
        UNION ALL
        SELECT timestamp AS ts, NULL AS instanceId, NULL AS agentName,
               'webhook' AS triggerType, source AS triggerSource,
               'dead-letter' AS result, id AS webhookReceiptId,
               dead_letter_reason AS deadLetterReason
        FROM webhook_receipts WHERE status = 'dead-letter' AND timestamp > ?
        ORDER BY ts DESC LIMIT ? OFFSET ?
      `).all(since, since, limit, offset) as TriggerHistoryRow[];
    }
    return client.prepare(`
      SELECT started_at AS ts, instance_id AS instanceId, agent_name AS agentName,
             trigger_type AS triggerType, trigger_source AS triggerSource,
             result, webhook_receipt_id AS webhookReceiptId,
             NULL AS deadLetterReason
      FROM runs WHERE started_at > ?
      ORDER BY ts DESC LIMIT ? OFFSET ?
    `).all(since, limit, offset) as TriggerHistoryRow[];
  }

  countTriggerHistory(since: number, includeDeadLetters: boolean, agentName?: string, triggerType?: string): number {
    const client = (this.db as any).$client;
    if (agentName && triggerType) {
      const row = client.prepare("SELECT COUNT(*) AS count FROM runs WHERE started_at > ? AND agent_name = ? AND trigger_type = ?").get(since, agentName, triggerType) as any;
      return row?.count ?? 0;
    }
    if (agentName) {
      const row = client.prepare("SELECT COUNT(*) AS count FROM runs WHERE started_at > ? AND agent_name = ?").get(since, agentName) as any;
      return row?.count ?? 0;
    }
    if (triggerType) {
      if (includeDeadLetters && triggerType === "webhook") {
        const row = client.prepare("SELECT (SELECT COUNT(*) FROM runs WHERE started_at > ? AND trigger_type = ?) + (SELECT COUNT(*) FROM webhook_receipts WHERE status = 'dead-letter' AND timestamp > ?) AS count").get(since, triggerType, since) as any;
        return row?.count ?? 0;
      }
      const row = client.prepare("SELECT COUNT(*) AS count FROM runs WHERE started_at > ? AND trigger_type = ?").get(since, triggerType) as any;
      return row?.count ?? 0;
    }
    if (includeDeadLetters) {
      const row = client.prepare("SELECT (SELECT COUNT(*) FROM runs WHERE started_at > ?) + (SELECT COUNT(*) FROM webhook_receipts WHERE status = 'dead-letter' AND timestamp > ?) AS count").get(since, since) as any;
      return row?.count ?? 0;
    }
    const row = client.prepare("SELECT COUNT(*) AS count FROM runs WHERE started_at > ?").get(since) as any;
    return row?.count ?? 0;
  }

  private mapReceipt(row: any): WebhookReceipt {
    return {
      id: row.id,
      deliveryId: row.delivery_id ?? undefined,
      source: row.source,
      eventSummary: row.event_summary ?? undefined,
      timestamp: row.timestamp,
      headers: row.headers ?? undefined,
      body: row.body ?? undefined,
      matchedAgents: row.matched_agents,
      status: row.status,
      deadLetterReason: row.dead_letter_reason ?? undefined,
    };
  }

  prune(olderThanDays: number): { runs: number; callEdges: number; receipts: number } {
    const threshold = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    const client = (this.db as any).$client;
    const runsResult = client.prepare("DELETE FROM runs WHERE started_at < ?").run(threshold);
    const callEdgesResult = client.prepare("DELETE FROM call_edges WHERE started_at < ?").run(threshold);
    const receiptsResult = client.prepare("DELETE FROM webhook_receipts WHERE timestamp < ?").run(threshold);
    return {
      runs: runsResult.changes,
      callEdges: callEdgesResult.changes,
      receipts: receiptsResult.changes,
    };
  }

  close(): void {
    if (this.ownDb) {
      (this.db as any).$client.close();
    }
  }
}
