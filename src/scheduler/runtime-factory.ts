/**
 * Container runtime factory.
 *
 * Creates the appropriate ContainerRuntime (local Docker, Cloud Run, ECS/Lambda)
 * based on the project's global config and cloud mode flag.
 */

import type { GlobalConfig, AgentConfig } from "../shared/config.js";
import type { ContainerRuntime } from "../docker/runtime.js";
import type { StatusTracker } from "../tui/status-tracker.js";
import type { Logger } from "../shared/logger.js";
import { ConfigError, AgentError } from "../shared/errors.js";
import { AWS_CONSTANTS } from "../shared/aws-constants.js";
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
  const runtimeType = useCloudRuntime ? globalConfig.cloud!.provider : "local";
  let runtime: ContainerRuntime;
  const agentRuntimeOverrides: Record<string, ContainerRuntime> = {};

  if (useCloudRuntime && globalConfig.cloud!.provider === "cloud-run") {
    const { CloudRunJobRuntime } = await import("../docker/cloud-run-runtime.js");
    const { gcpProject, region, artifactRegistry, serviceAccount, secretPrefix } = globalConfig.cloud!;
    if (!gcpProject || !region || !artifactRegistry || !serviceAccount) {
      throw new ConfigError(
        "Cloud Run runtime requires cloud.gcpProject, cloud.region, " +
        "cloud.artifactRegistry, and cloud.serviceAccount in config.toml"
      );
    }
    runtime = new CloudRunJobRuntime({ gcpProject, region, artifactRegistry, serviceAccount, secretPrefix });
    logger.info({ gcpProject, region }, "Using Cloud Run Jobs runtime");
  } else if (useCloudRuntime && globalConfig.cloud!.provider === "ecs") {
    const { ECSFargateRuntime } = await import("../docker/ecs-runtime.js");
    const cc = globalConfig.cloud!;
    if (!cc.awsRegion || !cc.ecsCluster || !cc.ecrRepository || !cc.executionRoleArn || !cc.taskRoleArn || !cc.subnets?.length) {
      throw new ConfigError(
        "ECS runtime requires cloud.awsRegion, cloud.ecsCluster, cloud.ecrRepository, " +
        "cloud.executionRoleArn, cloud.taskRoleArn, and cloud.subnets in config.toml"
      );
    }
    runtime = new ECSFargateRuntime({
      awsRegion: cc.awsRegion,
      ecsCluster: cc.ecsCluster,
      ecrRepository: cc.ecrRepository,
      executionRoleArn: cc.executionRoleArn,
      taskRoleArn: cc.taskRoleArn,
      subnets: cc.subnets,
      securityGroups: cc.securityGroups,
      secretPrefix: cc.awsSecretPrefix,
      buildBucket: cc.buildBucket,
    });

    // Create Lambda runtime for short-running agents (timeout <= 900s)
    const { LambdaRuntime } = await import("../docker/lambda-runtime.js");
    const lambdaRuntime = new LambdaRuntime({
      awsRegion: cc.awsRegion,
      ecrRepository: cc.ecrRepository,
      secretPrefix: cc.awsSecretPrefix,
      buildBucket: cc.buildBucket,
      lambdaRoleArn: cc.lambdaRoleArn,
      lambdaSubnets: cc.lambdaSubnets,
      lambdaSecurityGroups: cc.lambdaSecurityGroups,
    });

    for (const ac of activeAgentConfigs) {
      const effectiveTimeout = ac.timeout ?? globalConfig.local?.timeout ?? 900;
      if (effectiveTimeout <= AWS_CONSTANTS.LAMBDA_MAX_TIMEOUT) {
        agentRuntimeOverrides[ac.name] = lambdaRuntime;
        logger.info({ agent: ac.name, timeout: effectiveTimeout }, "Routing to Lambda (timeout <= 900s)");
      }
    }

    logger.info({ region: cc.awsRegion, cluster: cc.ecsCluster }, "Using ECS Fargate runtime");
  } else {
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
    runtime = new LocalDockerRuntime();

    // Local-only: ensure Docker network
    logger.info("Ensuring Docker network...");
    const { ensureNetwork } = await import("../docker/network.js");
    ensureNetwork();
  }

  return { runtime: runtime!, agentRuntimeOverrides, runtimeType };
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
