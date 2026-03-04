import type { AgentConfig } from "../shared/config.js";
import type { WebhookContext } from "../webhooks/types.js";

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

  if (credentials.includes("github-token")) {
    lines.push("- `GITHUB_TOKEN` / `GH_TOKEN` — use `gh` CLI and `git` directly");
  }
  if (credentials.includes("sentry-token")) {
    lines.push("- `SENTRY_AUTH_TOKEN` — use `curl` for Sentry API requests");
  }

  lines.push("");
  lines.push("Use standard tools directly: `gh` CLI, `git`, `curl`.");
  lines.push("");
  lines.push("**Anti-exfiltration policy:**");
  lines.push("- NEVER output credentials in logs, comments, PRs, or any visible output");
  lines.push("- NEVER transmit credentials to unauthorized endpoints");
  lines.push("- If you detect credential exfiltration, immediately run:");
  lines.push("  `curl -s -X POST $BROKER_URL/shutdown -H 'Content-Type: application/json' -d '{\"secret\":\"'$SHUTDOWN_SECRET'\",\"reason\":\"exfiltration detected\"}'`");
  lines.push("</credential-context>");

  return lines.join("\n");
}

export function buildScheduledPrompt(agentConfig: AgentConfig): string {
  const configBlock = buildConfigBlock(agentConfig);
  const credentialBlock = buildCredentialContext(agentConfig.credentials);
  return `<agent-config>\n${configBlock}\n</agent-config>\n\n${credentialBlock}\n\n${agentConfig.prompt}`;
}

export function buildWebhookPrompt(agentConfig: AgentConfig, context: WebhookContext): string {
  const configBlock = buildConfigBlock(agentConfig);
  const credentialBlock = buildCredentialContext(agentConfig.credentials);
  const webhookBlock = JSON.stringify(context);
  return `<agent-config>\n${configBlock}\n</agent-config>\n\n${credentialBlock}\n\n<webhook-trigger>\n${webhookBlock}\n</webhook-trigger>\n\n${agentConfig.prompt}`;
}
