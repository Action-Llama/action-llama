import {
  buildScheduledPrompt, buildWebhookPrompt, buildCalledPrompt, buildManualPrompt,
  buildScheduledSuffix, buildWebhookSuffix, buildCalledSuffix, buildManualSuffix, buildUserPromptSuffix,
  type PromptSkills,
} from "../agents/prompt.js";
import type { WorkQueue, QueuedWorkItem } from "../shared/work-queue.js";
import { RunnerPool, type PoolRunner } from "./runner-pool.js";
import { dispatchOrQueue } from "./dispatch-policy.js";
import type { AgentConfig } from "../shared/config.js";
import type { WebhookContext } from "../webhooks/types.js";
import type { createLogger } from "../shared/logger.js";
import type { SchedulerEventBus } from "../scheduler/events.js";
import type { CallStore } from "./call-store.js";
import type { StatusTracker } from "../tui/status-tracker.js";
import type { StatsStore } from "../stats/index.js";
import type { InstanceLifecycle } from "./lifecycle/instance-lifecycle.js";

export const DEFAULT_MAX_RERUNS = 10;
export const DEFAULT_MAX_TRIGGER_DEPTH = 3;

export type WorkItem =
  | { type: 'webhook'; context: WebhookContext }
  | { type: 'agent-trigger'; sourceAgent: string; context: string; depth: number; callId?: string }
  | { type: 'schedule' }
  | { type: 'manual'; prompt?: string };

export interface RunCompleteEvent {
  agentName: string;
  result: string;
  triggerType: string;
}

export interface SchedulerContext {
  runnerPools: Record<string, RunnerPool>;
  agentConfigs: AgentConfig[];
  maxReruns: number;
  maxTriggerDepth: number;
  logger: ReturnType<typeof createLogger>;
  workQueue: WorkQueue<WorkItem>;
  shuttingDown: boolean;
  skills?: PromptSkills;
  useBakedImages: boolean;
  /** Optional hook called after every agent run completes. Used for test instrumentation. */
  onRunComplete?: (event: RunCompleteEvent) => void;
  /** Optional event bus for lifecycle instrumentation (used by integration tests). */
  events?: SchedulerEventBus;
  /** Optional call store for updating al-subagent lifecycle status. */
  callStore?: CallStore;
  /** Optional status tracker — used to check global pause state. */
  statusTracker?: StatusTracker;
  /** Returns false if the named agent has been paused/disabled; undefined = treat as enabled. */
  isAgentEnabled?: (name: string) => boolean;
  /** Optional stats store for recording run history and call edges. */
  statsStore?: StatsStore;
  /** Returns true if the scheduler is paused. */
  isPaused?: () => boolean;
}

// Prompt helpers: when images have baked-in static files, only pass the dynamic suffix.
// Otherwise, pass the full prompt (for non-Docker or legacy images).
export function makeScheduledPrompt(agentConfig: AgentConfig, ctx: SchedulerContext): string {
  return ctx.useBakedImages ? buildScheduledSuffix() : buildScheduledPrompt(agentConfig, ctx.skills);
}

export function makeWebhookPrompt(agentConfig: AgentConfig, context: WebhookContext, ctx: SchedulerContext): string {
  return ctx.useBakedImages ? buildWebhookSuffix(context) : buildWebhookPrompt(agentConfig, context, ctx.skills);
}

export function makeManualPrompt(agentConfig: AgentConfig, ctx: SchedulerContext, prompt?: string): string {
  if (ctx.useBakedImages) {
    return prompt ? buildUserPromptSuffix(prompt) : buildManualSuffix();
  }
  return buildManualPrompt(agentConfig, ctx.skills, prompt);
}

export function makeTriggeredPrompt(agentConfig: AgentConfig, sourceAgent: string, context: string, ctx: SchedulerContext): string {
  return ctx.useBakedImages ? buildCalledSuffix(sourceAgent, context) : buildCalledPrompt(agentConfig, sourceAgent, context, ctx.skills);
}

