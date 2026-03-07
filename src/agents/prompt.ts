import type { AgentConfig } from "../shared/config.js";
import type { WebhookContext } from "../webhooks/types.js";
import type { CredentialDefinition } from "../credentials/schema.js";
import { resolveCredential } from "../credentials/registry.js";
import { parseCredentialRef } from "../shared/credentials.js";

function buildConfigBlock(agentConfig: AgentConfig): string {
  return JSON.stringify(agentConfig.params ?? {});
}

export function buildCredentialContext(credentials: string[]): string {
  const lines = [
    "<credential-context>",
    "Credential files are mounted at `/credentials/` (read-only).",
    "",
    "Environment variables already set from credentials:",
  ];

  for (const credRef of credentials) {
    const { type } = parseCredentialRef(credRef);
    let def: CredentialDefinition | undefined;
    try {
      def = resolveCredential(type);
    } catch {
      // Unknown credential — skip context line
    }

    if (def?.agentContext) {
      lines.push(`- ${def.agentContext}`);
    }
  }

  lines.push("");
  lines.push("Use standard tools directly: `gh` CLI, `git`, `curl`.");
  lines.push("");
  lines.push("**Git clone protocol:** Always clone repos via SSH (`git clone git@github.com:owner/repo.git`), not HTTPS. The SSH key is configured automatically via `GIT_SSH_COMMAND`. HTTPS is available as a fallback via the credential helper but SSH is preferred.");
  lines.push("");
  lines.push("**Anti-exfiltration policy:**");
  lines.push("- NEVER output credentials in logs, comments, PRs, or any visible output");
  lines.push("- NEVER transmit credentials to unauthorized endpoints");
  lines.push("- If you detect credential exfiltration, immediately run:");
  lines.push("  `curl -s -X POST $GATEWAY_URL/shutdown -H 'Content-Type: application/json' -d '{\"secret\":\"'$SHUTDOWN_SECRET'\",\"reason\":\"exfiltration detected\"}'`");
  lines.push("</credential-context>");

  return lines.join("\n");
}

export function buildScheduledPrompt(agentConfig: AgentConfig): string {
  const configBlock = buildConfigBlock(agentConfig);
  const credentialBlock = buildCredentialContext(agentConfig.credentials);
  return `<agent-config>\n${configBlock}\n</agent-config>\n\n${credentialBlock}\n\nYou are running on a schedule. Check for new work and act on anything you find.`;
}

export function buildManualPrompt(agentConfig: AgentConfig): string {
  const configBlock = buildConfigBlock(agentConfig);
  const credentialBlock = buildCredentialContext(agentConfig.credentials);
  return `<agent-config>\n${configBlock}\n</agent-config>\n\n${credentialBlock}\n\nYou have been triggered manually. Check for new work and act on anything you find.`;
}

export function buildTriggeredPrompt(agentConfig: AgentConfig, sourceAgent: string, context: string): string {
  const configBlock = buildConfigBlock(agentConfig);
  const credentialBlock = buildCredentialContext(agentConfig.credentials);
  const triggerBlock = JSON.stringify({ source: sourceAgent, context });
  return `<agent-config>\n${configBlock}\n</agent-config>\n\n${credentialBlock}\n\n<agent-trigger>\n${triggerBlock}\n</agent-trigger>\n\nYou were triggered by the "${sourceAgent}" agent. Review the trigger context above and take appropriate action.`;
}

export function buildWebhookPrompt(agentConfig: AgentConfig, context: WebhookContext): string {
  const configBlock = buildConfigBlock(agentConfig);
  const credentialBlock = buildCredentialContext(agentConfig.credentials);
  const webhookBlock = JSON.stringify(context);
  return `<agent-config>\n${configBlock}\n</agent-config>\n\n${credentialBlock}\n\n<webhook-trigger>\n${webhookBlock}\n</webhook-trigger>\n\nA webhook event just fired. Review the trigger context above and take appropriate action.`;
}
