/**
 * Event-sourced stats store using the new unified persistence layer.
 * 
 * Replaces direct SQL operations with event sourcing for better auditability,
 * replay capabilities, and eventual consistency support.
 */

import type { PersistenceStore } from "../shared/persistence/index.js";
import { createEvent, EventTypes, EventStreamWrapper, Projections } from "../shared/persistence/event-store.js";
import type { RunRecord, CallEdgeRecord, RunQuery, AgentSummary, CallEdgeSummary } from "./store.js";

export class EventSourcedStatsStore {
  private statsStream: EventStreamWrapper;
  private callIdCounter = 0;
  
  // Cached projections for performance
  private agentSummaryCache = new Map<string, { data: AgentSummary; lastUpdate: number }>();
  private globalSummaryCache: { data: any; lastUpdate: number } | null = null;
  private cacheTimeout = 5 * 60 * 1000; // 5 minutes

  constructor(private persistence: PersistenceStore) {
    this.statsStream = new EventStreamWrapper(persistence.events.stream("stats"));
  }

  async recordRun(run: RunRecord): Promise<void> {
    // Record run started event
    await this.statsStream.appendTyped(
      EventTypes.RUN_STARTED,
      {
        instanceId: run.instanceId,
        agentName: run.agentName,
        triggerType: run.triggerType,
        triggerSource: run.triggerSource,
        startedAt: run.startedAt,
      },
      {
        source: "stats-store",
        correlationId: run.instanceId,
        actor: run.agentName,
      }
    );

    // Record run completion event
    const eventType = run.result === "error" ? EventTypes.RUN_FAILED : EventTypes.RUN_COMPLETED;
    await this.statsStream.appendTyped(
      eventType,
      {
        instanceId: run.instanceId,
        agentName: run.agentName,
        result: run.result,
        exitCode: run.exitCode,
        startedAt: run.startedAt,
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
        source: "stats-store",
        correlationId: run.instanceId,
        actor: run.agentName,
      }
    );

    // Invalidate caches
    this.invalidateCache();
  }

