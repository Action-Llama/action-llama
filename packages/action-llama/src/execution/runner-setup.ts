/**
 * Runner pool creation with project-wide scale enforcement.
 *
 * Also exports the `createRunner` factory shared between initial setup and
 * hot-reload (watcher.ts).
 */

import type { GlobalConfig, AgentConfig } from "../shared/config.js";
import type { Runtime } from "../docker/runtime.js";
import type { StatusTracker } from "../tui/status-tracker.js";
import type { ContainerRegistration } from "./types.js";
import type { Logger } from "../shared/logger.js";
import { createLogger, createFileOnlyLogger } from "../shared/logger.js";
import { RunnerPool, type PoolRunner } from "./runner-pool.js";
import { enforceProjectScaleCap } from "../scheduler/policies/index.js";

export interface RunnerSetupResult {
  runnerPools: Record<string, RunnerPool>;
  createRunner: (agentConfig: AgentConfig, image: string) => PoolRunner;
  /** Actual pool sizes after project-wide scale cap is applied. */
  actualScales: Record<string, number>;
}

export interface RunnerSetupOpts {
  globalConfig: GlobalConfig;
  agentConfigs: AgentConfig[];
  runtime: Runtime;
  agentRuntimeOverrides: Record<string, Runtime>;
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
    // Host-user agents run directly on the host — use localhost instead of
    // the Docker-internal "gateway" hostname which requires --add-host DNS.
    const effectiveGatewayUrl = agentRuntimeOverrides[agentConfig.name]
      ? (process.env.GATEWAY_URL || `http://localhost:${gatewayPort}`)
      : gatewayUrl;
    return new ContainerAgentRunnerClass(
      agentRuntime,
      globalConfig,
      agentConfig,
      mkLogger(projectPath, agentConfig.name),
      registerContainer,
      unregisterContainer,
      effectiveGatewayUrl,
      projectPath,
      image,
      statusTracker,
    );
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
      runners.push(createRunner(agentConfig, agentImages[agentConfig.name] || baseImage));
    }

    runnerPools[agentConfig.name] = new RunnerPool(runners);
    actualScales[agentConfig.name] = scale;
    logger.info({ agent: agentConfig.name, scale }, "Created runner pool");
  }

  return { runnerPools, createRunner, actualScales };
}
