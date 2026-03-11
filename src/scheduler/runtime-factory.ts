import { execFileSync } from "child_process";
import type { GlobalConfig, AgentConfig } from "../shared/config.js";
import type { ContainerRuntime } from "../docker/runtime.js";
import { AWS_CONSTANTS } from "../shared/aws-constants.js";
import { buildAllImages } from "../cloud/image-builder.js";
import { ensureNetwork } from "../docker/network.js";
import type { Logger } from "../shared/logger.js";

export async function createRuntime(
  globalConfig: GlobalConfig,
  cloudMode: boolean,
  logger: Logger
): Promise<ContainerRuntime | undefined> {
  const useCloudRuntime = cloudMode && globalConfig.cloud;
  const runtimeType = useCloudRuntime ? globalConfig.cloud!.provider : "local";

  logger.info({ runtime: runtimeType }, "Docker mode enabled — initializing infrastructure");

  if (useCloudRuntime && globalConfig.cloud!.provider === "cloud-run") {
    const { CloudRunJobRuntime } = await import("../docker/cloud-run-runtime.js");
    const { gcpProject, region, artifactRegistry, serviceAccount, secretPrefix } = globalConfig.cloud!;
    if (!gcpProject || !region || !artifactRegistry || !serviceAccount) {
      throw new Error(
        "Cloud Run runtime requires cloud.gcpProject, cloud.region, " +
        "cloud.artifactRegistry, and cloud.serviceAccount in config.toml"
      );
    }
    const runtime = new CloudRunJobRuntime({ gcpProject, region, artifactRegistry, serviceAccount, secretPrefix });
    logger.info({ gcpProject, region }, "Using Cloud Run Jobs runtime");
    return runtime;
  } 
  
  if (useCloudRuntime && globalConfig.cloud!.provider === "ecs") {
    const { ECSFargateRuntime } = await import("../docker/ecs-runtime.js");
    const cc = globalConfig.cloud!;
    if (!cc.awsRegion || !cc.ecsCluster || !cc.ecrRepository || !cc.executionRoleArn || !cc.taskRoleArn || !cc.subnets?.length) {
      throw new Error(
        "ECS runtime requires cloud.awsRegion, cloud.ecsCluster, cloud.ecrRepository, " +
        "cloud.executionRoleArn, cloud.taskRoleArn, and cloud.subnets in config.toml"
      );
    }
    const runtime = new ECSFargateRuntime({
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
    logger.info({ region: cc.awsRegion, cluster: cc.ecsCluster }, "Using ECS Fargate runtime");
    return runtime;
  }
  
  // Local runtime needs Docker running
  try {
    execFileSync("docker", ["info"], { stdio: "pipe", timeout: 10000 });
  } catch {
    throw new Error(
      "Docker is not running. Start Docker Desktop (or the Docker daemon) and try again, " +
      "or use --no-docker to run without container isolation."
    );
  }

  const { LocalDockerRuntime } = await import("../docker/local-runtime.js");
  const runtime = new LocalDockerRuntime();

  // Local-only: ensure Docker network
  logger.info("Ensuring Docker network...");
  ensureNetwork();
  
  return runtime;
}

export async function buildAgentImages(
  runtime: ContainerRuntime,
  projectPath: string,
  globalConfig: GlobalConfig,
  activeAgentConfigs: AgentConfig[],
  cloudMode: boolean,
  statusTracker?: any, // StatusTracker
  logger?: Logger
): Promise<{baseImage: string, agentImages: Record<string, string>}> {
  const useCloudRuntime = cloudMode && globalConfig.cloud;
  const runtimeType = useCloudRuntime ? globalConfig.cloud!.provider : "local";
  
  // Build base + per-agent images via shared image builder
  const buildSkills = { locking: true };

  const buildResult = await buildAllImages({
    projectPath,
    globalConfig,
    activeAgentConfigs,
    runtime,
    runtimeType,
    statusTracker,
    logger: logger!,  // We'll ensure it's provided when called
    skills: buildSkills,
  });

  return {
    baseImage: buildResult.baseImage,
    agentImages: buildResult.agentImages
  };
}

export function selectAgentRuntimes(
  globalConfig: GlobalConfig,
  activeAgentConfigs: AgentConfig[],
  runtime: ContainerRuntime,
  cloudMode: boolean,
  logger: Logger
): Record<string, ContainerRuntime> {
  const agentRuntimeOverrides: Record<string, ContainerRuntime> = {};

  // Only for ECS cloud mode - create Lambda runtime for short-running agents
  if (cloudMode && globalConfig.cloud?.provider === "ecs") {
    const cc = globalConfig.cloud;
    
    // Import and create Lambda runtime (async import handled by caller)
    const createLambdaRuntime = async () => {
      const { LambdaRuntime } = await import("../docker/lambda-runtime.js");
      return new LambdaRuntime({
        awsRegion: cc.awsRegion!,
        ecrRepository: cc.ecrRepository!,
        secretPrefix: cc.awsSecretPrefix,
        buildBucket: cc.buildBucket,
        lambdaRoleArn: cc.lambdaRoleArn,
        lambdaSubnets: cc.lambdaSubnets,
        lambdaSecurityGroups: cc.lambdaSecurityGroups,
      });
    };

    // This function can't be async, so we'll return a promise to be handled by caller
    // For now, return empty overrides and handle Lambda runtime setup in scheduler
    return {};
  }

  return agentRuntimeOverrides;
}