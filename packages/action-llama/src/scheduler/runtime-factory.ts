/**
 * Container runtime factory.
 *
 * Creates a ContainerRuntime using the extension system and builds agent images.
 */

import type { GlobalConfig, AgentConfig } from "../shared/config.js";
import type { ContainerRuntime } from "../docker/runtime.js";
import type { StatusTracker } from "../tui/status-tracker.js";
import type { Logger } from "../shared/logger.js";
import { AgentError } from "../shared/errors.js";
import { buildAllImages } from "./image-builder.js";
import type { PromptSkills } from "../agents/prompt.js";
import { globalRegistry } from "../extensions/registry.js";

export interface RuntimeResult {
  runtime: ContainerRuntime;
  agentRuntimeOverrides: Record<string, ContainerRuntime>;
}

export async function createContainerRuntime(
  globalConfig: GlobalConfig,
  activeAgentConfigs: AgentConfig[],
  logger: Logger,
): Promise<RuntimeResult> {
  // Determine runtime type from configuration
  const runtimeType = globalConfig.runtime?.type || "local";
  
  // Get the runtime extension from registry
  const runtimeExtension = globalRegistry.getRuntimeExtension(runtimeType);
  if (!runtimeExtension) {
    throw new AgentError(
      `Unknown runtime type: ${runtimeType}. Available runtimes: ${globalRegistry.getAllRuntimeExtensions().map(r => r.metadata.name).join(", ")}`
    );
  }

  const runtime = runtimeExtension.provider;

  // For local Docker runtime, ensure Docker is running
  if (runtimeType === "local") {
    const { execFileSync } = await import("child_process");
    try {
      execFileSync("docker", ["info"], { stdio: "pipe", timeout: 10000 });
    } catch {
      throw new AgentError(
        "Docker is not running. Start Docker Desktop (or the Docker daemon) and try again."
      );
    }

    // Ensure Docker network
    logger.info("Ensuring Docker network...");
    const { ensureNetwork } = await import("../docker/network.js");
    ensureNetwork();
  }

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
