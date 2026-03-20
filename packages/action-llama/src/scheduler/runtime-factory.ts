/**
 * Container runtime factory.
 *
 * Creates a local Docker ContainerRuntime and builds agent images.
 */

import type { GlobalConfig, AgentConfig } from "../shared/config.js";
import type { ContainerRuntime } from "../docker/runtime.js";
import type { StatusTracker } from "../tui/status-tracker.js";
import type { Logger } from "../shared/logger.js";
import { AgentError } from "../shared/errors.js";
import { buildAllImages } from "./image-builder.js";
import type { PromptSkills } from "../agents/prompt.js";

export interface RuntimeResult {
  runtime: ContainerRuntime;
  agentRuntimeOverrides: Record<string, ContainerRuntime>;
}

export async function createContainerRuntime(
  globalConfig: GlobalConfig,
  activeAgentConfigs: AgentConfig[],
  logger: Logger,
): Promise<RuntimeResult> {
  // Local runtime needs Docker running
  const { execFileSync } = await import("child_process");
  try {
    execFileSync("docker", ["info"], { stdio: "pipe", timeout: 10000 });
  } catch {
    throw new AgentError(
      "Docker is not running. Start Docker Desktop (or the Docker daemon) and try again."
    );
  }

  const { LocalDockerRuntime } = await import("../docker/local-runtime.js");
  const runtime = new LocalDockerRuntime();

  // Ensure Docker network
  logger.info("Ensuring Docker network...");
  const { ensureNetwork } = await import("../docker/network.js");
  ensureNetwork();

  return { runtime, agentRuntimeOverrides: {} };
}

export async function buildAgentImages(opts: {
  projectPath: string;
  globalConfig: GlobalConfig;
  activeAgentConfigs: AgentConfig[];
  runtime: ContainerRuntime;
  statusTracker?: StatusTracker;
  logger: Logger;
  skills: PromptSkills;
}): Promise<{ baseImage: string; agentImages: Record<string, string> }> {
  const buildResult = await buildAllImages({
    projectPath: opts.projectPath,
    globalConfig: opts.globalConfig,
    activeAgentConfigs: opts.activeAgentConfigs,
    runtime: opts.runtime,
    statusTracker: opts.statusTracker,
    logger: opts.logger,
    skills: opts.skills,
  });

  return { baseImage: buildResult.baseImage, agentImages: buildResult.agentImages };
}
