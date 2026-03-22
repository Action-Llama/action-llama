/**
 * StatsStore adapter for backward compatibility.
 * 
 * Implements the old StatsStore interface using event sourcing on the new persistence layer.
 * Converts method calls to events and builds projections for queries.
 */

import type { PersistenceStore, EventStream } from "../index.js";
import type { RunRecord, CallEdgeRecord, RunQuery, AgentSummary, CallEdgeSummary } from "../../../stats/store.js";
import { createEvent, EventTypes, EventStreamWrapper } from "../event-store.js";

export class StatsStoreAdapter {
  private statsStream: EventStreamWrapper;
  private callIdCounter = 0;

  constructor(private persistence: PersistenceStore) {
    this.statsStream = new EventStreamWrapper(persistence.events.stream("stats"));
  }

  recordRun(run: RunRecord): void {
    // Record as events asynchronously
    this.recordRunAsync(run).catch(error => {
      console.error("Failed to record run event:", error);
    });
  }

  private async recordRunAsync(run: RunRecord): Promise<void> {
    // Create run started event
    await this.statsStream.appendTyped(
      EventTypes.RUN_STARTED,
      {
        instanceId: run.instanceId,
        agentName: run.agentName,
        triggerType: run.triggerType,
        triggerSource: run.triggerSource,
      },
      {
        source: "stats-adapter",
        correlationId: run.instanceId,
        actor: run.agentName,
      }
    );

    // Create run completed/failed event
    const eventType = run.result === "error" ? EventTypes.RUN_FAILED : EventTypes.RUN_COMPLETED;
    await this.statsStream.appendTyped(
      eventType,
      {
        instanceId: run.instanceId,
        agentName: run.agentName,
        result: run.result,
        exitCode: run.exitCode,
        durationMs: run.durationMs,
        inputTokens: run.inputTokens || 0,
        outputTokens: run.outputTokens || 0,
        cacheReadTokens: run.cacheReadTokens || 0,
        cacheWriteTokens: run.cacheWriteTokens || 0,
        totalTokens: run.totalTokens || 0,
        costUsd: run.costUsd || 0,
        turnCount: run.turnCount || 0,
        errorMessage: run.errorMessage,
        preHookMs: run.preHookMs,
        postHookMs: run.postHookMs,
      },
      {
        source: "stats-adapter",
        correlationId: run.instanceId,
        actor: run.agentName,
      }
    );
  }

  recordCallEdge(edge: CallEdgeRecord): number {
    const callId = ++this.callIdCounter;
    
    // Record as events asynchronously
    this.recordCallEdgeAsync(edge, callId).catch(error => {
      console.error("Failed to record call edge event:", error);
    });
    
    return callId;
  }

  private async recordCallEdgeAsync(edge: CallEdgeRecord, callId: number): Promise<void> {
    // Create call initiated event
    await this.statsStream.appendTyped(
      EventTypes.CALL_INITIATED,
      {
        callId,
        callerAgent: edge.callerAgent,
        callerInstance: edge.callerInstance,
        targetAgent: edge.targetAgent,
        targetInstance: edge.targetInstance,
        depth: edge.depth,
      },
      {
        source: "stats-adapter",
        correlationId: edge.callerInstance,
        actor: edge.callerAgent,
      }
    );

    // If the call already has completion data, record that too
    if (edge.durationMs !== undefined) {
      const eventType = edge.status === "error" ? EventTypes.CALL_FAILED : EventTypes.CALL_COMPLETED;
      await this.statsStream.appendTyped(
        eventType,
        {
          callId,
          callerAgent: edge.callerAgent,
          callerInstance: edge.callerInstance,
          targetAgent: edge.targetAgent,
          targetInstance: edge.targetInstance,
          depth: edge.depth,
          durationMs: edge.durationMs,
          status: edge.status,
        },
        {
          source: "stats-adapter",
          correlationId: edge.callerInstance,
          actor: edge.callerAgent,
        }
      );
    }
  }

  updateCallEdge(id: number, updates: { durationMs?: number; status?: string; targetInstance?: string }): void {
    // This is tricky since we need to find the original call and update it
    // For now, we'll just record a completion event with the call ID
    this.updateCallEdgeAsync(id, updates).catch(error => {
      console.error("Failed to update call edge event:", error);
    });
  }