/** Run a single agent and dispatch any resulting triggers. */
export async function executeRun(
  runner: PoolRunner, prompt: string,
  triggerInfo: { type: 'schedule' | 'manual' | 'webhook' | 'agent'; source?: string; receiptId?: string; context?: string },
  agentName: string, depth: number, ctx: SchedulerContext,
  instanceLifecycle?: InstanceLifecycle,
  instanceId?: string
): Promise<{ result: string; triggers: Array<{ agent: string; context: string }>; returnValue?: string }> {
  const startedAt = Date.now();

  // Start instance lifecycle if provided
  instanceLifecycle?.start();

  ctx.events?.emit("run:start", {
    agentName,
    instanceId: runner.instanceId,
    trigger: triggerInfo.source ? `${triggerInfo.type}:${triggerInfo.source}` : triggerInfo.type,
  });

  let outcome: any;
  let error: string | undefined;
  try {
    outcome = await runner.run(prompt, triggerInfo, instanceId);
    error = outcome.exitReason;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    outcome = { result: "error", exitCode: 1, exitReason: error };
  }

  const durationMs = Date.now() - startedAt;
  const triggers = outcome.triggers ?? [];
  if (triggers.length > 0) dispatchTriggers(triggers, agentName, depth, ctx, runner.instanceId);

  // Update instance lifecycle based on outcome
  if (instanceLifecycle) {
    if (error) {
      instanceLifecycle.fail(error);
    } else {
      instanceLifecycle.complete();
    }
  }

  ctx.events?.emit("run:end", {
    agentName,
    instanceId: runner.instanceId,
    result: outcome.result,
    exitCode: outcome.exitCode,
    error: outcome.exitReason,
  });

  // Record run in stats store
  if (ctx.statsStore) {
    try {
      ctx.statsStore.recordRun({
        instanceId: runner.instanceId,
        agentName,
        triggerType: triggerInfo.type,
        triggerSource: triggerInfo.source,
        result: outcome.result,
        exitCode: outcome.exitCode,
        startedAt,
        durationMs,
        inputTokens: outcome.usage?.inputTokens,
        outputTokens: outcome.usage?.outputTokens,
        cacheReadTokens: outcome.usage?.cacheReadTokens,
        cacheWriteTokens: outcome.usage?.cacheWriteTokens,
        totalTokens: outcome.usage?.totalTokens,
        costUsd: outcome.usage?.cost,
        turnCount: outcome.usage?.turnCount,
        errorMessage: outcome.exitReason,
        preHookMs: outcome.preHookMs,
        postHookMs: outcome.postHookMs,
        webhookReceiptId: triggerInfo.receiptId,
        triggerContext: triggerInfo.context,
      });
    } catch (err) {
      ctx.logger.warn({ err, agent: agentName }, "failed to record run stats");
    }
  }

  ctx.onRunComplete?.({ agentName, result: outcome.result, triggerType: triggerInfo.type });
  return { result: outcome.result, triggers, returnValue: outcome.returnValue };
}

