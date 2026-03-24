/**
 * Runner pool creation with project-wide scale enforcement.
 *
 * Also exports the `createRunner` factory shared between initial setup and
 * hot-reload (watcher.ts).
 */

import type { GlobalConfig, AgentConfig } from "../shared/config.js";
import type { ContainerRuntime } from "../docker/runtime.js";
import type { StatusTracker } from "../tui/status-tracker.js";
import type { ContainerRegistration } from "./types.js";
import type { Logger } from "../shared/logger.js";
import { createLogger, createFileOnlyLogger } from "../shared/logger.js";
import { RunnerPool, type PoolRunner } from "./runner-pool.js";

export interface RunnerSetupResult {
  runnerPools: Record<string, RunnerPool>;
  createRunner: (agentConfig: AgentConfig, image: string) => PoolRunner;
}

export interface RunnerSetupOpts {
  globalConfig: GlobalConfig;
  agentConfigs: AgentConfig[];
  runtime: ContainerRuntime;
  agentRuntimeOverrides: Record<string, ContainerRuntime>;
  agentImages: Record<string, string>;
  baseImage: string;
  gatewayPort: number;
  registerContainer: (secret: string, reg: ContainerRegistration) => Promise<void>;
  unregisterContainer: (secret: string) => Promise<void>;
  statusTracker?: StatusTracker;
  mkLogger: typeof createLogger | typeof createFileOnlyLogger;
  projectPath: string;
  logger: Logger;
}

export async function createRunnerPools(opts: RunnerSetupOpts): Promise<RunnerSetupResult> {
  const {
    globalConfig, agentConfigs, runtime, agentRuntimeOverrides,
    agentImages, baseImage, gatewayPort, registerContainer, unregisterContainer,
    statusTracker, mkLogger, projectPath, logger,
  } = opts;

  const { ContainerAgentRunner: ContainerAgentRunnerClass } = await import("../agents/container-runner.js");
  const gatewayUrl = process.env.GATEWAY_URL || `http://gateway:${gatewayPort}`;

  const createRunner = (agentConfig: AgentConfig, image: string): PoolRunner => {
    const agentRuntime = agentRuntimeOverrides[agentConfig.name] || runtime;
    return new ContainerAgentRunnerClass(
      agentRuntime,
      globalConfig,
      agentConfig,
      mkLogger(projectPath, agentConfig.name),
      registerContainer,
      unregisterContainer,
      gatewayUrl,
      projectPath,
      image,
      statusTracker,
    );
  };

  // Enforce project-wide scale limit
  const defaultScale = globalConfig.defaultAgentScale ?? 1;
  let totalScale = 0;
  const adjustedConfigs = agentConfigs.map(config => ({ ...config }));

  // Warn if defaultAgentScale * agentCount exceeds project scale cap
  if (globalConfig.scale !== undefined && globalConfig.defaultAgentScale !== undefined) {
    const totalRequested = agentConfigs.reduce(
      (sum, c) => sum + (c.scale ?? defaultScale), 0
    );
    if (totalRequested > globalConfig.scale) {
      logger.warn({
        defaultAgentScale: globalConfig.defaultAgentScale,
        agentCount: agentConfigs.length,
        totalRequested,
        projectScale: globalConfig.scale,
      }, "Total requested agent scale (%d) exceeds project scale cap (%d) — agents will be throttled",
        totalRequested, globalConfig.scale);
    }
  }

  if (globalConfig.scale !== undefined) {
    for (let i = 0; i < adjustedConfigs.length; i++) {
      const config = adjustedConfigs[i];
      const requestedScale = config.scale ?? defaultScale;
      const remainingCapacity = globalConfig.scale - totalScale;

      if (remainingCapacity <= 0) {
        config.scale = 1; // Ensure at least 1 runner per agent
        if (requestedScale > 1) {
          logger.warn({
            agent: config.name,
            requested: requestedScale,
            reduced: 1,
            projectLimit: globalConfig.scale,
          }, "Agent scale reduced due to project scale limit");
        }
        totalScale += 1;
      } else if (requestedScale > remainingCapacity) {
        config.scale = remainingCapacity;
        logger.warn({
          agent: config.name,
          requested: requestedScale,
          reduced: remainingCapacity,
          projectLimit: globalConfig.scale,
        }, "Agent scale reduced due to project scale limit");
        totalScale += remainingCapacity;
      } else {
        totalScale += requestedScale;
      }
    }
  }

  const runnerPools: Record<string, RunnerPool> = {};

  for (const agentConfig of adjustedConfigs) {
    const scale = agentConfig.scale ?? defaultScale;
    const runners: PoolRunner[] = [];

    for (let i = 0; i < scale; i++) {
      runners.push(createRunner(agentConfig, agentImages[agentConfig.name] || baseImage));
    }

    runnerPools[agentConfig.name] = new RunnerPool(runners);
    logger.info({ agent: agentConfig.name, scale }, "Created runner pool");
  }

  return { runnerPools, createRunner };
}
