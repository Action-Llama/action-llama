/**
 * CloudProvider interface — abstracts per-provider cloud operations.
 *
 * Each cloud provider (AWS ECS, GCP Cloud Run) implements this interface,
 * allowing CLI commands and the scheduler to be provider-agnostic.
 */

import type { ContainerRuntime } from "../docker/runtime.js";
import type { CredentialBackend } from "../shared/credential-backend.js";
import type { AgentConfig, GlobalConfig } from "../shared/config.js";

export interface ProvisionedResource {
  type: string;
  id: string;
  region?: string;
  arn?: string;
}

export interface SchedulerServiceInfo {
  serviceUrl: string;
  status: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface RuntimeResult {
  runtime: ContainerRuntime;
  agentRuntimeOverrides: Record<string, ContainerRuntime>;
}

export interface CloudProvider {
  readonly providerName: "ecs" | "cloud-run" | "vps";

  /** Interactive provisioning wizard. Returns config fields to write to config.toml, or null if aborted. */
  provision(): Promise<Record<string, unknown> | null>;

  /** Tear down all provisioned cloud resources for this project. */
  teardown(projectPath: string): Promise<void>;

  /** Reconcile per-agent IAM resources (roles, service accounts, secret bindings). */
  reconcileAgents(projectPath: string): Promise<void>;

  /** Reconcile infrastructure-level IAM policies (e.g. App Runner instance role). */
  reconcileInfraPolicy(): Promise<void>;

  /** Validate that IAM roles/service accounts exist and are correctly configured. */
  validateRoles(projectPath: string): Promise<void>;

  /** Create the primary container runtime for this provider. */
  createRuntime(): ContainerRuntime;

  /** Create a runtime for a specific agent. Handles Lambda routing for ECS short-timeout agents. */
  createAgentRuntime(agentConfig: AgentConfig, globalConfig: GlobalConfig): ContainerRuntime;

  /** Create primary runtime + per-agent overrides for the scheduler. */
  createRuntimes(activeAgentConfigs: AgentConfig[], globalConfig: GlobalConfig): RuntimeResult;

  /** Create a credential backend for this provider. */
  createCredentialBackend(): Promise<CredentialBackend>;

  /** Deploy the scheduler service. Returns service info with URL. */
  deployScheduler(imageUri: string): Promise<SchedulerServiceInfo>;

  /** Get the current scheduler service status. */
  getSchedulerStatus(): Promise<SchedulerServiceInfo | null>;

  /** Fetch recent scheduler logs. */
  getSchedulerLogs(limit: number): Promise<string[]>;

  /** Follow scheduler logs, polling for new entries. */
  followSchedulerLogs(
    onLine: (line: string) => void,
    onStderr?: (text: string) => void,
  ): { stop: () => void };

  /** Tear down the scheduler service only. */
  teardownScheduler(): Promise<void>;
}

/**
 * Factory: create a CloudProvider from validated cloud config.
 */
export async function createCloudProvider(
  cloudConfig: import("../shared/config.js").CloudConfig,
): Promise<CloudProvider> {
  if (cloudConfig.provider === "ecs") {
    const { AwsCloudProvider } = await import("./aws/provider.js");
    return new AwsCloudProvider(cloudConfig);
  }

  if (cloudConfig.provider === "cloud-run") {
    const { GcpCloudProvider } = await import("./gcp/provider.js");
    return new GcpCloudProvider(cloudConfig);
  }

  if (cloudConfig.provider === "vps") {
    const { VpsCloudProvider } = await import("./vps/provider.js");
    return new VpsCloudProvider(cloudConfig);
  }

  throw new Error(`Unknown cloud provider: "${(cloudConfig as any).provider}"`);
}
