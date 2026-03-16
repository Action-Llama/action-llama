/**
 * AWS (ECS) cloud provider implementation.
 *
 * Wraps EcsCloudConfig and delegates to the extracted AWS modules
 * (provision, teardown, iam, deploy) via the CloudProvider interface.
 */

import type { EcsCloudConfig, AgentConfig, GlobalConfig } from "../../shared/config.js";
import type { ContainerRuntime } from "../../docker/runtime.js";
import type { CredentialBackend } from "../../shared/credential-backend.js";
import type {
  CloudProvider,
  SchedulerServiceInfo,
  RuntimeResult,
} from "../provider.js";
import { ECSFargateRuntime } from "../../docker/ecs-runtime.js";
import { LambdaRuntime } from "../../docker/lambda-runtime.js";
import { AWS_CONSTANTS } from "./constants.js";
import { CONSTANTS } from "../../shared/constants.js";

export class AwsCloudProvider implements CloudProvider {
  readonly providerName = "ecs" as const;
  private config: EcsCloudConfig;

  constructor(config: EcsCloudConfig) {
    this.config = config;
  }

  /**
   * Interactive provisioning wizard. Runs the ECS setup flow and
   * returns config fields to write to config.toml.
   */
  async provision(): Promise<Record<string, unknown> | null> {
    const { setupEcsCloud } = await import("./provision.js");
    // setupEcsCloud mutates the config object in place and returns success/failure
    const configCopy = { ...this.config };
    const success = await setupEcsCloud(configCopy);
    if (!success) {
      return null;
    }
    // Return the full mutated config as a flat record
    return configCopy as unknown as Record<string, unknown>;
  }

  /**
   * Tear down all provisioned AWS cloud resources for this project.
   */
  async teardown(projectPath: string): Promise<void> {
    const { teardownAws } = await import("./teardown.js");
    await teardownAws(projectPath, this.config);
  }

  /**
   * Reconcile per-agent IAM resources (ECS task roles + Lambda roles).
   */
  async reconcileAgents(projectPath: string): Promise<void> {
    const { reconcileAwsAgents, reconcileLambdaRoles } = await import("./iam.js");
    await reconcileAwsAgents(projectPath, this.config);
    await reconcileLambdaRoles(projectPath, this.config);
  }

  /**
   * Reconcile infrastructure-level IAM policies (App Runner instance role).
   */
  async reconcileInfraPolicy(): Promise<void> {
    const { reconcileAppRunnerInstancePolicy } = await import("./iam.js");
    await reconcileAppRunnerInstancePolicy(this.config);
  }

  /**
   * Validate that per-agent IAM task roles exist and are correctly configured.
   */
  async validateRoles(projectPath: string): Promise<void> {
    const { validateEcsRoles } = await import("./iam.js");
    await validateEcsRoles(projectPath, this.config);
  }

  /**
   * Create the primary ECS Fargate container runtime.
   */
  createRuntime(): ContainerRuntime {
    return new ECSFargateRuntime({
      awsRegion: this.config.awsRegion,
      ecsCluster: this.config.ecsCluster,
      ecrRepository: this.config.ecrRepository,
      executionRoleArn: this.config.executionRoleArn,
      taskRoleArn: this.config.taskRoleArn,
      subnets: this.config.subnets,
      securityGroups: this.config.securityGroups,
      secretPrefix: this.config.awsSecretPrefix || CONSTANTS.DEFAULT_SECRET_PREFIX,
      buildBucket: this.config.buildBucket,
    });
  }