  private async updateCallEdgeAsync(id: number, updates: { durationMs?: number; status?: string; targetInstance?: string }): Promise<void> {
    if (updates.durationMs !== undefined) {
      const eventType = updates.status === "error" ? EventTypes.CALL_FAILED : EventTypes.CALL_COMPLETED;
      await this.statsStream.appendTyped(
        eventType,
        {
          callId: id,
          durationMs: updates.durationMs,
          status: updates.status,
          targetInstance: updates.targetInstance,
        },
        {
          source: "stats-adapter",
          tags: ["call-update"],
        }
      );
    }
  }

  async queryRunsByAgentPaginated(agent: string, limit: number, offset: number): Promise<any[]> {
    // Use SQL fallback for complex queries during migration
    return this.persistence.query.sql(
      `SELECT * FROM runs WHERE agent_name = ? ORDER BY started_at DESC LIMIT ? OFFSET ?`,
      [agent, limit, offset]
    );
  }

  async countRunsByAgent(agent: string): Promise<number> {
    const result = await this.persistence.query.sql<{ count: number }>(
      `SELECT COUNT(*) as count FROM runs WHERE agent_name = ?`,
      [agent]
    );
    return result[0]?.count || 0;
  }

  async queryRunByInstanceId(instanceId: string): Promise<any | undefined> {
    const result = await this.persistence.query.sql(
      `SELECT * FROM runs WHERE instance_id = ? LIMIT 1`,
      [instanceId]
    );
    return result[0];
  }

  async queryRuns(query: RunQuery = {}): Promise<any[]> {
    const since = query.since || 0;
    const limit = query.limit || 100;
    
    if (query.agent) {
      return this.persistence.query.sql(
        `SELECT * FROM runs WHERE agent_name = ? AND started_at >= ? ORDER BY started_at DESC LIMIT ?`,
        [query.agent, since, limit]
      );
    }
    
    return this.persistence.query.sql(
      `SELECT * FROM runs WHERE started_at >= ? ORDER BY started_at DESC LIMIT ?`,
      [since, limit]
    );
  }

  async queryAgentSummary(query: { agent?: string; since?: number } = {}): Promise<AgentSummary[]> {
    const since = query.since || 0;
    
    if (query.agent) {
      return this.persistence.query.sql(
        `SELECT
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
        GROUP BY agent_name`,
        [query.agent, since]
      );
    }
    
    return this.persistence.query.sql(
      `SELECT
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
      ORDER BY totalRuns DESC`,
      [since]
    );
  }

  async queryGlobalSummary(since: number = 0): Promise<{ totalRuns: number; okRuns: number; errorRuns: number; totalTokens: number; totalCost: number }> {
    const result = await this.persistence.query.sql<{
      totalRuns: number;
      okRuns: number;
      errorRuns: number;
      totalTokens: number;
      totalCost: number;
    }>(
      `SELECT
        COUNT(*) as totalRuns,
        SUM(CASE WHEN result IN ('completed', 'rerun') THEN 1 ELSE 0 END) as okRuns,
        SUM(CASE WHEN result = 'error' THEN 1 ELSE 0 END) as errorRuns,
        SUM(total_tokens) as totalTokens,
        SUM(cost_usd) as totalCost
      FROM runs
      WHERE started_at >= ?`,
      [since]
    );
    
    return result[0] || { totalRuns: 0, okRuns: 0, errorRuns: 0, totalTokens: 0, totalCost: 0 };
  }

  async queryCallGraph(query: { since?: number } = {}): Promise<CallEdgeSummary[]> {
    const since = query.since || 0;
    return this.persistence.query.sql(
      `SELECT
        caller_agent as callerAgent,
        target_agent as targetAgent,
        COUNT(*) as count,
        AVG(depth) as avgDepth,
        AVG(duration_ms) as avgDurationMs
      FROM call_edges
      WHERE started_at >= ?
      GROUP BY caller_agent, target_agent
      ORDER BY count DESC`,
      [since]
    );
  }

  prune(olderThanDays: number): { runs: number; callEdges: number } {
    const threshold = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    
    // This is a synchronous method in the original, so we'll make it async internally
    this.pruneAsync(threshold).catch(error => {
      console.error("Failed to prune stats:", error);
    });
    
    return { runs: 0, callEdges: 0 }; // Return dummy values for compatibility
  }

  private async pruneAsync(threshold: number): Promise<void> {
    await this.persistence.query.sql("DELETE FROM runs WHERE started_at < ?", [threshold]);
    await this.persistence.query.sql("DELETE FROM call_edges WHERE started_at < ?", [threshold]);
  }

  close(): void {
    // Don't close the underlying store since it might be shared
    // The actual store will be closed by the main application
  }
}