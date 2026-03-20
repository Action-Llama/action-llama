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

    this.stmts = {
      insertRun: this.db.prepare(`
        INSERT INTO runs (
          instance_id, agent_name, trigger_type, trigger_source, result, exit_code,
          started_at, duration_ms, input_tokens, output_tokens, cache_read_tokens,
          cache_write_tokens, total_tokens, cost_usd, turn_count, error_message,
          pre_hook_ms, post_hook_ms
        ) VALUES (
          @instanceId, @agentName, @triggerType, @triggerSource, @result, @exitCode,
          @startedAt, @durationMs, @inputTokens, @outputTokens, @cacheReadTokens,
          @cacheWriteTokens, @totalTokens, @costUsd, @turnCount, @errorMessage,
          @preHookMs, @postHookMs
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
      pruneRuns: this.db.prepare("DELETE FROM runs WHERE started_at < @threshold"),
      pruneCallEdges: this.db.prepare("DELETE FROM call_edges WHERE started_at < @threshold"),
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

  prune(olderThanDays: number): { runs: number; callEdges: number } {
    const threshold = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    const runsResult = this.stmts.pruneRuns.run({ threshold });
    const callEdgesResult = this.stmts.pruneCallEdges.run({ threshold });
    return {
      runs: runsResult.changes,
      callEdges: callEdgesResult.changes,
    };
  }

  close(): void {
    this.db.close();
  }
}