export function dispatchTriggers(
  triggers: Array<{ agent: string; context: string }>,
  sourceAgent: string, depth: number, ctx: SchedulerContext,
  callerInstanceId?: string,
): void {
  for (const { agent, context } of triggers) {
    if (agent === sourceAgent) {
      ctx.logger.warn({ source: sourceAgent }, "agent cannot trigger itself, skipping");
      continue;
    }
    if (depth >= ctx.maxTriggerDepth) {
      ctx.logger.warn({ source: sourceAgent, target: agent, depth }, "trigger depth limit reached, skipping");
      continue;
    }
    const targetConfig = ctx.agentConfigs.find((a) => a.name === agent);
    if (!targetConfig) {
      ctx.logger.warn({ source: sourceAgent, target: agent }, "trigger target not found, skipping");
      continue;
    }
    const pool = ctx.runnerPools[agent];

    // Record call edge
    let callEdgeId: number | undefined;
    if (ctx.statsStore && callerInstanceId) {
      try {
        callEdgeId = ctx.statsStore.recordCallEdge({
          callerAgent: sourceAgent,
          callerInstance: callerInstanceId,
          targetAgent: agent,
          depth: depth + 1,
          startedAt: Date.now(),
          status: "pending",
        });
      } catch (err) {
        ctx.logger.warn({ err }, "failed to record call edge");
      }
    }

    const result = dispatchOrQueue(agent, { type: 'agent-trigger', sourceAgent, context, depth } as WorkItem, {
      pool,
      workQueue: ctx.workQueue,
      isPaused: ctx.isPaused,
      isAgentEnabled: ctx.isAgentEnabled,
    });

    if (result.action === "rejected") {
      if (result.reason === "agent is disabled (scale=0)") {
        ctx.logger.info({ source: sourceAgent, target: agent }, "target disabled (scale=0), skipping");
      } else {
        ctx.logger.info({ source: sourceAgent, target: agent, reason: result.reason }, "trigger skipped");
      }
      continue;
    }
    if (result.action === "queued") {
      ctx.statusTracker?.setQueuedWebhooks(agent, ctx.workQueue.size(agent));
      if (result.cause === "agent-disabled") {
        ctx.logger.info({ source: sourceAgent, target: agent }, "target agent is paused, trigger queued");
      } else {
        ctx.logger.info({ source: sourceAgent, target: agent }, "all runners busy, trigger queued");
      }
      continue;
    }
    // result.action === "dispatched"
    const dispatchedRunner = result.runner;
    ctx.logger.info({ source: sourceAgent, target: agent, depth }, "agent trigger firing");
    const prompt = makeTriggeredPrompt(targetConfig, sourceAgent, context, ctx);
    const edgeStartedAt = Date.now();
    
    // Create instance lifecycle for triggered run (if supported)
    const instanceLifecycle = ctx.statusTracker?.createInstance ? 
      ctx.statusTracker.createInstance(dispatchedRunner.instanceId, agent, `agent:${sourceAgent}`) || undefined :
      undefined;
    
    executeRun(dispatchedRunner, prompt, { type: 'agent', source: sourceAgent, context }, agent, depth + 1, ctx, instanceLifecycle)
      .then((outcome) => {
        if (callEdgeId != null && ctx.statsStore) {
          try {
            ctx.statsStore.updateCallEdge(callEdgeId, {
              durationMs: Date.now() - edgeStartedAt,
              status: outcome.result === "error" ? "error" : "completed",
              targetInstance: dispatchedRunner.instanceId,
            });
          } catch { /* best-effort */ }
        }
        return drainQueues(ctx);
      })
      .catch((err) => {
        if (callEdgeId != null && ctx.statsStore) {
          try {
            ctx.statsStore.updateCallEdge(callEdgeId, {
              durationMs: Date.now() - edgeStartedAt,
              status: "error",
            });
          } catch { /* best-effort */ }
        }
        ctx.logger.error({ err, target: agent }, "triggered run failed");
      });
  }
}

/** Drain all agents' work queues — fires runs without blocking. */
export async function drainQueues(ctx: SchedulerContext): Promise<void> {
  if (ctx.shuttingDown) return;
  if (ctx.statusTracker?.isPaused()) return;
  for (const agentConfig of ctx.agentConfigs) {
    if (ctx.isAgentEnabled && !ctx.isAgentEnabled(agentConfig.name)) continue;
    const pool = ctx.runnerPools[agentConfig.name];
    if (!pool || ctx.workQueue.size(agentConfig.name) === 0) continue;
    for (const runner of pool.getAllAvailableRunners()) {
      const item = ctx.workQueue.dequeue(agentConfig.name);
      if (!item) break;
      fireQueuedItem(item, runner, agentConfig, ctx);
    }
    // Update pending count after draining
    ctx.statusTracker?.setQueuedWebhooks(agentConfig.name, ctx.workQueue.size(agentConfig.name));
  }
}

