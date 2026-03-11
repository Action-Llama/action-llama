import type { AgentConfig } from "../shared/config.js";
import type { RunnerPool, PoolRunner } from "./runner-pool.js";
import type { SchedulerContext } from "./webhook-setup.js";

export interface TriggerRequest {
  agent: string;
  context: string;
}

export class TriggerDispatcher {
  constructor() {}

  dispatchTriggers(
    triggers: TriggerRequest[],
    sourceAgent: string,
    depth: number,
    ctx: SchedulerContext,
    makeTriggeredPrompt: (agentConfig: AgentConfig, sourceAgent: string, context: string, ctx: SchedulerContext) => string
  ): void {
    for (const { agent, context } of triggers) {
      if (agent === sourceAgent) {
        ctx.logger.warn({ source: sourceAgent }, "agent cannot trigger itself, skipping");
        continue;
      }
      if (depth >= ctx.maxTriggerDepth) {
        ctx.logger.warn({ source: sourceAgent, target: agent, depth, maxTriggerDepth: ctx.maxTriggerDepth }, "trigger depth limit reached, skipping");
        continue;
      }
      const targetConfig = ctx.agentConfigs.find((a) => a.name === agent);
      if (!targetConfig) {
        ctx.logger.warn({ source: sourceAgent, target: agent }, "trigger target agent not found, skipping");
        continue;
      }
      const pool = ctx.runnerPools[agent];
      if (pool.size === 0) {
        ctx.logger.info({ source: sourceAgent, target: agent }, "agent is disabled (scale=0), skipping trigger");
        continue;
      }
      const availableRunner = pool.getAvailableRunner();
      if (!availableRunner) {
        ctx.logger.warn({ source: sourceAgent, target: agent, running: pool.runningJobCount, scale: pool.size }, "all agent runners busy, skipping trigger");
        continue;
      }
      ctx.logger.info({ source: sourceAgent, target: agent, depth, running: pool.runningJobCount, scale: pool.size }, "agent trigger firing");
      const prompt = makeTriggeredPrompt(targetConfig, sourceAgent, context, ctx);
      this.runTriggered(availableRunner, targetConfig, prompt, sourceAgent, depth + 1, ctx).catch((err) => {
        ctx.logger.error({ err, target: agent }, "triggered run failed");
      });
    }
  }

  private async runTriggered(
    runner: PoolRunner,
    agentConfig: AgentConfig,
    prompt: string,
    sourceAgent: string,
    depth: number,
    ctx: SchedulerContext
  ): Promise<void> {
    const { result, triggers } = await runner.run(prompt, { type: 'agent', source: sourceAgent });
    if (triggers.length > 0) {
      // This creates a circular dependency, so we'll need to pass the dispatch function
      // For now, we'll handle this in the main scheduler
      ctx.logger.info({ agent: agentConfig.name, triggerCount: triggers.length }, "triggered run generated new triggers");
    }
    // No reruns for triggered runs — they respond to a specific event
    if (result === "completed") {
      ctx.logger.info(`${agentConfig.name} triggered run completed`);
    }
  }

  // Helper method that can be called from scheduler to handle nested triggers
  async runTriggeredWithDispatch(
    runner: PoolRunner,
    agentConfig: AgentConfig,
    prompt: string,
    sourceAgent: string,
    depth: number,
    ctx: SchedulerContext,
    makeTriggeredPrompt: (agentConfig: AgentConfig, sourceAgent: string, context: string, ctx: SchedulerContext) => string
  ): Promise<void> {
    const { result, triggers } = await runner.run(prompt, { type: 'agent', source: sourceAgent });
    if (triggers.length > 0) {
      this.dispatchTriggers(triggers, agentConfig.name, depth, ctx, makeTriggeredPrompt);
    }
    // No reruns for triggered runs — they respond to a specific event
    if (result === "completed") {
      ctx.logger.info(`${agentConfig.name} triggered run completed`);
    }
  }
}