/**
 * VpsProvider — CloudProvider implementation for VPS (SSH + Docker).
 *
 * Uses SSH to run Docker commands on a remote server.
 * Vultr is the first provisioning backend; the runtime works with any server.
 */

import type { CloudProvider, SchedulerServiceInfo, RuntimeResult } from "../provider.js";
import type { ContainerRuntime } from "../../docker/runtime.js";
import type { CredentialBackend } from "../../shared/credential-backend.js";
import type { AgentConfig, GlobalConfig, VpsConfig } from "../../shared/config.js";
import { SshDockerRuntime } from "../../docker/ssh-docker-runtime.js";
import { SshFilesystemBackend } from "../../shared/ssh-fs-backend.js";
import { sshExec, sshSpawn, testConnection, type SshConfig } from "./ssh.js";
import { VPS_CONSTANTS } from "./constants.js";
import { CONSTANTS } from "../../shared/constants.js";

function sshConfigFromVps(config: VpsConfig): SshConfig {
  return {
    host: config.host,
    user: config.sshUser ?? VPS_CONSTANTS.DEFAULT_SSH_USER,
    port: config.sshPort ?? VPS_CONSTANTS.DEFAULT_SSH_PORT,
    keyPath: config.sshKeyPath ?? VPS_CONSTANTS.DEFAULT_SSH_KEY_PATH,
  };
}

export class VpsProvider implements CloudProvider {
  readonly providerName = "vps" as const;

  private config: VpsConfig;
  private sshConfig: SshConfig;

  constructor(config: VpsConfig) {
    this.config = config;
    this.sshConfig = sshConfigFromVps(config);
  }

  async provision(): Promise<Record<string, unknown> | null> {
    const { setupVpsCloud } = await import("./provision.js");
    return setupVpsCloud();
  }

  async teardown(projectPath: string): Promise<void> {
    const { teardownVps } = await import("./teardown.js");
    await teardownVps(projectPath, this.config);
  }

  async reconcileAgents(_projectPath: string): Promise<void> {
    // No-op — VPS has no IAM roles or service accounts to reconcile.
  }

  async reconcileInfraPolicy(): Promise<void> {
    // No-op — no infrastructure-level policies on a VPS.
  }

  async validateRoles(_projectPath: string): Promise<void> {
    // Validate SSH connectivity and Docker availability
    const connected = await testConnection(this.sshConfig);
    if (!connected) {
      throw new Error(`Cannot SSH to ${this.config.host}. Check network and SSH config.`);
    }

    const dockerResult = await sshExec(this.sshConfig, "docker info --format '{{.ServerVersion}}'");
    if (dockerResult.exitCode !== 0) {
      throw new Error(`Docker not available on ${this.config.host}. Install Docker first.`);
    }
  }

  createRuntime(): ContainerRuntime {
    return new SshDockerRuntime(this.sshConfig);
  }

  createAgentRuntime(_agentConfig: AgentConfig, _globalConfig: GlobalConfig): ContainerRuntime {
    // VPS has no routing — always use the same SSH Docker runtime
    return this.createRuntime();
  }

  createRuntimes(_activeAgentConfigs: AgentConfig[], _globalConfig: GlobalConfig): RuntimeResult {
    return {
      runtime: this.createRuntime(),
      agentRuntimeOverrides: {},
    };
  }

  async createCredentialBackend(): Promise<CredentialBackend> {
    return new SshFilesystemBackend(this.sshConfig);
  }

  async deployScheduler(imageUri: string): Promise<SchedulerServiceInfo> {
    const container = VPS_CONSTANTS.SCHEDULER_CONTAINER;

    // Stop existing scheduler if running
    await sshExec(this.sshConfig, `docker rm -f '${container}' 2>/dev/null || true`);

    // Start scheduler container
    const result = await sshExec(
      this.sshConfig,
      `docker run -d --restart unless-stopped --name '${container}' -p 8080:8080 '${imageUri}'`,
    );

    if (result.exitCode !== 0) {
      throw new Error(`Failed to start scheduler: ${result.stderr}`);
    }

    return {
      serviceUrl: `http://${this.config.host}:8080`,
      status: "running",
    };
  }

  async getSchedulerStatus(): Promise<SchedulerServiceInfo | null> {
    const container = VPS_CONSTANTS.SCHEDULER_CONTAINER;
    const result = await sshExec(
      this.sshConfig,
      `docker inspect --format '{{.State.Status}}' '${container}' 2>/dev/null`,
    );

    if (result.exitCode !== 0) return null;

    return {
      serviceUrl: `http://${this.config.host}:8080`,
      status: result.stdout,
    };
  }

  async getSchedulerLogs(limit: number): Promise<string[]> {
    const container = VPS_CONSTANTS.SCHEDULER_CONTAINER;
    const result = await sshExec(
      this.sshConfig,
      `docker logs --tail ${limit} '${container}' 2>&1`,
      60_000,
    );
    if (result.exitCode !== 0) return [];
    return result.stdout.split("\n").filter(Boolean);
  }

  followSchedulerLogs(
    onLine: (line: string) => void,
    onStderr?: (text: string) => void,
  ): { stop: () => void } {
    const container = VPS_CONSTANTS.SCHEDULER_CONTAINER;
    const proc = sshSpawn(this.sshConfig, `docker logs -f '${container}'`);

    let buffer = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) onLine(line);
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text && onStderr) onStderr(text);
    });

    return {
      stop: () => {
        if (buffer.trim()) onLine(buffer);
        proc.kill();
      },
    };
  }

  async teardownScheduler(): Promise<void> {
    const container = VPS_CONSTANTS.SCHEDULER_CONTAINER;
    await sshExec(this.sshConfig, `docker rm -f '${container}'`);
  }
}
