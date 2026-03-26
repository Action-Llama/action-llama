import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";

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

export class StatsStore {
  private db: InstanceType<typeof Database>;
  private stmts: any;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id        TEXT NOT NULL,
        agent_name         TEXT NOT NULL,
        trigger_type       TEXT NOT NULL,
        trigger_source     TEXT,
        result             TEXT NOT NULL,
        exit_code          INTEGER,
        started_at         INTEGER NOT NULL,
        duration_ms        INTEGER NOT NULL,
        input_tokens       INTEGER NOT NULL DEFAULT 0,
        output_tokens      INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens       INTEGER NOT NULL DEFAULT 0,
        cost_usd           REAL NOT NULL DEFAULT 0,
        turn_count         INTEGER NOT NULL DEFAULT 0,
        error_message      TEXT,
        pre_hook_ms        INTEGER,
        post_hook_ms       INTEGER
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS webhook_receipts (
        id                 TEXT PRIMARY KEY,
        delivery_id        TEXT,
        source             TEXT NOT NULL,
        event_summary      TEXT,
        timestamp          INTEGER NOT NULL,
        headers            TEXT,
        body               TEXT,
        matched_agents     INTEGER NOT NULL DEFAULT 0,
        status             TEXT NOT NULL,
        dead_letter_reason TEXT
      )
    `);

    this.db.exec("CREATE INDEX IF NOT EXISTS idx_wr_timestamp ON webhook_receipts(timestamp)");
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_wr_delivery ON webhook_receipts(delivery_id) WHERE delivery_id IS NOT NULL");

    // Migrate: add webhook_receipt_id column to runs if missing
    const runsColumns = this.db.pragma("table_info(runs)") as { name: string }[];
    if (!runsColumns.some(c => c.name === "webhook_receipt_id")) {
      this.db.exec("ALTER TABLE runs ADD COLUMN webhook_receipt_id TEXT");
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS call_edges (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        caller_agent     TEXT NOT NULL,
        caller_instance  TEXT NOT NULL,
        target_agent     TEXT NOT NULL,
        target_instance  TEXT,
        depth            INTEGER NOT NULL DEFAULT 0,
        started_at       INTEGER NOT NULL,
        duration_ms      INTEGER,
        status           TEXT NOT NULL DEFAULT 'pending'
      )
    `);

    this.db.exec("CREATE INDEX IF NOT EXISTS idx_runs_agent ON runs(agent_name, started_at)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_calls_caller ON call_edges(caller_agent, started_at)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_calls_target ON call_edges(target_agent, started_at)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_calls_target_instance ON call_edges(target_instance)");

    this.stmts = {
      insertRun: this.db.prepare(`
        INSERT INTO runs (
          instance_id, agent_name, trigger_type, trigger_source, result, exit_code,
          started_at, duration_ms, input_tokens, output_tokens, cache_read_tokens,
          cache_write_tokens, total_tokens, cost_usd, turn_count, error_message,
          pre_hook_ms, post_hook_ms, webhook_receipt_id
        ) VALUES (
          @instanceId, @agentName, @triggerType, @triggerSource, @result, @exitCode,
          @startedAt, @durationMs, @inputTokens, @outputTokens, @cacheReadTokens,
          @cacheWriteTokens, @totalTokens, @costUsd, @turnCount, @errorMessage,
          @preHookMs, @postHookMs, @webhookReceiptId
        )
      `),
      insertCallEdge: this.db.prepare(`
        INSERT INTO call_edges (
          caller_agent, caller_instance, target_agent, target_instance, depth, started_at, duration_ms, status
        ) VALUES (
          @callerAgent, @callerInstance, @targetAgent, @targetInstance, @depth, @startedAt, @durationMs, @status
        )
      `),
      updateCallEdge: this.db.prepare(`
        UPDATE call_edges SET duration_ms = @durationMs, status = @status, target_instance = COALESCE(@targetInstance, target_instance) WHERE id = @id
      `),
      queryRuns: this.db.prepare(`
        SELECT * FROM runs WHERE started_at >= @since ORDER BY started_at DESC LIMIT @limit
      `),
      queryRunsByAgent: this.db.prepare(`
        SELECT * FROM runs WHERE agent_name = @agent AND started_at >= @since ORDER BY started_at DESC LIMIT @limit
      `),
      agentSummary: this.db.prepare(`
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
        WHERE started_at >= @since
        GROUP BY agent_name
        ORDER BY totalRuns DESC
      `),
      agentSummaryByName: this.db.prepare(`
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
        WHERE agent_name = @agent AND started_at >= @since
        GROUP BY agent_name
      `),
      callGraph: this.db.prepare(`
        SELECT
          caller_agent as callerAgent,
          target_agent as targetAgent,
          COUNT(*) as count,
          AVG(depth) as avgDepth,
          AVG(duration_ms) as avgDurationMs
        FROM call_edges
        WHERE started_at >= @since
        GROUP BY caller_agent, target_agent
        ORDER BY count DESC
      `),
      queryRunsByAgentPaginated: this.db.prepare(`
        SELECT * FROM runs WHERE agent_name = @agent ORDER BY started_at DESC LIMIT @limit OFFSET @offset
      `),
      countRunsByAgent: this.db.prepare(`
        SELECT COUNT(*) as count FROM runs WHERE agent_name = @agent
      `),
      queryRunByInstanceId: this.db.prepare(`
        SELECT * FROM runs WHERE instance_id = @instanceId LIMIT 1
      `),
      insertReceipt: this.db.prepare(`
        INSERT INTO webhook_receipts (
          id, delivery_id, source, event_summary, timestamp, headers, body,
          matched_agents, status, dead_letter_reason
        ) VALUES (
          @id, @deliveryId, @source, @eventSummary, @timestamp, @headers, @body,
          @matchedAgents, @status, @deadLetterReason
        )
      `),
      findReceiptByDeliveryId: this.db.prepare(
        "SELECT * FROM webhook_receipts WHERE delivery_id = @deliveryId LIMIT 1"
      ),
      getReceipt: this.db.prepare(
        "SELECT * FROM webhook_receipts WHERE id = @id LIMIT 1"
      ),
      updateReceiptStatus: this.db.prepare(
        "UPDATE webhook_receipts SET matched_agents = @matchedAgents, status = @status, dead_letter_reason = @deadLetterReason WHERE id = @id"
      ),
      queryTriggerHistory: this.db.prepare(`
        SELECT started_at AS ts, instance_id AS instanceId, agent_name AS agentName,
               trigger_type AS triggerType, trigger_source AS triggerSource,
               result, webhook_receipt_id AS webhookReceiptId,
               NULL AS deadLetterReason
        FROM runs WHERE started_at > @since
        UNION ALL
        SELECT timestamp AS ts, NULL AS instanceId, NULL AS agentName,
               'webhook' AS triggerType, source AS triggerSource,
               'dead-letter' AS result, id AS webhookReceiptId,
               dead_letter_reason AS deadLetterReason
        FROM webhook_receipts WHERE status = 'dead-letter' AND timestamp > @since
        ORDER BY ts DESC LIMIT @limit OFFSET @offset
      `),
      queryTriggerHistoryNoDeadLetters: this.db.prepare(`
        SELECT started_at AS ts, instance_id AS instanceId, agent_name AS agentName,
               trigger_type AS triggerType, trigger_source AS triggerSource,
               result, webhook_receipt_id AS webhookReceiptId,
               NULL AS deadLetterReason
        FROM runs WHERE started_at > @since
        ORDER BY ts DESC LIMIT @limit OFFSET @offset
      `),
      countTriggerHistory: this.db.prepare(
        "SELECT (SELECT COUNT(*) FROM runs WHERE started_at > @since) + (SELECT COUNT(*) FROM webhook_receipts WHERE status = 'dead-letter' AND timestamp > @since) AS count"
      ),
      countTriggerHistoryNoDeadLetters: this.db.prepare(
        "SELECT COUNT(*) AS count FROM runs WHERE started_at > @since"
      ),
      queryTriggerHistoryByAgent: this.db.prepare(`
        SELECT started_at AS ts, instance_id AS instanceId, agent_name AS agentName,
               trigger_type AS triggerType, trigger_source AS triggerSource,
               result, webhook_receipt_id AS webhookReceiptId,
               NULL AS deadLetterReason
        FROM runs WHERE started_at > @since AND agent_name = @agentName
        ORDER BY ts DESC LIMIT @limit OFFSET @offset
      `),
      countTriggerHistoryByAgent: this.db.prepare(
        "SELECT COUNT(*) AS count FROM runs WHERE started_at > @since AND agent_name = @agentName"
      ),
      pruneRuns: this.db.prepare("DELETE FROM runs WHERE started_at < @threshold"),
      pruneCallEdges: this.db.prepare("DELETE FROM call_edges WHERE started_at < @threshold"),
      queryCallEdgeByTarget: this.db.prepare(
        "SELECT * FROM call_edges WHERE target_instance = @targetInstance LIMIT 1"
      ),
      pruneReceipts: this.db.prepare("DELETE FROM webhook_receipts WHERE timestamp < @threshold"),
      globalSummary: this.db.prepare(`
        SELECT
          COUNT(*) as totalRuns,
          SUM(CASE WHEN result IN ('completed', 'rerun') THEN 1 ELSE 0 END) as okRuns,
          SUM(CASE WHEN result = 'error' THEN 1 ELSE 0 END) as errorRuns,
          SUM(total_tokens) as totalTokens,
          SUM(cost_usd) as totalCost
        FROM runs
        WHERE started_at >= @since
      `),
    };
  }

  recordRun(run: RunRecord): void {
    this.stmts.insertRun.run({
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
    });
  }

  recordCallEdge(edge: CallEdgeRecord): number {
    const result = this.stmts.insertCallEdge.run({
      callerAgent: edge.callerAgent,
      callerInstance: edge.callerInstance,
      targetAgent: edge.targetAgent,
      targetInstance: edge.targetInstance ?? null,
      depth: edge.depth,
      startedAt: edge.startedAt,
      durationMs: edge.durationMs ?? null,
      status: edge.status ?? "pending",
    });
    return Number(result.lastInsertRowid);
  }

  updateCallEdge(id: number, updates: { durationMs?: number; status?: string; targetInstance?: string }): void {
    this.stmts.updateCallEdge.run({
      id,
      durationMs: updates.durationMs ?? null,
      status: updates.status ?? null,
      targetInstance: updates.targetInstance ?? null,
    });
  }

  queryRunsByAgentPaginated(agent: string, limit: number, offset: number): any[] {
    return this.stmts.queryRunsByAgentPaginated.all({ agent, limit, offset });
  }

  countRunsByAgent(agent: string): number {
    const row = this.stmts.countRunsByAgent.get({ agent }) as any;
    return row?.count ?? 0;
  }

  queryRunByInstanceId(instanceId: string): any | undefined {
    return this.stmts.queryRunByInstanceId.get({ instanceId });
  }

  queryCallEdgeByTargetInstance(targetInstance: string): { caller_agent: string; caller_instance: string; target_agent: string; target_instance: string; depth: number; started_at: number; duration_ms: number | null; status: string } | undefined {
    return this.stmts.queryCallEdgeByTarget.get({ targetInstance }) as any;
  }

  queryRuns(query: RunQuery = {}): any[] {
    const since = query.since ?? 0;
    const limit = query.limit ?? 100;
    if (query.agent) {
      return this.stmts.queryRunsByAgent.all({ agent: query.agent, since, limit });
    }
    return this.stmts.queryRuns.all({ since, limit });
  }

  queryAgentSummary(query: { agent?: string; since?: number } = {}): AgentSummary[] {
    const since = query.since ?? 0;
    if (query.agent) {
      return this.stmts.agentSummaryByName.all({ agent: query.agent, since }) as AgentSummary[];
    }
    return this.stmts.agentSummary.all({ since }) as AgentSummary[];
  }

  queryGlobalSummary(since: number = 0): { totalRuns: number; okRuns: number; errorRuns: number; totalTokens: number; totalCost: number } {
    const row = this.stmts.globalSummary.get({ since }) as any;
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
    return this.stmts.callGraph.all({ since }) as CallEdgeSummary[];
  }

  recordWebhookReceipt(receipt: WebhookReceipt): void {
    this.stmts.insertReceipt.run({
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
    });
  }

  updateWebhookReceiptStatus(id: string, matchedAgents: number, status: "processed" | "dead-letter", deadLetterReason?: string): void {
    this.stmts.updateReceiptStatus.run({
      id,
      matchedAgents,
      status,
      deadLetterReason: deadLetterReason ?? null,
    });
  }

  findWebhookReceiptByDeliveryId(deliveryId: string): WebhookReceipt | undefined {
    const row = this.stmts.findReceiptByDeliveryId.get({ deliveryId }) as any;
    return row ? this.mapReceipt(row) : undefined;
  }

  getWebhookReceipt(id: string): WebhookReceipt | undefined {
    const row = this.stmts.getReceipt.get({ id }) as any;
    return row ? this.mapReceipt(row) : undefined;
  }

  queryTriggerHistory(opts: { since: number; limit: number; offset: number; includeDeadLetters: boolean; agentName?: string }): TriggerHistoryRow[] {
    if (opts.agentName) {
      return this.stmts.queryTriggerHistoryByAgent.all({ since: opts.since, limit: opts.limit, offset: opts.offset, agentName: opts.agentName }) as TriggerHistoryRow[];
    }
    const stmt = opts.includeDeadLetters ? this.stmts.queryTriggerHistory : this.stmts.queryTriggerHistoryNoDeadLetters;
    return stmt.all({ since: opts.since, limit: opts.limit, offset: opts.offset }) as TriggerHistoryRow[];
  }

  countTriggerHistory(since: number, includeDeadLetters: boolean, agentName?: string): number {
    if (agentName) {
      const row = this.stmts.countTriggerHistoryByAgent.get({ since, agentName }) as any;
      return row?.count ?? 0;
    }
    const stmt = includeDeadLetters ? this.stmts.countTriggerHistory : this.stmts.countTriggerHistoryNoDeadLetters;
    const row = stmt.get({ since }) as any;
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
    const runsResult = this.stmts.pruneRuns.run({ threshold });
    const callEdgesResult = this.stmts.pruneCallEdges.run({ threshold });
    const receiptsResult = this.stmts.pruneReceipts.run({ threshold });
    return {
      runs: runsResult.changes,
      callEdges: callEdgesResult.changes,
      receipts: receiptsResult.changes,
    };
  }

  close(): void {
    this.db.close();
  }
}
