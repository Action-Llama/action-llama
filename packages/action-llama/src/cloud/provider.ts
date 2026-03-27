/**
 * CloudProvider interface — abstracts per-provider cloud operations.
 *
 * Each cloud provider implements this interface,
 * allowing CLI commands and the scheduler to be provider-agnostic.
 */

import type { Runtime } from "../docker/runtime.js";
import type { CredentialBackend } from "../shared/credential-backend.js";
import type { AgentConfig, GlobalConfig } from "../shared/config.js";

export interface ProvisionedResource {
  type: string;
  id: string;
  region?: string;
}

export interface SchedulerServiceInfo {
  serviceUrl: string;
  status: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface RuntimeResult {
  runtime: Runtime;
  agentRuntimeOverrides: Record<string, Runtime>;
}

export interface CloudProvider {
  readonly providerName: "vps";

  /** Interactive provisioning wizard. Returns config fields to write to config.toml, or null if aborted. */
  provision(): Promise<Record<string, unknown> | null>;

  /** Tear down all provisioned cloud resources for this project. */
  teardown(projectPath: string): Promise<void>;

  /** Reconcile per-agent resources. */
  reconcileAgents(projectPath: string): Promise<void>;

  /** Reconcile infrastructure-level policies. */
  reconcileInfraPolicy(): Promise<void>;

  /** Validate that roles/accounts exist and are correctly configured. */
  validateRoles(projectPath: string): Promise<void>;

  /** Create the primary container runtime for this provider. */
  createRuntime(): Runtime;

  /** Create a runtime for a specific agent. */
  createAgentRuntime(agentConfig: AgentConfig, globalConfig: GlobalConfig): Runtime;

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
  if (cloudConfig.provider === "vps") {
    const { VpsProvider } = await import("./vps/provider.js");
    return new VpsProvider(cloudConfig);
  }

  throw new Error(`Unknown cloud provider: "${(cloudConfig as any).provider}"`);
}
