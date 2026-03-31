// packages/action-llama/src/scheduler/orphan-recovery.ts

import type { AgentConfig } from "../shared/config.js";
import type { Logger } from "../shared/logger.js";
import type { Runtime } from "../docker/runtime.js";
import type { RunnerPool } from "../execution/runner-pool.js";
import type { GatewayServer } from "../gateway/index.js";
import type { SchedulerContext } from "../execution/execution.js";
import { drainQueues } from "../execution/execution.js";

export interface OrphanRecoveryOpts {
  runtime: Runtime;
  gateway: GatewayServer;
  runnerPools: Record<string, RunnerPool>;
  activeAgentConfigs: AgentConfig[];
  schedulerState: { schedulerCtx: SchedulerContext | null };
  logger: Logger;
}

/**
 * Re-adopt orphan containers from a previous scheduler run, or clean up
 * stale container registry entries.
 *
 * This is a scheduler-startup concern that orchestrates across the execution
 * plane (runtime, runner pools) and the gateway (container registry, lock store).
 */
export async function recoverOrphanContainers(opts: OrphanRecoveryOpts): Promise<void> {
  const { runtime, gateway, runnerPools, activeAgentConfigs, schedulerState, logger } = opts;

  try {
    const ownAgentNames = new Set(activeAgentConfigs.map((a) => a.name));
    const orphans = (await runtime.listRunningAgents()).filter((o) => ownAgentNames.has(o.agentName));

    if (orphans.length > 0) {
      const registeredContainers = gateway.containerRegistry.listAll();
      const runningNames = new Set(orphans.map((o) => o.taskId));
      let adopted = 0;
      let killed = 0;

      for (const orphan of orphans) {
        const found = gateway.containerRegistry.findByContainerName(orphan.taskId);

        if (!found) {
          // Container exists but has no registry entry — unknown, kill it
          logger.warn({ agent: orphan.agentName, task: orphan.taskId }, "killing unregistered orphan container");
          try { await runtime.kill(orphan.taskId); await runtime.remove(orphan.taskId); } catch {}
          killed++;
          continue;
        }

        const { secret: oldSecret, reg } = found;
        const pool = runnerPools[orphan.agentName];
        if (!pool) {
          logger.warn({ agent: orphan.agentName, task: orphan.taskId }, "no runner pool for orphan, killing");
          try { await runtime.kill(orphan.taskId); await runtime.remove(orphan.taskId); } catch {}
          gateway.lockStore.releaseAll(reg.instanceId);
          await gateway.containerRegistry.unregister(oldSecret);
          killed++;
          continue;
        }

        // Get shutdown secret from container env vars
        let shutdownSecret: string | undefined;
        if (runtime.inspectContainer) {
          const info = await runtime.inspectContainer(orphan.taskId);
          shutdownSecret = info?.env?.SHUTDOWN_SECRET;
        }

        if (!shutdownSecret) {
          logger.warn({ agent: orphan.agentName, task: orphan.taskId }, "cannot read SHUTDOWN_SECRET from orphan, killing");
          try { await runtime.kill(orphan.taskId); await runtime.remove(orphan.taskId); } catch {}
          gateway.lockStore.releaseAll(reg.instanceId);
          await gateway.containerRegistry.unregister(oldSecret);
          killed++;
          continue;
        }

        const runner = pool.getAvailableRunner();
        if (!runner) {
          logger.warn({ agent: orphan.agentName, task: orphan.taskId }, "no available runner for orphan, killing");
          try { await runtime.kill(orphan.taskId); await runtime.remove(orphan.taskId); } catch {}
          gateway.lockStore.releaseAll(reg.instanceId);
          await gateway.containerRegistry.unregister(oldSecret);
          killed++;
          continue;
        }

        // Re-attach to the orphaned process so streamLogs/waitForExit work normally
        const reattach = (runtime as any).reattach;
        if (typeof reattach === "function" && !reattach.call(runtime, orphan.taskId)) {
          logger.warn({ agent: orphan.agentName, task: orphan.taskId }, "failed to reattach orphan, killing");
          try { await runtime.kill(orphan.taskId); await runtime.remove(orphan.taskId); } catch {}
          gateway.lockStore.releaseAll(reg.instanceId);
          await gateway.containerRegistry.unregister(oldSecret);
          killed++;
          continue;
        }

        // Unregister old secret mapping — will be re-registered inside adoptContainer
        await gateway.containerRegistry.unregister(oldSecret);

        logger.info({ agent: orphan.agentName, task: orphan.taskId, instance: reg.instanceId }, "re-adopting orphan container");

        const containerRunner = runner as any;
        if (typeof containerRunner.adoptContainer === "function") {
          containerRunner
            .adoptContainer(orphan.taskId, shutdownSecret, reg.instanceId, { type: "schedule" as const, source: "re-adopted" })
            .then(() => { if (schedulerState.schedulerCtx) drainQueues(schedulerState.schedulerCtx); })
            .catch((err: any) => logger.error({ err, agent: orphan.agentName }, "orphan re-adoption failed"));
          adopted++;
        } else {
          logger.warn({ agent: orphan.agentName }, "runner does not support adoption, killing orphan");
          try { await runtime.kill(orphan.taskId); await runtime.remove(orphan.taskId); } catch {}
          killed++;
        }
      }

      // Clean up registry entries for containers that exited while scheduler was down
      for (const reg of registeredContainers) {
        if (!runningNames.has(reg.containerName)) {
          const found = gateway.containerRegistry.findByContainerName(reg.containerName);
          if (found) {
            gateway.lockStore.releaseAll(reg.instanceId);
            await gateway.containerRegistry.unregister(found.secret);
            logger.info({ agent: reg.agentName, instance: reg.instanceId }, "cleaned up stale registration (container exited while scheduler was down)");
          }
        }
      }

      logger.info({ adopted, killed, total: orphans.length }, "orphan container handling complete");
    } else {
      // No running containers — clean up all stale registry entries
      const staleEntries = gateway.containerRegistry.listAll();
      if (staleEntries.length > 0) {
        let releasedLocks = 0;
        for (const entry of staleEntries) {
          releasedLocks += gateway.lockStore.releaseAll(entry.instanceId);
        }
        await gateway.containerRegistry.clear();
        logger.info(
          { releasedLocks, staleRegistrations: staleEntries.length },
          "cleaned up stale registrations (no running containers)",
        );
      }
    }
  } catch (err) {
    logger.debug({ err }, "orphan detection/re-adoption skipped (runtime does not support listing)");
  }
}
