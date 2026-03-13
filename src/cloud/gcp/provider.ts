/**
 * GcpCloudProvider — CloudProvider implementation for GCP Cloud Run.
 *
 * Wraps CloudRunCloudConfig and delegates to the extracted GCP modules
 * (iam, provision, teardown, deploy) and the CloudRunJobRuntime.
 */

import type { CloudProvider, SchedulerServiceInfo, RuntimeResult } from "../provider.js";
import type { ContainerRuntime } from "../../docker/runtime.js";
import type { CredentialBackend } from "../../shared/credential-backend.js";
import type { AgentConfig, CloudRunCloudConfig, GlobalConfig } from "../../shared/config.js";
import { CloudRunJobRuntime } from "../../docker/cloud-run-runtime.js";
import { CONSTANTS } from "../../shared/constants.js";

export class GcpCloudProvider implements CloudProvider {
  readonly providerName = "cloud-run" as const;

  private config: CloudRunCloudConfig;

  constructor(config: CloudRunCloudConfig) {
    this.config = config;
  }

  async provision(): Promise<Record<string, unknown> | null> {
    const { setupGcpCloud } = await import("./provision.js");
    return setupGcpCloud();
  }

  async teardown(projectPath: string): Promise<void> {
    const { teardownGcp } = await import("./teardown.js");
    await teardownGcp(projectPath, this.config);
  }

  async reconcileAgents(projectPath: string): Promise<void> {
    const { reconcileGcpAgents } = await import("./iam.js");
    await reconcileGcpAgents(projectPath, this.config);
  }

  async validateRoles(_projectPath: string): Promise<void> {
    // No-op for GCP — no equivalent to ECS role validation.
    // GCP service accounts are validated implicitly at execution time.
  }

  createRuntime(): ContainerRuntime {
    return new CloudRunJobRuntime({
      gcpProject: this.config.gcpProject,
      region: this.config.region,
      artifactRegistry: this.config.artifactRegistry,
      serviceAccount: this.config.serviceAccount,
      secretPrefix: this.config.secretPrefix ?? CONSTANTS.DEFAULT_SECRET_PREFIX,
    });
  }

  createAgentRuntime(_agentConfig: AgentConfig, _globalConfig: GlobalConfig): ContainerRuntime {
    // GCP has no Lambda-style routing — always use Cloud Run Jobs
    return this.createRuntime();
  }

  createRuntimes(_activeAgentConfigs: AgentConfig[], _globalConfig: GlobalConfig): RuntimeResult {
    return {
      runtime: this.createRuntime(),
      agentRuntimeOverrides: {},
    };
  }

  async createCredentialBackend(): Promise<CredentialBackend> {
    const { GoogleSecretManagerBackend } = await import("../../shared/gsm-backend.js");
    return new GoogleSecretManagerBackend(
      this.config.gcpProject,
      this.config.secretPrefix ?? CONSTANTS.DEFAULT_SECRET_PREFIX,
    );
  }

  async deployScheduler(imageUri: string): Promise<SchedulerServiceInfo> {
    const { deployCloudRun } = await import("./deploy.js");
    const result = await deployCloudRun({
      imageUri,
      cloudConfig: this.config,
    });
    return {
      serviceUrl: result.serviceUrl,
      status: result.status,
    };
  }

  async getSchedulerStatus(): Promise<SchedulerServiceInfo | null> {
    const { getCloudRunStatus } = await import("./deploy.js");
    const result = await getCloudRunStatus(this.config);
    if (!result) return null;
    return {
      serviceUrl: result.serviceUrl,
      status: result.status,
    };
  }

  async getSchedulerLogs(limit: number): Promise<string[]> {
    const { getCloudRunLogs } = await import("./deploy.js");
    return getCloudRunLogs(this.config, limit);
  }

  async teardownScheduler(): Promise<void> {
    const { teardownCloudRunService } = await import("./deploy.js");
    await teardownCloudRunService(this.config);
  }
}
