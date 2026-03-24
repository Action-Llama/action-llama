/**
 * Launches and manages containers for chat sessions.
 *
 * Similar to ContainerAgentRunner but for interactive chat:
 *  - Sets AL_CHAT_MODE=1, AL_CHAT_SESSION_ID env vars
 *  - No PROMPT, no hard timeout
 *  - Reuses ContainerRuntime.launch() and prepareCredentials()
 */

import { randomUUID } from "crypto";
import type { ContainerRuntime } from "../docker/runtime.js";
import type { AgentConfig, GlobalConfig } from "../shared/config.js";
import type { Logger } from "../shared/logger.js";
import type { ChatSessionManager } from "./session-manager.js";

export class ChatContainerLauncher {
  private runtime: ContainerRuntime;
  private globalConfig: GlobalConfig;
  private agentConfigs: AgentConfig[];
  private gatewayUrl: string;
  private logger: Logger;
  private sessionManager: ChatSessionManager;
  private images: Map<string, string>;

  constructor(opts: {
    runtime: ContainerRuntime;
    globalConfig: GlobalConfig;
    agentConfigs: AgentConfig[];
    gatewayUrl: string;
    logger: Logger;
    sessionManager: ChatSessionManager;
    images: Map<string, string>;
  }) {
    this.runtime = opts.runtime;
    this.globalConfig = opts.globalConfig;
    this.agentConfigs = opts.agentConfigs;
    this.gatewayUrl = opts.gatewayUrl;
    this.logger = opts.logger;
    this.sessionManager = opts.sessionManager;
    this.images = opts.images;
  }

  async launchChatContainer(agentName: string, sessionId: string): Promise<string> {
    const agentConfig = this.agentConfigs.find((a) => a.name === agentName);
    if (!agentConfig) {
      throw new Error(`Agent "${agentName}" not found`);
    }

    const image = this.images.get(agentName);
    if (!image) {
      throw new Error(`No image available for agent "${agentName}". Has the agent been built?`);
    }

    // Resolve credential refs
    const credRefs = [...new Set(agentConfig.credentials)];
    for (const mc of agentConfig.models) {
      if (mc.authType === "pi_auth") continue;
      const providerKey = `${mc.provider}_key`;
      if (!credRefs.some((r) => r === providerKey || r.startsWith(`${providerKey}:`))) {
        credRefs.push(providerKey);
      }
    }

    const credentials = await this.runtime.prepareCredentials(credRefs);

    const env: Record<string, string> = {
      AL_CHAT_MODE: "1",
      AL_CHAT_SESSION_ID: sessionId,
      GATEWAY_URL: this.gatewayUrl,
    };

    const containerName = await this.runtime.launch({
      image,
      agentName: `${agentName}-chat-${sessionId.slice(0, 8)}`,
      env,
      credentials,
      memory: this.globalConfig.local?.memory,
      cpus: this.globalConfig.local?.cpus,
    });

    this.sessionManager.setContainerName(sessionId, containerName);
    this.logger.info({ agentName, sessionId, containerName }, "chat container launched");

    return containerName;
  }

  async stopChatContainer(sessionId: string): Promise<void> {
    const session = this.sessionManager.getSession(sessionId);
    if (!session?.containerName) return;

    try {
      await this.runtime.kill(session.containerName);
    } catch (err: any) {
      this.logger.warn({ sessionId, err: err.message }, "failed to kill chat container");
    }

    try {
      await this.runtime.remove(session.containerName);
    } catch {
      // Container may already be removed
    }

    this.logger.info({ sessionId, containerName: session.containerName }, "chat container stopped");
  }
}
