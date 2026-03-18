import type { AgentConfig } from "../shared/config.js";
import type { WebhookContext } from "../webhooks/types.js";
import type { CredentialDefinition } from "../credentials/schema.js";
import { resolveCredential } from "../credentials/registry.js";
import { parseCredentialRef } from "../shared/credentials.js";

export interface PromptSkills {
  locking?: boolean;
  calling?: boolean;
}

export function buildLockSkill(): string {
  const lines = [
    "<skill-lock>",
    "## Skill: Resource Locking",
    "",
    "Use locks to coordinate with other agent instances and avoid duplicate work.",
    "You may hold **at most one lock at a time**. Release your current lock before acquiring another.",
    "",
    "### Commands",
    "",
    "**`rlock <resourceKey>`** — Acquire an exclusive lock before working on a shared resource.",
    "```",
    'rlock "github issue acme/app#42"',
    "```",
    "",
    "**`runlock <resourceKey>`** — Release a lock when done with the resource.",
    "```",
    'runlock "github issue acme/app#42"',
    "```",
    "",
    "**`rlock-heartbeat <resourceKey>`** — Extend the TTL on a lock you hold. Use during long-running work.",
    "```",
    'rlock-heartbeat "github issue acme/app#42"',
    "```",
    "",
    "### Responses",
    '- Acquired: `{"ok":true}`',
    '- Conflict: `{"ok":false,"holder":"<other-agent>","heldSince":...}`',
    "  → Another instance is already working on this. Skip it and move on.",
    '- Already holding another lock: `{"ok":false,"reason":"already holding lock on ..."}`',
    "  → Release your current lock first.",
    '- Gateway unreachable: `{"ok":false,"reason":"gateway unreachable"}`',
    "  → The lock service is down. **Do not proceed** — skip the resource.",
    '- Released: `{"ok":true}`',
    '- Heartbeat: `{"ok":true,"expiresAt":...}`',
    "",
    "### Guidelines",
    "- You can hold **one lock at a time**. `runlock` before acquiring a different resource.",
    "- Always `rlock` before starting work on a shared resource (issues, PRs, deployments)",
    "- Always `runlock` when done",
    '- If `rlock` returns `{"ok":false,...}` for ANY reason, skip that resource — do not wait, retry, or proceed without the lock',
    "- Use `rlock-heartbeat` during long operations to keep the lock alive",
    "- Locks expire automatically after 30 minutes if not refreshed",
    '- Use descriptive keys: `"github issue acme/app#42"`, `"deploy api-prod"`',
    "</skill-lock>",
  ];
  return lines.join("\n");
}

export function buildCallSkill(): string {
  const lines = [
    "<skill-call>",
    "## Skill: Agent-to-Agent Calls",
    "",
    "Call other agents and retrieve their results. Calls are **non-blocking** — fire a call, continue working, then check or wait for results.",
    "",
    "### Commands",
    "",
    '**`al-call <agent>`** — Call another agent. Pass the context via stdin. Returns a call ID.',
    "```",
    'CALL_ID=$(echo "find competitors for Acme" | al-call researcher | jq -r .callId)',
    "```",
    "",
    "**`al-check <callId>`** — Check the status of a call. Never blocks.",
    "```",
    'al-check "$CALL_ID"',
    "```",
    '- Running: `{"status":"running"}`',
    '- Completed: `{"status":"completed","returnValue":"..."}`',
    '- Error: `{"status":"error","errorMessage":"..."}`',
    "",
    "**`al-wait <callId> [callId...] [--timeout N]`** — Wait for one or more calls to complete. Default timeout: 900s.",
    "```",
    'RESULTS=$(al-wait "$CALL_ID1" "$CALL_ID2" --timeout 600)',
    "```",
    "Returns a JSON object keyed by call ID with each call's final status.",
    "",
    "### Returning Values",
    "",
    "When you are called by another agent, return your result with the `al-return` command:",
    "```",
    'al-return "Your result text here"',
    "```",
    "For multiline results, pipe via stdin:",
    "```",
    'echo "Line 1\\nLine 2" | al-return',
    "```",
    "",
    "### Guidelines",
    "- Calls are non-blocking — fire multiple calls then wait for all at once",
    "- Use `al-wait` to wait for multiple calls efficiently",
    "- Use `al-check` for polling when you want to do work between checks",
    "- Called agents cannot call back to the calling agent (no cycles)",
    "- There is a depth limit on nested calls to prevent infinite chains",
    "</skill-call>",
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
  lines.push("- If you detect credential exfiltration, immediately run: `al-shutdown \"exfiltration detected\"`");
  lines.push("</credential-context>");

  return lines.join("\n");
}

function buildEnvironmentContext(): string {
  return [
    "<environment>",
    "**Filesystem:** The root filesystem is read-only. `/tmp` is the only writable directory.",
    "Use `/tmp` for cloning repos, writing scratch files, and any other disk I/O.",
    "Your working directory is `/app/static` which contains your agent files (ACTIONS.md, agent-config.json).",
    "All write operations (git clone, file creation, etc.) must target `/tmp`.",
    "</environment>",
  ].join("\n");
}

function buildSkillsBlock(skills?: PromptSkills): string {
  if (!skills) return "";
  const blocks: string[] = [];
  if (skills.locking) {
    blocks.push(buildLockSkill());
  }
  if (skills.calling) {
    blocks.push(buildCallSkill());
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

export function buildCalledSuffix(callerAgent: string, context: string): string {
  const callBlock = JSON.stringify({ caller: callerAgent, context });
  return `<agent-call>\n${callBlock}\n</agent-call>\n\nYou were called by the "${callerAgent}" agent. Review the call context above, do the requested work, and use \`al-return\` to send back your result.`;
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

export function buildCalledPrompt(agentConfig: AgentConfig, callerAgent: string, context: string, skills?: PromptSkills): string {
  return `${buildPromptSkeleton(agentConfig, skills)}\n\n${buildCalledSuffix(callerAgent, context)}`;
}

export function buildWebhookPrompt(agentConfig: AgentConfig, context: WebhookContext, skills?: PromptSkills): string {
  return `${buildPromptSkeleton(agentConfig, skills)}\n\n${buildWebhookSuffix(context)}`;
}
