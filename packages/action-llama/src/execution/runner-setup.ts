/**
 * Runner pool creation with project-wide scale enforcement.
 *
 * Creates TransportAgentRunner instances that run Pi sessions in-process
 * and execute commands on runtimes via the transport layer.
 */

import type { GlobalConfig, AgentConfig } from "../shared/config.js";
import type { StatusTracker } from "../tui/status-tracker.js";
import type { Logger } from "../shared/logger.js";
import { createLogger, createFileOnlyLogger } from "../shared/logger.js";
import { RunnerPool, type PoolRunner } from "./runner-pool.js";
import { enforceProjectScaleCap } from "../scheduler/policies/index.js";
import { TransportAgentRunner, type TransportAgentRunnerOpts } from "../agents/transport-runner.js";
import { ModelCircuitBreaker } from "../agents/model-fallback.js";
import type { SchedulerToolsOpts } from "../agents/scheduler-tools.js";
import type { WaitingRegistry } from "./waiting-registry.js";
import type { PromptSkills } from "../agents/prompt.js";

export interface RunnerSetupResult {
  runnerPools: Record<string, RunnerPool>;
  createRunner: (agentConfig: AgentConfig) => PoolRunner;
  /** Actual pool sizes after project-wide scale cap is applied. */
  actualScales: Record<string, number>;
}

export interface RunnerSetupOpts {
  globalConfig: GlobalConfig;
  agentConfigs: AgentConfig[];
  baseImage: string;
  statusTracker?: StatusTracker;
  mkLogger: typeof createLogger | typeof createFileOnlyLogger;
  projectPath: string;
  logger: Logger;
  /** Scheduler tools dependencies for lock/call/status tools. */
  schedulerToolsDeps?: Omit<SchedulerToolsOpts, "agentName" | "instanceId" | "depth" | "onReturnValue">;
  /** Waiting registry for wait/resume support. */
  waitingRegistry?: WaitingRegistry;
  /** Prompt skills to include in the system prompt (locking, subagents, etc.). */
  skills?: PromptSkills;
}

export async function createRunnerPools(opts: RunnerSetupOpts): Promise<RunnerSetupResult> {
  const {
    globalConfig, agentConfigs,
    baseImage, statusTracker, mkLogger, projectPath, logger,
    schedulerToolsDeps, waitingRegistry, skills,
  } = opts;

  const circuitBreaker = new ModelCircuitBreaker();

  const createRunner = (agentConfig: AgentConfig): PoolRunner => {
    return new TransportAgentRunner({
      globalConfig,
      agentConfig,
      logger: mkLogger(projectPath, agentConfig.name),
      circuitBreaker,
      statusTracker,
      baseImage,
      projectPath,
      schedulerToolsDeps,
      waitingRegistry,
      skills,
    });
  };

  // Enforce project-wide scale limit via policy module
  const defaultScale = globalConfig.defaultAgentScale ?? 1;
  const adjustedConfigs = enforceProjectScaleCap(agentConfigs, globalConfig, logger);

  const runnerPools: Record<string, RunnerPool> = {};
  const actualScales: Record<string, number> = {};

  for (const agentConfig of adjustedConfigs) {
    const scale = agentConfig.scale ?? defaultScale;
    const runners: PoolRunner[] = [];

    for (let i = 0; i < scale; i++) {
      runners.push(createRunner(agentConfig));
    }

    runnerPools[agentConfig.name] = new RunnerPool(runners);
    actualScales[agentConfig.name] = scale;
    logger.info({ agent: agentConfig.name, scale }, "Created runner pool");
  }

  return { runnerPools, createRunner, actualScales };
}
