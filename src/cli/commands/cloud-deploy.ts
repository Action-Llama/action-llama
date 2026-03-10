/**
 * `al cloud deploy` — Build and deploy the scheduler + agents to the cloud.
 *
 * Steps:
 * 1. Validate config (must have [cloud] section)
 * 2. Run doctor -c to ensure creds are pushed + IAM is set up
 * 3. Create cloud runtime + build all agent images
 * 4. Build scheduler image
 * 5. Deploy scheduler service (App Runner or Cloud Run)
 * 6. Print deployed URL
 */

import { resolve } from "path";
import { loadGlobalConfig, discoverAgents, loadAgentConfig, validateAgentConfig } from "../../shared/config.js";
import type { CloudConfig } from "../../shared/config.js";
import { execute as runDoctor } from "./doctor.js";
import { buildAllImages } from "../../cloud/image-builder.js";
import { buildSchedulerImage } from "../../cloud/scheduler-image.js";
import { createLogger } from "../../shared/logger.js";
import type { ContainerRuntime } from "../../docker/runtime.js";

export async function execute(opts: { project: string }): Promise<void> {
  const projectPath = resolve(opts.project);
  const globalConfig = loadGlobalConfig(projectPath);
  const cloud = globalConfig.cloud;

  if (!cloud) {
    throw new Error("No [cloud] section found in config.toml. Run 'al cloud setup' first.");
  }

  const logger = createLogger(projectPath, "deploy");

  console.log(`\n=== Cloud Deploy (${cloud.provider}) ===\n`);

  // 1. Run doctor -c to push credentials and reconcile IAM
  console.log("Step 1: Validating credentials and IAM...");
  await runDoctor({ project: opts.project, cloud: true, checkOnly: true });
  console.log("");

  // 2. Set up cloud credential backend
  const { setDefaultBackend } = await import("../../shared/credentials.js");
  const { createBackendFromCloudConfig } = await import("../../shared/remote.js");
  const backend = await createBackendFromCloudConfig(cloud);
  setDefaultBackend(backend);

  // 3. Discover agents and create runtime
  const agentNames = discoverAgents(projectPath);
  if (agentNames.length === 0) {
    throw new Error("No agents found. Create agents first.");
  }

  const agentConfigs = agentNames.map((name) => loadAgentConfig(projectPath, name));
  for (const config of agentConfigs) {
    validateAgentConfig(config);
  }
  const activeAgentConfigs = agentConfigs.filter((a) => (a.scale ?? 1) > 0);

  const runtime = await createCloudRuntime(cloud);

  // 4. Build agent images
  console.log("Step 2: Building agent images...");
  await buildAllImages({
    projectPath,
    globalConfig,
    activeAgentConfigs,
    runtime,
    runtimeType: cloud.provider,
    logger,
    skills: { locking: true },
  });
  console.log("Agent images built and pushed.\n");

  // 5. Build scheduler image
  console.log("Step 3: Building scheduler image...");
  const schedulerImageUri = await buildSchedulerImage({
    projectPath,
    globalConfig,
    runtime,
    logger,
    onProgress: (msg) => console.log(`  ${msg}`),
  });
  console.log(`Scheduler image: ${schedulerImageUri}\n`);

  // 6. Deploy scheduler service
  console.log("Step 4: Deploying scheduler service...");
  const serviceInfo = await deploySchedulerService(cloud, schedulerImageUri);

  console.log(`\nScheduler deployed successfully!`);
  console.log(`  URL:    ${serviceInfo.serviceUrl}`);
  console.log(`  Status: ${serviceInfo.status}`);

  // Print webhook URLs
  const webhookSources = globalConfig.webhooks ?? {};
  const providerTypes = new Set(
    agentConfigs.flatMap((a) =>
      a.webhooks?.map((t) => webhookSources[t.source]?.type).filter(Boolean) || []
    )
  );

  if (providerTypes.size > 0) {
    console.log("\nWebhook endpoints:");
    for (const pt of providerTypes) {
      console.log(`  ${pt}: ${serviceInfo.serviceUrl}/webhooks/${pt}`);
    }
  }

  console.log("");
}

async function createCloudRuntime(cloud: CloudConfig): Promise<ContainerRuntime> {
  if (cloud.provider === "cloud-run") {
    const { CloudRunJobRuntime } = await import("../../docker/cloud-run-runtime.js");
    const { gcpProject, region, artifactRegistry, serviceAccount, secretPrefix } = cloud;
    if (!gcpProject || !region || !artifactRegistry || !serviceAccount) {
      throw new Error(
        "Cloud Run deployment requires cloud.gcpProject, cloud.region, " +
        "cloud.artifactRegistry, and cloud.serviceAccount in config.toml"
      );
    }
    return new CloudRunJobRuntime({ gcpProject, region, artifactRegistry, serviceAccount, secretPrefix });
  }

  if (cloud.provider === "ecs") {
    const { ECSFargateRuntime } = await import("../../docker/ecs-runtime.js");
    const cc = cloud;
    if (!cc.awsRegion || !cc.ecsCluster || !cc.ecrRepository || !cc.executionRoleArn || !cc.taskRoleArn || !cc.subnets?.length) {
      throw new Error(
        "ECS deployment requires cloud.awsRegion, cloud.ecsCluster, cloud.ecrRepository, " +
        "cloud.executionRoleArn, cloud.taskRoleArn, and cloud.subnets in config.toml"
      );
    }
    return new ECSFargateRuntime({
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
  }

  throw new Error(`Unknown cloud provider: "${cloud.provider}"`);
}

async function deploySchedulerService(
  cloud: CloudConfig,
  imageUri: string
): Promise<{ serviceUrl: string; status: string }> {
  if (cloud.provider === "ecs") {
    const { deployAppRunner } = await import("../../cloud/deploy-apprunner.js");
    return await deployAppRunner({ imageUri, cloudConfig: cloud });
  }

  if (cloud.provider === "cloud-run") {
    const { deployCloudRun } = await import("../../cloud/deploy-cloudrun.js");
    return await deployCloudRun({ imageUri, cloudConfig: cloud });
  }

  throw new Error(`Unknown cloud provider: "${cloud.provider}"`);
}