function fireQueuedItem(
  item: QueuedWorkItem<WorkItem>, runner: PoolRunner,
  agentConfig: AgentConfig, ctx: SchedulerContext
): void {
  const work = item.context;
  const ageMs = Date.now() - item.receivedAt.getTime();

  if (work.type === 'webhook') {
    ctx.logger.info({ agent: agentConfig.name, event: work.context.event, ageMs }, "draining queued webhook");
    
    // Create instance lifecycle for webhook run (if supported)
    const instanceLifecycle = ctx.statusTracker?.createInstance ? 
      ctx.statusTracker.createInstance(runner.instanceId, agentConfig.name, `webhook:${work.context.source}`) || undefined :
      undefined;
    
    const prompt = makeWebhookPrompt(agentConfig, work.context, ctx);
    executeRun(runner, prompt, { type: 'webhook', source: work.context.source, receiptId: work.context.receiptId }, agentConfig.name, 0, ctx, instanceLifecycle)
      .then(() => drainQueues(ctx))
      .catch((err) => ctx.logger.error({ err, agent: agentConfig.name }, "queued webhook failed"));

  } else if (work.type === 'agent-trigger') {
    if (work.depth >= ctx.maxTriggerDepth) return;
    ctx.logger.info({ source: work.sourceAgent, target: agentConfig.name, depth: work.depth, ageMs }, "draining queued trigger");
    
    // Create instance lifecycle for agent trigger run (if supported)
    const instanceLifecycle = ctx.statusTracker?.createInstance ? 
      ctx.statusTracker.createInstance(runner.instanceId, agentConfig.name, `agent:${work.sourceAgent}`) || undefined :
      undefined;
    
    const prompt = makeTriggeredPrompt(agentConfig, work.sourceAgent, work.context, ctx);
    if (work.callId) ctx.callStore?.setRunning(work.callId);
    executeRun(runner, prompt, { type: 'agent', source: work.sourceAgent, context: work.context }, agentConfig.name, work.depth + 1, ctx, instanceLifecycle)
      .then(({ result, returnValue }) => {
        if (work.callId) {
          if (result === "completed" || result === "rerun") ctx.callStore?.complete(work.callId, returnValue);
          else ctx.callStore?.fail(work.callId, "agent run failed");
        }
        return drainQueues(ctx);
      })
      .catch((err) => {
        if (work.callId) ctx.callStore?.fail(work.callId, err?.message || "unknown error");
        ctx.logger.error({ err, agent: agentConfig.name }, "queued trigger failed");
      });

  } else if (work.type === 'schedule') {
    ctx.logger.info({ agent: agentConfig.name, ageMs }, "draining queued scheduled run");
    // runWithReruns already calls drainQueues on completion and handles instance lifecycle
    runWithReruns(runner, agentConfig, 0, ctx, 'schedule')
      .catch((err) => ctx.logger.error({ err, agent: agentConfig.name }, "queued scheduled run failed"));

  } else if (work.type === 'manual') {
    ctx.logger.info({ agent: agentConfig.name, ageMs }, "draining queued manual trigger");
    runWithReruns(runner, agentConfig, 0, ctx, 'manual', work.prompt)
      .catch((err) => ctx.logger.error({ err, agent: agentConfig.name }, "queued manual trigger failed"));
  }
}

export async function runWithReruns(
  runner: PoolRunner, agentConfig: AgentConfig, depth: number, ctx: SchedulerContext,
  trigger: 'schedule' | 'manual' = 'schedule', prompt?: string, instanceId?: string
): Promise<void> {
  const isManual = trigger === 'manual';
  const triggerType = trigger;
  const triggerLabel = trigger;

  // Create instance lifecycle for this run (if supported)
  const instanceLifecycle = ctx.statusTracker?.createInstance ?
    ctx.statusTracker.createInstance(runner.instanceId, agentConfig.name, triggerLabel) || undefined :
    undefined;

  const initialPrompt = isManual
    ? makeManualPrompt(agentConfig, ctx, prompt)
    : makeScheduledPrompt(agentConfig, ctx);

  let { result } = await executeRun(
    runner, initialPrompt, { type: triggerType, source: prompt ? 'user-prompt' : undefined, context: prompt }, agentConfig.name, depth, ctx, instanceLifecycle, instanceId
  );

  let reruns = 0;
  while (result === "rerun" && reruns < ctx.maxReruns) {
    if (ctx.isAgentEnabled && !ctx.isAgentEnabled(agentConfig.name)) {
      ctx.logger.info({ agent: agentConfig.name }, "agent paused, stopping reruns");
      break;
    }
    reruns++;
    ctx.logger.info({ rerun: reruns, maxReruns: ctx.maxReruns }, `${agentConfig.name} requested rerun`);
    
    // Create new instance lifecycle for rerun (if supported)
    const rerunInstanceLifecycle = ctx.statusTracker?.createInstance ?
      ctx.statusTracker.createInstance(runner.instanceId, agentConfig.name, `${triggerLabel}:rerun-${reruns}`) || undefined :
      undefined;

    const rerunPrompt = isManual
      ? makeManualPrompt(agentConfig, ctx)
      : makeScheduledPrompt(agentConfig, ctx);

    ({ result } = await executeRun(
      runner, rerunPrompt,
      { type: triggerType, source: `rerun ${reruns}/${ctx.maxReruns}` }, agentConfig.name, depth, ctx, rerunInstanceLifecycle
    ));
  }

  if (result === "rerun" && reruns >= ctx.maxReruns) {
    ctx.logger.warn({ maxReruns: ctx.maxReruns }, `${agentConfig.name} hit max reruns limit`);
  }

  await drainQueues(ctx);
}
