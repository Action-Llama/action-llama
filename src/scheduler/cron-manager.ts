import { Cron } from "croner";
import type { AgentConfig } from "../shared/config.js";
import type { RunnerPool } from "./runner-pool.js";
import type { SchedulerContext } from "./webhook-setup.js";

export class CronManager {
  private cronJobs: Cron[] = [];
  private agentCronJobs = new Map<string, Cron>();

  setupCronJobs(
    agentConfigs: AgentConfig[],
    runnerPools: Record<string, RunnerPool>,
    ctx: SchedulerContext,
    runWithReruns: (runner: any, agentConfig: AgentConfig, depth: number, ctx: SchedulerContext) => Promise<void>,
    statusTracker?: any // StatusTracker
  ): Cron[] {
    const activeAgentConfigs = agentConfigs.filter((a) => (a.scale ?? 1) > 0);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    for (const agentConfig of activeAgentConfigs) {
      if (!agentConfig.schedule) continue;

      const pool = runnerPools[agentConfig.name];

      const job = new Cron(agentConfig.schedule, { timezone }, async () => {
        // Skip if agent is disabled
        if (statusTracker && !statusTracker.isAgentEnabled(agentConfig.name)) {
          ctx.logger.info({ agent: agentConfig.name }, "agent is disabled, skipping scheduled run");
          return;
        }

        const availableRunner = pool.getAvailableRunner();
        if (!availableRunner) {
          ctx.logger.warn({ agent: agentConfig.name, running: pool.runningJobCount, scale: pool.size }, "all agent runners busy, skipping scheduled run");
          return;
        }
        ctx.logger.info({ agent: agentConfig.name, running: pool.runningJobCount, scale: pool.size }, "triggering scheduled run");
        await runWithReruns(availableRunner, agentConfig, 0, ctx);
      });

      this.cronJobs.push(job);
      this.agentCronJobs.set(agentConfig.name, job);
      const nextRun = job.nextRun();
      if (nextRun) {
        statusTracker?.setNextRunAt(agentConfig.name, nextRun);
      }
      ctx.logger.info(`Scheduled ${agentConfig.name}: "${agentConfig.schedule}" (${timezone})`);
    }

    return this.cronJobs;
  }

  linkToStatusTracker(agentConfigs: AgentConfig[], statusTracker: any): void {
    if (!statusTracker) return;

    statusTracker.on("agent-enabled", (agentName: string) => {
      const job = this.agentCronJobs.get(agentName);
      if (job) {
        job.resume();
        const nextRun = job.nextRun();
        if (nextRun) {
          statusTracker.setNextRunAt(agentName, nextRun);
        }
        // Using ctx.logger would require passing it, so we'll log through status tracker
        statusTracker.addLogLine?.(agentName, "agent enabled, cron job resumed");
      }
    });

    statusTracker.on("agent-disabled", (agentName: string) => {
      const job = this.agentCronJobs.get(agentName);
      if (job) {
        job.pause();
        statusTracker.setNextRunAt(agentName, null);
        statusTracker.addLogLine?.(agentName, "agent disabled, cron job paused");
      }
    });
  }

  stopAll(): void {
    for (const job of this.cronJobs) {
      job.stop();
    }
    this.cronJobs = [];
    this.agentCronJobs.clear();
  }

  getCronJobs(): Cron[] {
    return [...this.cronJobs];
  }

  getJobForAgent(agentName: string): Cron | undefined {
    return this.agentCronJobs.get(agentName);
  }
}