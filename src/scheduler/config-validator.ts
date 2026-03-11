import type { AgentConfig, GlobalConfig } from "../shared/config.js";
import { backendRequireCredentialRef } from "../shared/credentials.js";

/**
 * Validates that all agents have at least a schedule or webhooks configured (unless they are disabled with scale=0)
 */
export function validateAgentConfigs(agentConfigs: AgentConfig[]): void {
  for (const config of agentConfigs) {
    const isDisabled = (config.scale ?? 1) === 0;
    if (!isDisabled && !config.schedule && (!config.webhooks || config.webhooks.length === 0)) {
      throw new Error(
        `Agent "${config.name}" must have a schedule, webhooks, or both`
      );
    }
  }
}

/**
 * Validates that all required credentials exist for active agents
 */
export async function validateCredentials(agentConfigs: AgentConfig[]): Promise<void> {
  const activeAgentConfigs = agentConfigs.filter((a) => (a.scale ?? 1) > 0);
  const allCredentials = new Set(activeAgentConfigs.flatMap((a) => a.credentials));
  
  for (const credRef of allCredentials) {
    await backendRequireCredentialRef(credRef);
  }
}

/**
 * Validates ECS IAM roles if using cloud ECS mode
 */
export async function validateEcsRolesIfNeeded(
  globalConfig: GlobalConfig, 
  projectPath: string
): Promise<void> {
  if (globalConfig.cloud?.provider === "ecs") {
    const { validateEcsRoles } = await import("../cli/commands/doctor.js");
    try {
      await validateEcsRoles(projectPath, globalConfig.cloud);
    } catch (err: any) {
      throw new Error(
        `❌ ECS IAM role validation failed\n\n` +
        `${err.message}\n\n` +
        `This validation prevents runtime failures when agents try to start.\n` +
        `Fix the IAM roles before starting the scheduler.`
      );
    }
  }
}

/**
 * Validates that pi_auth is not used with Docker mode (unsupported)
 */
export function validateDockerCompatibility(
  agentConfigs: AgentConfig[], 
  dockerEnabled: boolean
): void {
  if (!dockerEnabled) return;
  
  for (const config of agentConfigs) {
    if (config.model.authType === "pi_auth") {
      throw new Error(
        `Agent "${config.name}" uses pi_auth which is not supported in Docker mode. ` +
        `Either switch to api_key/oauth_token (run 'al doctor') or use --no-docker.`
      );
    }
  }
}