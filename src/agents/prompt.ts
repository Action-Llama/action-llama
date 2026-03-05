import type { AgentConfig } from "../shared/config.js";
import type { WebhookContext } from "../webhooks/types.js";
import type { CredentialDefinition } from "../credentials/schema.js";
import { resolveCredential } from "../credentials/registry.js";

function buildConfigBlock(agentConfig: AgentConfig): string {
  return JSON.stringify({
    repos: agentConfig.repos,
    ...agentConfig.params,
  });
}

export function buildCredentialContext(credentials: string[]): string {
  const lines = [
    "<credential-context>",
    "Credential files are mounted at `/credentials/` (read-only).",
    "",
    "Environment variables already set from credentials:",
  ];

  for (const credId of credentials) {
    let def: CredentialDefinition | undefined;
    try {
      def = resolveCredential(credId);
    } catch {
      // Unknown credential — skip context line
    }

    if (def?.agentContext) {
      lines.push(`- ${def.agentContext}`);
    }
  }

  // Also note GH_TOKEN alias when github-token is present
  if (credentials.includes("github-token")) {
    // agentContext already mentions GH_TOKEN, but ensure env var is documented
  }

  lines.push("");
  lines.push("Use standard tools directly: `gh` CLI, `git`, `curl`.");
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

export function buildWebhookPrompt(agentConfig: AgentConfig, context: WebhookContext): string {
  const configBlock = buildConfigBlock(agentConfig);
  const credentialBlock = buildCredentialContext(agentConfig.credentials);
  const webhookBlock = JSON.stringify(context);
  return `<agent-config>\n${configBlock}\n</agent-config>\n\n${credentialBlock}\n\n<webhook-trigger>\n${webhookBlock}\n</webhook-trigger>\n\nA webhook event just fired. Review the trigger context above and take appropriate action.`;
}