  /**
   * Create a runtime for a specific agent.
   *
   * Agents with timeout <= LAMBDA_MAX_TIMEOUT are routed to Lambda
   * for faster cold starts and lower cost. All others use ECS Fargate.
   */
  createAgentRuntime(agentConfig: AgentConfig, globalConfig: GlobalConfig): ContainerRuntime {
    const effectiveTimeout = agentConfig.timeout ?? globalConfig.local?.timeout ?? 900;

    if (effectiveTimeout <= AWS_CONSTANTS.LAMBDA_MAX_TIMEOUT) {
      return new LambdaRuntime({
        awsRegion: this.config.awsRegion,
        ecrRepository: this.config.ecrRepository,
        secretPrefix: this.config.awsSecretPrefix || CONSTANTS.DEFAULT_SECRET_PREFIX,
        buildBucket: this.config.buildBucket,
        lambdaRoleArn: this.config.lambdaRoleArn,
        lambdaSubnets: this.config.lambdaSubnets,
        lambdaSecurityGroups: this.config.lambdaSecurityGroups,
      });
    }

    return this.createRuntime();
  }

  /**
   * Create primary ECS runtime + per-agent Lambda overrides for
   * agents with short timeouts.
   */
  createRuntimes(activeAgentConfigs: AgentConfig[], globalConfig: GlobalConfig): RuntimeResult {
    const runtime = this.createRuntime();
    const agentRuntimeOverrides: Record<string, ContainerRuntime> = {};

    // Check which agents should be routed to Lambda
    let lambdaRuntime: ContainerRuntime | null = null;

    for (const agentConfig of activeAgentConfigs) {
      const effectiveTimeout = agentConfig.timeout ?? globalConfig.local?.timeout ?? 900;

      if (effectiveTimeout <= AWS_CONSTANTS.LAMBDA_MAX_TIMEOUT) {
        // Lazily create a single shared Lambda runtime
        if (!lambdaRuntime) {
          lambdaRuntime = new LambdaRuntime({
            awsRegion: this.config.awsRegion,
            ecrRepository: this.config.ecrRepository,
            secretPrefix: this.config.awsSecretPrefix || CONSTANTS.DEFAULT_SECRET_PREFIX,
            buildBucket: this.config.buildBucket,
            lambdaRoleArn: this.config.lambdaRoleArn,
            lambdaSubnets: this.config.lambdaSubnets,
            lambdaSecurityGroups: this.config.lambdaSecurityGroups,
          });
        }
        agentRuntimeOverrides[agentConfig.name] = lambdaRuntime;
      }
    }

    return { runtime, agentRuntimeOverrides };
  }

  /**
   * Create an AWS Secrets Manager credential backend.
   */
  async createCredentialBackend(): Promise<CredentialBackend> {
    const { AwsSecretsManagerBackend } = await import("../../shared/asm-backend.js");
    return new AwsSecretsManagerBackend(
      this.config.awsRegion,
      this.config.awsSecretPrefix || CONSTANTS.DEFAULT_SECRET_PREFIX,
    );
  }

  /**
   * Deploy the scheduler as an App Runner service.
   */
  async deployScheduler(imageUri: string): Promise<SchedulerServiceInfo> {
    const { deployAppRunner } = await import("./deploy.js");
    const result = await deployAppRunner({
      imageUri,
      cloudConfig: this.config,
    });
    return {
      serviceUrl: result.serviceUrl,
      status: result.status,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
    };
  }

  /**
   * Get the current scheduler App Runner service status.
   */
  async getSchedulerStatus(): Promise<SchedulerServiceInfo | null> {
    const { getAppRunnerStatus } = await import("./deploy.js");
    const result = await getAppRunnerStatus(this.config);
    if (!result) return null;
    return {
      serviceUrl: result.serviceUrl,
      status: result.status,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
    };
  }

  /**
   * Fetch recent scheduler logs from CloudWatch.
   */
  async getSchedulerLogs(limit: number): Promise<string[]> {
    const { getAppRunnerLogs } = await import("./deploy.js");
    return getAppRunnerLogs(this.config, limit);
  }

  /**
   * Tear down the scheduler App Runner service only.
   */
  async teardownScheduler(): Promise<void> {
    const { teardownAppRunner } = await import("./deploy.js");
    await teardownAppRunner(this.config);
  }
}