  async recordCallEdge(edge: CallEdgeRecord): Promise<number> {
    const callId = ++this.callIdCounter;
    
    await this.statsStream.appendTyped(
      EventTypes.CALL_INITIATED,
      {
        callId,
        callerAgent: edge.callerAgent,
        callerInstance: edge.callerInstance,
        targetAgent: edge.targetAgent,
        targetInstance: edge.targetInstance,
        depth: edge.depth,
        startedAt: edge.startedAt,
      },
      {
        source: "stats-store",
        correlationId: edge.callerInstance,
        actor: edge.callerAgent,
      }
    );

    // If the call is already completed, record completion event
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
          startedAt: edge.startedAt,
          durationMs: edge.durationMs,
          status: edge.status,
        },
        {
          source: "stats-store",
          correlationId: edge.callerInstance,
          actor: edge.callerAgent,
        }
      );
    }

    return callId;
  }

  async updateCallEdge(id: number, updates: { durationMs?: number; status?: string; targetInstance?: string }): Promise<void> {
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
          source: "stats-store",
          tags: ["call-update"],
        }
      );
    }
  }

  async queryRuns(query: RunQuery = {}): Promise<any[]> {
    const runs: any[] = [];
    const runStartEvents = new Map<string, any>();
    
    // Build projection from events
    const eventQuery = {
      from: query.since,
      limit: (query.limit || 100) * 2, // Get more events to account for start/complete pairs
    };
    
    for await (const event of this.statsStream.replayType(EventTypes.RUN_STARTED, query.since)) {
      if (query.agent && event.data.agentName !== query.agent) continue;
      runStartEvents.set(event.data.instanceId, {
        instance_id: event.data.instanceId,
        agent_name: event.data.agentName,
        trigger_type: event.data.triggerType,
        trigger_source: event.data.triggerSource,
        started_at: event.data.startedAt,
      });
    }
    
    // Get completion events and merge with starts
    for await (const event of this.statsStream.replay({
      type: EventTypes.RUN_COMPLETED,
      from: query.since,
      limit: query.limit || 100,
    })) {
      const startData = runStartEvents.get(event.data.instanceId);
      if (!startData) continue;
      if (query.agent && event.data.agentName !== query.agent) continue;
      
      runs.push({
        ...startData,
        result: event.data.result,
        exit_code: event.data.exitCode,
        duration_ms: event.data.durationMs,
        input_tokens: event.data.inputTokens,
        output_tokens: event.data.outputTokens,
        cache_read_tokens: event.data.cacheReadTokens,
        cache_write_tokens: event.data.cacheWriteTokens,
        total_tokens: event.data.totalTokens,
        cost_usd: event.data.costUsd,
        turn_count: event.data.turnCount,
        error_message: event.data.errorMessage,
        pre_hook_ms: event.data.preHookMs,
        post_hook_ms: event.data.postHookMs,
      });
    }
    
    // Also get failed runs
    for await (const event of this.statsStream.replay({
      type: EventTypes.RUN_FAILED,
      from: query.since,
      limit: query.limit || 100,
    })) {
      const startData = runStartEvents.get(event.data.instanceId);
      if (!startData) continue;
      if (query.agent && event.data.agentName !== query.agent) continue;
      
      runs.push({
        ...startData,
        result: "error",
        exit_code: event.data.exitCode,
        duration_ms: event.data.durationMs,
        input_tokens: event.data.inputTokens,
        output_tokens: event.data.outputTokens,
        cache_read_tokens: event.data.cacheReadTokens,
        cache_write_tokens: event.data.cacheWriteTokens,
        total_tokens: event.data.totalTokens,
        cost_usd: event.data.costUsd,
        turn_count: event.data.turnCount,
        error_message: event.data.errorMessage,
        pre_hook_ms: event.data.preHookMs,
        post_hook_ms: event.data.postHookMs,
      });
    }
    
    // Sort by started_at descending and limit
    return runs
      .sort((a, b) => b.started_at - a.started_at)
      .slice(0, query.limit || 100);
  }

  async queryAgentSummary(query: { agent?: string; since?: number } = {}): Promise<AgentSummary[]> {
    const cacheKey = `${query.agent || 'all'}:${query.since || 0}`;
    const cached = this.agentSummaryCache.get(cacheKey);
    
    if (cached && Date.now() - cached.lastUpdate < this.cacheTimeout) {
      return [cached.data];
    }
    
    // Build projection from events
    const agentStats = new Map<string, {
      agentName: string;
      totalRuns: number;
      okRuns: number;
      errorRuns: number;
      totalDuration: number;
      totalTokens: number;
      totalCost: number;
      preHookTotal: number;
      preHookCount: number;
      postHookTotal: number;
      postHookCount: number;
    }>();
    
    // Initialize for specific agent if requested
    if (query.agent) {
      agentStats.set(query.agent, {
        agentName: query.agent,
        totalRuns: 0,
        okRuns: 0,
        errorRuns: 0,
        totalDuration: 0,
        totalTokens: 0,
        totalCost: 0,
        preHookTotal: 0,
        preHookCount: 0,
        postHookTotal: 0,
        postHookCount: 0,
      });
    }
    
    // Process completion events
    for await (const event of this.statsStream.replay({
      type: EventTypes.RUN_COMPLETED,
      from: query.since,
    })) {
      if (query.agent && event.data.agentName !== query.agent) continue;
      
      const stats = agentStats.get(event.data.agentName) || {
        agentName: event.data.agentName,
        totalRuns: 0,
        okRuns: 0,
        errorRuns: 0,
        totalDuration: 0,
        totalTokens: 0,
        totalCost: 0,
        preHookTotal: 0,
        preHookCount: 0,
        postHookTotal: 0,
        postHookCount: 0,
      };
      
      stats.totalRuns++;
      stats.okRuns++;
      stats.totalDuration += event.data.durationMs || 0;
      stats.totalTokens += event.data.totalTokens || 0;
      stats.totalCost += event.data.costUsd || 0;
      
      if (event.data.preHookMs) {
        stats.preHookTotal += event.data.preHookMs;
        stats.preHookCount++;
      }
      
      if (event.data.postHookMs) {
        stats.postHookTotal += event.data.postHookMs;
        stats.postHookCount++;
      }
      
      agentStats.set(event.data.agentName, stats);
    }
    
    // Process failure events
    for await (const event of this.statsStream.replay({
      type: EventTypes.RUN_FAILED,
      from: query.since,
    })) {
      if (query.agent && event.data.agentName !== query.agent) continue;
      
      const stats = agentStats.get(event.data.agentName) || {
        agentName: event.data.agentName,
        totalRuns: 0,
        okRuns: 0,
        errorRuns: 0,
        totalDuration: 0,
        totalTokens: 0,
        totalCost: 0,
        preHookTotal: 0,
        preHookCount: 0,
        postHookTotal: 0,
        postHookCount: 0,
      };
      
      stats.totalRuns++;
      stats.errorRuns++;
      stats.totalDuration += event.data.durationMs || 0;
      stats.totalTokens += event.data.totalTokens || 0;
      stats.totalCost += event.data.costUsd || 0;
      
      if (event.data.preHookMs) {
        stats.preHookTotal += event.data.preHookMs;
        stats.preHookCount++;
      }
      
      if (event.data.postHookMs) {
        stats.postHookTotal += event.data.postHookMs;
        stats.postHookCount++;
      }
      
      agentStats.set(event.data.agentName, stats);
    }
    
    // Convert to final format
    const summaries = Array.from(agentStats.values()).map(stats => ({
      agentName: stats.agentName,
      totalRuns: stats.totalRuns,
      okRuns: stats.okRuns,
      errorRuns: stats.errorRuns,
      avgDurationMs: stats.totalRuns > 0 ? stats.totalDuration / stats.totalRuns : 0,
      totalTokens: stats.totalTokens,
      totalCost: stats.totalCost,
      avgPreHookMs: stats.preHookCount > 0 ? stats.preHookTotal / stats.preHookCount : null,
      avgPostHookMs: stats.postHookCount > 0 ? stats.postHookTotal / stats.postHookCount : null,
    }));
    
    // Cache the result
    if (query.agent && summaries.length > 0) {
      this.agentSummaryCache.set(cacheKey, {
        data: summaries[0],
        lastUpdate: Date.now(),
      });
    }
    
    return summaries.sort((a, b) => b.totalRuns - a.totalRuns);
  }

  async queryCallGraph(query: { since?: number } = {}): Promise<CallEdgeSummary[]> {
    const callGraph = new Map<string, {
      callerAgent: string;
      targetAgent: string;
      count: number;
      totalDepth: number;
      totalDuration: number;
      durationCount: number;
    }>();
    
    // Process call initiation events
    for await (const event of this.statsStream.replay({
      type: EventTypes.CALL_INITIATED,
      from: query.since,
    })) {
      const key = `${event.data.callerAgent}:${event.data.targetAgent}`;
      const stats = callGraph.get(key) || {
        callerAgent: event.data.callerAgent,
        targetAgent: event.data.targetAgent,
        count: 0,
        totalDepth: 0,
        totalDuration: 0,
        durationCount: 0,
      };
      
      stats.count++;
      stats.totalDepth += event.data.depth || 0;
      
      if (event.data.durationMs) {
        stats.totalDuration += event.data.durationMs;
        stats.durationCount++;
      }
      
      callGraph.set(key, stats);
    }
    
    // Convert to final format
    return Array.from(callGraph.values()).map(stats => ({
      callerAgent: stats.callerAgent,
      targetAgent: stats.targetAgent,
      count: stats.count,
      avgDepth: stats.count > 0 ? stats.totalDepth / stats.count : 0,
      avgDurationMs: stats.durationCount > 0 ? stats.totalDuration / stats.durationCount : null,
    })).sort((a, b) => b.count - a.count);
  }

  private invalidateCache(): void {
    this.agentSummaryCache.clear();
    this.globalSummaryCache = null;
  }

  async close(): Promise<void> {
    // Events are auto-persisted, nothing to close
  }

  // Create snapshot for fast queries
  async createSnapshot(): Promise<void> {
    const summary = await this.queryAgentSummary();
    await this.statsStream.saveSnapshot("agent-summary", summary, "latest");
    
    const callGraph = await this.queryCallGraph();
    await this.statsStream.saveSnapshot("call-graph", callGraph, "latest");
  }

  // Restore from snapshot + replay recent events
  async loadSnapshot(): Promise<void> {
    const summary = await this.statsStream.getSnapshot<AgentSummary[]>("agent-summary");
    if (summary) {
      // Use snapshot as cache seed
      for (const agent of summary) {
        this.agentSummaryCache.set(`${agent.agentName}:0`, {
          data: agent,
          lastUpdate: Date.now() - this.cacheTimeout / 2, // Half expired
        });
      }
    }
  }
}