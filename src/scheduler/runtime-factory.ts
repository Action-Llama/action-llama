/**
 * Container runtime factory.
 *
 * Creates the appropriate ContainerRuntime (local Docker, Cloud Run, ECS/Lambda)
 * based on the project's global config and cloud mode flag.
 *
 * Cloud runtime creation is delegated to the CloudProvider interface.
 */

import type { GlobalConfig, AgentConfig } from "../shared/config.js";
import type { ContainerRuntime } from "../docker/runtime.js";
import type { StatusTracker } from "../tui/status-tracker.js";
import type { Logger } from "../shared/logger.js";
import { AgentError } from "../shared/errors.js";
import { buildAllImages } from "../cloud/image-builder.js";
import type { PromptSkills } from "../agents/prompt.js";

export interface RuntimeResult {
  runtime: ContainerRuntime;
  agentRuntimeOverrides: Record<string, ContainerRuntime>;
  runtimeType: string;
}

export async function createContainerRuntime(
  globalConfig: GlobalConfig,
  activeAgentConfigs: AgentConfig[],
  cloudMode: boolean | undefined,
  logger: Logger,
): Promise<RuntimeResult> {
  const useCloudRuntime = cloudMode && globalConfig.cloud;

  if (useCloudRuntime) {
    const { createCloudProvider } = await import("../cloud/provider.js");
    const provider = await createCloudProvider(globalConfig.cloud!);
    const { runtime, agentRuntimeOverrides } = provider.createRuntimes(
      activeAgentConfigs,
      globalConfig,
    );

    const runtimeType = provider.providerName;

    if (runtimeType === "cloud-run") {
      const cc = globalConfig.cloud!;
      if (cc.provider === "cloud-run") {
        logger.info({ gcpProject: cc.gcpProject, region: cc.region }, "Using Cloud Run Jobs runtime");
      }
    } else if (runtimeType === "ecs") {
      const cc = globalConfig.cloud!;
      if (cc.provider === "ecs") {
        for (const [agentName] of Object.entries(agentRuntimeOverrides)) {
          logger.info({ agent: agentName }, "Routing to Lambda (timeout <= 900s)");
        }
        logger.info({ region: cc.awsRegion, cluster: cc.ecsCluster }, "Using ECS Fargate runtime");
      }
    }

    return { runtime, agentRuntimeOverrides, runtimeType };
  }

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

  // Local-only: ensure Docker network
  logger.info("Ensuring Docker network...");
  const { ensureNetwork } = await import("../docker/network.js");
  ensureNetwork();

  return { runtime, agentRuntimeOverrides: {}, runtimeType: "local" };
}

export async function buildAgentImages(opts: {
  projectPath: string;
  globalConfig: GlobalConfig;
  activeAgentConfigs: AgentConfig[];
  runtime: ContainerRuntime;
  runtimeType: string;
  statusTracker?: StatusTracker;
  logger: Logger;
  skills: PromptSkills;
}): Promise<{ baseImage: string; agentImages: Record<string, string> }> {
  const buildResult = await buildAllImages({
    projectPath: opts.projectPath,
    globalConfig: opts.globalConfig,
    activeAgentConfigs: opts.activeAgentConfigs,
    runtime: opts.runtime,
    runtimeType: opts.runtimeType,
    statusTracker: opts.statusTracker,
    logger: opts.logger,
    skills: opts.skills,
  });

  return { baseImage: buildResult.baseImage, agentImages: buildResult.agentImages };
}
