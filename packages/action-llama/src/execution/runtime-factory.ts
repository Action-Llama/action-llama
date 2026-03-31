/**
 * Runtime factory.
 *
 * Creates a Runtime using the extension system and builds agent images.
 * Supports per-agent runtime overrides (e.g. host-user mode).
 */

import type { GlobalConfig, AgentConfig } from "../shared/config.js";
import type { Runtime } from "../docker/runtime.js";
import { isContainerRuntime } from "../docker/runtime.js";
import type { StatusTracker } from "../tui/status-tracker.js";
import type { Logger } from "../shared/logger.js";
import { AgentError } from "../shared/errors.js";
import { buildAllImages } from "./image-builder.js";
import type { PromptSkills } from "../agents/prompt.js";
import { globalRegistry } from "../extensions/registry.js";
import { HostUserRuntime } from "../docker/host-user-runtime.js";

export interface RuntimeResult {
  runtime: Runtime;
  agentRuntimeOverrides: Record<string, Runtime>;
}

/**
 * Create a per-agent Runtime override for agents with a [runtime] config section.
 * Returns undefined if no override is needed (e.g. default container runtime).
 * Extracted as a named function so it can be called during both startup and
 * hot-reload without requiring a dynamic import.
 */
export function createAgentRuntimeOverride(agentConfig: AgentConfig): Runtime | undefined {
  if (agentConfig.runtime?.type === "host-user") {
    const runAs = agentConfig.runtime.run_as ?? "al-agent";
    const groups = agentConfig.runtime.groups ?? [];
    return new HostUserRuntime(runAs, groups);
  }
  return undefined;
}

export async function createContainerRuntime(
  globalConfig: GlobalConfig,
  activeAgentConfigs: AgentConfig[],
  logger: Logger,
): Promise<RuntimeResult> {
  // Determine runtime type from configuration (default to local for now)
  const runtimeType = "local";

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

  // Build per-agent runtime overrides for agents with [runtime] config
  const agentRuntimeOverrides: Record<string, Runtime> = {};
  for (const agentConfig of activeAgentConfigs) {
    const override = createAgentRuntimeOverride(agentConfig);
    if (override) {
      agentRuntimeOverrides[agentConfig.name] = override;
      logger.info(
        { agent: agentConfig.name, runAs: agentConfig.runtime?.run_as ?? "al-agent", groups: agentConfig.runtime?.groups ?? [] },
        "using host-user runtime",
      );
    }
  }

  return { runtime, agentRuntimeOverrides };
}

export async function buildAgentImages(opts: {
  projectPath: string;
  globalConfig: GlobalConfig;
  activeAgentConfigs: AgentConfig[];
  runtime: Runtime;
  statusTracker?: StatusTracker;
  logger: Logger;
  skills: PromptSkills;
}): Promise<{ baseImage: string; agentImages: Record<string, string> }> {
  if (!isContainerRuntime(opts.runtime)) {
    throw new AgentError("Cannot build images: runtime does not support container operations");
  }

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
