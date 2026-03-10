import type { AgentConfig } from "../shared/config.js";
import type { WebhookContext } from "../webhooks/types.js";
import type { CredentialDefinition } from "../credentials/schema.js";
import { resolveCredential } from "../credentials/registry.js";
import { parseCredentialRef } from "../shared/credentials.js";

export interface PromptSkills {
  locking?: boolean;
}

export function buildLockSkill(): string {
  const lines = [
    "<skill-lock>",
    "## Skill: Resource Locking",
    "",
    "Use locks to coordinate with other agent instances and avoid duplicate work.",
    "You may hold **at most one lock at a time**. Release your current lock before acquiring another.",
    "",
    "### LOCK(resourceKey)",
    "Acquire an exclusive lock before working on a shared resource.",
    "```",
    'curl -s -X POST $GATEWAY_URL/locks/acquire \\',
    "  -H 'Content-Type: application/json' \\",
    `  -d '{"secret":"'$SHUTDOWN_SECRET'","resourceKey":"<resourceKey>"}'`,
    "```",
    "",
    "### UNLOCK(resourceKey)",
    "Release a lock when done with the resource.",
    "```",
    'curl -s -X POST $GATEWAY_URL/locks/release \\',
    "  -H 'Content-Type: application/json' \\",
    `  -d '{"secret":"'$SHUTDOWN_SECRET'","resourceKey":"<resourceKey>"}'`,
    "```",
    "",
    "### HEARTBEAT(resourceKey)",
    "Extend the TTL on a lock you hold. Use this during long-running work to prevent expiry.",
    "```",
    'curl -s -X POST $GATEWAY_URL/locks/heartbeat \\',
    "  -H 'Content-Type: application/json' \\",
    `  -d '{"secret":"'$SHUTDOWN_SECRET'","resourceKey":"<resourceKey>"}'`,
    "```",
    "",
    "### Responses",
    '- Acquired: `{"ok":true,"resourceKey":"..."}`',
    '- Conflict: `{"ok":false,"holder":"<other-agent>","heldSince":...}` (HTTP 409)',
    "  → Another instance is already working on this. Skip it and move on.",
    '- Already holding another lock: `{"ok":false,"reason":"already holding lock on ..."}` (HTTP 409)',
    "  → Release your current lock first.",
    '- Released: `{"ok":true}`',
    '- Heartbeat: `{"ok":true,"expiresAt":...}`',
    "",
    "### Guidelines",
    "- You can hold **one lock at a time**. UNLOCK before acquiring a different resource.",
    "- Always LOCK before starting work on a shared resource (issues, PRs, deployments)",
    "- Always UNLOCK when done",
    "- If a LOCK fails, skip that resource — do not wait or retry",
    "- Use HEARTBEAT during long operations to keep the lock alive",
    "- Locks expire automatically after 30 minutes if not refreshed",
    '- Use descriptive keys: `"github issue acme/app#42"`, `"deploy api-prod"`',
    "</skill-lock>",
  ];
  return lines.join("\n");
}

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

function buildEnvironmentContext(): string {
  return [
    "<environment>",
    "**Filesystem:** The root filesystem is read-only. `/tmp` is the only writable directory.",
    "Use `/tmp` for cloning repos, writing scratch files, and any other disk I/O.",
    "Your working directory is `/tmp`.",
    "</environment>",
  ].join("\n");
}

function buildSkillsBlock(skills?: PromptSkills): string {
  if (!skills) return "";
  const blocks: string[] = [];
  if (skills.locking) {
    blocks.push(buildLockSkill());
  }
  return blocks.length > 0 ? "\n\n" + blocks.join("\n\n") : "";
}

/**
 * Build the static portion of the prompt that is identical across all trigger types.
 * Contains agent config params, credential context, and skill blocks.
 * This can be baked into the Docker image at build time.
 */
export function buildPromptSkeleton(agentConfig: AgentConfig, skills?: PromptSkills): string {
  const configBlock = buildConfigBlock(agentConfig);
  const credentialBlock = buildCredentialContext(agentConfig.credentials);
  const environmentBlock = buildEnvironmentContext();
  const skillsBlock = buildSkillsBlock(skills);
  return `<agent-config>\n${configBlock}\n</agent-config>\n\n${credentialBlock}\n\n${environmentBlock}${skillsBlock}`;
}

/**
 * Build the dynamic suffix for a specific trigger type.
 * This is the only part that needs to be passed at runtime.
 */
export function buildScheduledSuffix(): string {
  return "You are running on a schedule. Check for new work and act on anything you find.";
}

export function buildManualSuffix(): string {
  return "You have been triggered manually. Check for new work and act on anything you find.";
}

export function buildTriggeredSuffix(sourceAgent: string, context: string): string {
  const triggerBlock = JSON.stringify({ source: sourceAgent, context });
  return `<agent-trigger>\n${triggerBlock}\n</agent-trigger>\n\nYou were triggered by the "${sourceAgent}" agent. Review the trigger context above and take appropriate action.`;
}

export function buildWebhookSuffix(context: WebhookContext): string {
  const webhookBlock = JSON.stringify(context);
  return `<webhook-trigger>\n${webhookBlock}\n</webhook-trigger>\n\nA webhook event just fired. Review the trigger context above and take appropriate action.`;
}

export function buildScheduledPrompt(agentConfig: AgentConfig, skills?: PromptSkills): string {
  return `${buildPromptSkeleton(agentConfig, skills)}\n\n${buildScheduledSuffix()}`;
}

export function buildManualPrompt(agentConfig: AgentConfig, skills?: PromptSkills): string {
  return `${buildPromptSkeleton(agentConfig, skills)}\n\n${buildManualSuffix()}`;
}

export function buildTriggeredPrompt(agentConfig: AgentConfig, sourceAgent: string, context: string, skills?: PromptSkills): string {
  return `${buildPromptSkeleton(agentConfig, skills)}\n\n${buildTriggeredSuffix(sourceAgent, context)}`;
}

export function buildWebhookPrompt(agentConfig: AgentConfig, context: WebhookContext, skills?: PromptSkills): string {
  return `${buildPromptSkeleton(agentConfig, skills)}\n\n${buildWebhookSuffix(context)}`;
}
