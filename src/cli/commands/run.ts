import { resolve } from "path";
import { existsSync, mkdirSync } from "fs";
import { loadGlobalConfig, loadAgentConfig, discoverAgents } from "../../shared/config.js";
import { backendRequireCredentialRef } from "../../shared/credentials.js";
import { createLogger } from "../../shared/logger.js";
import { agentDir } from "../../shared/paths.js";
import { AgentRunner } from "../../agents/runner.js";
import { AWS_CONSTANTS } from "../../shared/aws-constants.js";
import { buildManualPrompt } from "../../agents/prompt.js";
import { execute as runDoctor } from "./doctor.js";

export async function execute(agent: string, opts: { project: string; noDocker?: boolean; cloud?: boolean }): Promise<void> {
  const projectPath = resolve(opts.project);

  // Guard: refuse to run if the project path looks like an agent directory
  if (existsSync(resolve(projectPath, "agent-config.toml")) || existsSync(resolve(projectPath, "PLAYBOOK.md"))) {
    throw new Error(
      `"${projectPath}" looks like an agent directory, not a project directory. ` +
      `Run 'al run' from the project root (the parent directory).`
    );
  }

  // Check agent exists
  const agentNames = discoverAgents(projectPath);
  if (!agentNames.includes(agent)) {
    const available = agentNames.length > 0 ? `Available agents: ${agentNames.join(", ")}` : "No agents found.";
    throw new Error(`Agent "${agent}" not found. ${available}`);
  }

  // Ensure credentials are present
  await runDoctor({ project: opts.project });

  const globalConfig = loadGlobalConfig(projectPath);
  const agentConfig = loadAgentConfig(projectPath, agent);

  // Validate credentials
  for (const credRef of agentConfig.credentials) {
    await backendRequireCredentialRef(credRef);
  }

  const dockerEnabled = !opts.noDocker && (globalConfig.local?.enabled ?? true);
  const cloudMode = opts.cloud === true;

  const logger = createLogger(projectPath, agent);

  if (cloudMode) {
    // Cloud mode: use cloud runtime
    const cloud = globalConfig.cloud;
    if (!cloud) {
      throw new Error("No [cloud] section found in config.toml. Run 'al cloud setup' first.");
    }

    const { setDefaultBackend } = await import("../../shared/credentials.js");
    const { createBackendFromCloudConfig } = await import("../../shared/remote.js");
    const backend = await createBackendFromCloudConfig(cloud);
    setDefaultBackend(backend);

    let runtime;
    if (cloud.provider === "cloud-run") {
      const { CloudRunJobRuntime } = await import("../../docker/cloud-run-runtime.js");
      const { gcpProject, region, artifactRegistry, serviceAccount, secretPrefix } = cloud;
      if (!gcpProject || !region || !artifactRegistry || !serviceAccount) {
        throw new Error(
          "Cloud Run requires cloud.gcpProject, cloud.region, " +
          "cloud.artifactRegistry, and cloud.serviceAccount in config.toml"
        );
      }
      runtime = new CloudRunJobRuntime({ gcpProject, region, artifactRegistry, serviceAccount, secretPrefix });
    } else {
      const { ECSFargateRuntime } = await import("../../docker/ecs-runtime.js");
      if (!cloud.awsRegion || !cloud.ecsCluster || !cloud.ecrRepository || !cloud.executionRoleArn || !cloud.taskRoleArn || !cloud.subnets?.length) {
        throw new Error(
          "ECS requires cloud.awsRegion, cloud.ecsCluster, cloud.ecrRepository, " +
          "cloud.executionRoleArn, cloud.taskRoleArn, and cloud.subnets in config.toml"
        );
      }
      runtime = new ECSFargateRuntime({
        awsRegion: cloud.awsRegion,
        ecsCluster: cloud.ecsCluster,
        ecrRepository: cloud.ecrRepository,
        executionRoleArn: cloud.executionRoleArn,
        taskRoleArn: cloud.taskRoleArn,
        subnets: cloud.subnets,
        securityGroups: cloud.securityGroups,
        secretPrefix: cloud.awsSecretPrefix,
      });
    }

    const { ContainerAgentRunner } = await import("../../agents/container-runner.js");

    const baseImage = globalConfig.local?.image || AWS_CONSTANTS.DEFAULT_IMAGE;
    const image = await runtime.buildImage({ tag: baseImage, dockerfile: "docker/Dockerfile", contextDir: resolve(import.meta.dirname || ".", "../..") });

    const runner = new ContainerAgentRunner(
      runtime,
      globalConfig,
      agentConfig,
      logger,
      () => {},
      () => {},
      "",
      projectPath,
      image,
    );

    const prompt = buildManualPrompt(agentConfig);
    console.log(`Running agent "${agent}" in cloud (${cloud.provider})...`);
    await runner.run(prompt);
  } else if (dockerEnabled) {
    // Docker mode: validate and run in container
    if (agentConfig.model.authType === "pi_auth") {
      throw new Error(
        `Agent "${agent}" uses pi_auth which is not supported in Docker mode. ` +
        `Either switch to api_key/oauth_token (run 'al doctor') or use --no-docker.`
      );
    }

    const { execFileSync } = await import("child_process");
    try {
      execFileSync("docker", ["info"], { stdio: "pipe", timeout: 10000 });
    } catch {
      throw new Error(
        "Docker is not running. Start Docker Desktop (or the Docker daemon) and try again, " +
        "or use --no-docker to run without container isolation."
      );
    }

    const { LocalDockerRuntime } = await import("../../docker/local-runtime.js");
    const { ensureNetwork } = await import("../../docker/network.js");
    const { ensureImage, ensureAgentImage } = await import("../../docker/image.js");
    const { ContainerAgentRunner } = await import("../../agents/container-runner.js");

    const runtime = new LocalDockerRuntime();
    ensureNetwork();

    const baseImage = globalConfig.local?.image || AWS_CONSTANTS.DEFAULT_IMAGE;
    ensureImage(baseImage);
    const image = ensureAgentImage(agent, projectPath, baseImage);

    const runner = new ContainerAgentRunner(
      runtime,
      globalConfig,
      agentConfig,
      logger,
      () => {},          // no gateway to register with
      () => {},          // no gateway to unregister from
      "",                // no gateway URL
      projectPath,
      image,
    );

    const prompt = buildManualPrompt(agentConfig);
    console.log(`Running agent "${agent}" in Docker...`);
    await runner.run(prompt);
  } else {
    // Host mode
    mkdirSync(agentDir(projectPath, agent), { recursive: true });
    const runner = new AgentRunner(agentConfig, logger, projectPath);
    const prompt = buildManualPrompt(agentConfig);
    console.log(`Running agent "${agent}"...`);
    await runner.run(prompt);
  }

  console.log(`Agent "${agent}" run completed.`);
}
