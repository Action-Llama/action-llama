import {
  buildScheduledPrompt, buildWebhookPrompt, buildCalledPrompt,
  buildScheduledSuffix, buildWebhookSuffix, buildCalledSuffix,
  type PromptSkills,
} from "../agents/prompt.js";
import type { WorkQueue, QueuedWorkItem } from "./event-queue.js";
import { RunnerPool, type PoolRunner } from "./runner-pool.js";
import type { AgentConfig } from "../shared/config.js";
import type { WebhookContext } from "../webhooks/types.js";
import type { createLogger } from "../shared/logger.js";
import type { SchedulerEventBus } from "./events.js";
import type { CallStore } from "../gateway/call-store.js";
import type { StatusTracker } from "../tui/status-tracker.js";

export const DEFAULT_MAX_RERUNS = 10;
export const DEFAULT_MAX_TRIGGER_DEPTH = 3;

export type WorkItem =
  | { type: 'webhook'; context: WebhookContext }
  | { type: 'agent-trigger'; sourceAgent: string; context: string; depth: number; callId?: string }
  | { type: 'schedule' };

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
}

// Prompt helpers: when images have baked-in static files, only pass the dynamic suffix.
// Otherwise, pass the full prompt (for non-Docker or legacy images).
export function makeScheduledPrompt(agentConfig: AgentConfig, ctx: SchedulerContext): string {
  return ctx.useBakedImages ? buildScheduledSuffix() : buildScheduledPrompt(agentConfig, ctx.skills);
}

export function makeWebhookPrompt(agentConfig: AgentConfig, context: WebhookContext, ctx: SchedulerContext): string {
  return ctx.useBakedImages ? buildWebhookSuffix(context) : buildWebhookPrompt(agentConfig, context, ctx.skills);
}

export function makeTriggeredPrompt(agentConfig: AgentConfig, sourceAgent: string, context: string, ctx: SchedulerContext): string {
  return ctx.useBakedImages ? buildCalledSuffix(sourceAgent, context) : buildCalledPrompt(agentConfig, sourceAgent, context, ctx.skills);
}

/** Run a single agent and dispatch any resulting triggers. */
export async function executeRun(
  runner: PoolRunner, prompt: string,
  triggerInfo: { type: 'schedule' | 'webhook' | 'agent'; source?: string },
  agentName: string, depth: number, ctx: SchedulerContext
): Promise<{ result: string; triggers: Array<{ agent: string; context: string }>; returnValue?: string }> {
  ctx.events?.emit("run:start", {
    agentName,
    instanceId: runner.instanceId,
    trigger: triggerInfo.source ? `${triggerInfo.type}:${triggerInfo.source}` : triggerInfo.type,
  });

  const outcome = await runner.run(prompt, triggerInfo);
  const triggers = outcome.triggers ?? [];
  if (triggers.length > 0) dispatchTriggers(triggers, agentName, depth, ctx);

  ctx.events?.emit("run:end", {
    agentName,
    instanceId: runner.instanceId,
    result: outcome.result,
    exitCode: outcome.exitCode,
    error: outcome.exitReason,
  });

  ctx.onRunComplete?.({ agentName, result: outcome.result, triggerType: triggerInfo.type });
  return { result: outcome.result, triggers, returnValue: outcome.returnValue };
}

export function dispatchTriggers(
  triggers: Array<{ agent: string; context: string }>,
  sourceAgent: string, depth: number, ctx: SchedulerContext
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
    if (pool.size === 0) {
      ctx.logger.info({ source: sourceAgent, target: agent }, "target disabled (scale=0), skipping");
      continue;
    }
    if (ctx.isAgentEnabled && !ctx.isAgentEnabled(agent)) {
      ctx.workQueue.enqueue(agent, { type: 'agent-trigger', sourceAgent, context, depth });
      ctx.logger.info({ source: sourceAgent, target: agent }, "target agent is paused, trigger queued");
      continue;
    }
    const runner = pool.getAvailableRunner();
    if (!runner) {
      ctx.workQueue.enqueue(agent, { type: 'agent-trigger', sourceAgent, context, depth });
      ctx.logger.info({ source: sourceAgent, target: agent }, "all runners busy, trigger queued");
      continue;
    }
    ctx.logger.info({ source: sourceAgent, target: agent, depth }, "agent trigger firing");
    const prompt = makeTriggeredPrompt(targetConfig, sourceAgent, context, ctx);
    executeRun(runner, prompt, { type: 'agent', source: sourceAgent }, agent, depth + 1, ctx)
      .then(() => drainQueues(ctx))
      .catch((err) => ctx.logger.error({ err, target: agent }, "triggered run failed"));
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
    const prompt = makeWebhookPrompt(agentConfig, work.context, ctx);
    executeRun(runner, prompt, { type: 'webhook', source: work.context.event }, agentConfig.name, 0, ctx)
      .then(() => drainQueues(ctx))
      .catch((err) => ctx.logger.error({ err, agent: agentConfig.name }, "queued webhook failed"));

  } else if (work.type === 'agent-trigger') {
    if (work.depth >= ctx.maxTriggerDepth) return;
    ctx.logger.info({ source: work.sourceAgent, target: agentConfig.name, depth: work.depth, ageMs }, "draining queued trigger");
    const prompt = makeTriggeredPrompt(agentConfig, work.sourceAgent, work.context, ctx);
    if (work.callId) ctx.callStore?.setRunning(work.callId);
    executeRun(runner, prompt, { type: 'agent', source: work.sourceAgent }, agentConfig.name, work.depth + 1, ctx)
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
    // runWithReruns already calls drainQueues on completion
    runWithReruns(runner, agentConfig, 0, ctx)
      .catch((err) => ctx.logger.error({ err, agent: agentConfig.name }, "queued scheduled run failed"));
  }
}

export async function runWithReruns(
  runner: PoolRunner, agentConfig: AgentConfig, depth: number, ctx: SchedulerContext
): Promise<void> {
  let { result } = await executeRun(
    runner, makeScheduledPrompt(agentConfig, ctx), { type: 'schedule' }, agentConfig.name, depth, ctx
  );

  let reruns = 0;
  while (result === "rerun" && reruns < ctx.maxReruns) {
    if (ctx.isAgentEnabled && !ctx.isAgentEnabled(agentConfig.name)) {
      ctx.logger.info({ agent: agentConfig.name }, "agent paused, stopping reruns");
      break;
    }
    reruns++;
    ctx.logger.info({ rerun: reruns, maxReruns: ctx.maxReruns }, `${agentConfig.name} requested rerun`);
    ({ result } = await executeRun(
      runner, makeScheduledPrompt(agentConfig, ctx),
      { type: 'schedule', source: `rerun ${reruns}/${ctx.maxReruns}` }, agentConfig.name, depth, ctx
    ));
  }

  if (result === "rerun" && reruns >= ctx.maxReruns) {
    ctx.logger.warn({ maxReruns: ctx.maxReruns }, `${agentConfig.name} hit max reruns limit`);
  }

  await drainQueues(ctx);
}
