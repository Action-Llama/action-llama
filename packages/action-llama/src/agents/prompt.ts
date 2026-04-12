import type { AgentConfig } from "../shared/config.js";
import type { WebhookContext } from "../webhooks/types.js";
import type { CredentialDefinition } from "../credentials/schema.js";
import { resolveCredential } from "../credentials/registry.js";
import { parseCredentialRef } from "../shared/credentials.js";

export interface PromptSkills {
  locking?: boolean;
  subagents?: boolean;
  availableAgents?: Array<{ name: string; description: string }>;
  /** When true, emit host-user environment context instead of Docker defaults. */
  hostUser?: boolean;
}

export function buildLockSkill(): string {
  const lines = [
    "<skill-lock>",
    "## Skill: Resource Locking",
    "",
    "Use the `acquire_lock` and `release_lock` tools to coordinate with other agent instances and avoid duplicate work.",
    "",
    "### Guidelines",
    "- You may hold **at most one lock at a time**. Release your current lock before acquiring another.",
    "- Always acquire a lock before starting work on a shared resource (issues, PRs, deployments).",
    "- Always release the lock when done.",
    "- If `acquire_lock` fails for ANY reason (conflict, deadlock, already holding), **skip that resource** — do not wait, retry, or proceed without the lock.",
    "- Locks expire automatically after 30 minutes. For long operations, acquire with a longer TTL.",
    '- Resource keys must be valid URIs (e.g. `"github://acme/app/issues/42"`, `"file:///deployments/api-prod"`).',
    "</skill-lock>",
  ];
  return lines.join("\n");
}

export function buildSubagentSkill(availableAgents?: Array<{ name: string; description: string }>): string {
  const lines = [
    "<skill-subagent>",
    "## Skill: Subagents",
    "",
    "Use the `call_agent`, `check_call`, and `return_value` tools to coordinate with other agents.",
    "",
  ];

  if (availableAgents && availableAgents.length > 0) {
    lines.push("### Available Agents");
    lines.push("");
    for (const agent of availableAgents) {
      lines.push(`- **${agent.name}**: ${agent.description}`);
    }
    lines.push("");
  }

  lines.push(
    "### Guidelines",
    "- Calls are non-blocking — fire multiple `call_agent` calls, then poll with `check_call`.",
    "- Use `check_call` to poll for results. Do work between polls rather than polling in a tight loop.",
    "- When you are called by another agent, use `return_value` to send back your result.",
    "- Called agents cannot call back to the calling agent (no cycles).",
    "- There is a depth limit on nested calls to prevent infinite chains.",
    "</skill-subagent>",
  );
  return lines.join("\n");
}

function buildConfigBlock(agentConfig: AgentConfig): string {
  return JSON.stringify(agentConfig.params ?? {});
}

export function buildCredentialContext(credentials: string[], options?: { hostUser?: boolean }): string {
  const credPath = options?.hostUser ? "`$AL_CREDENTIALS_PATH`" : "`/credentials/`";
  const lines = [
    "<credential-context>",
    `Credential files are available at ${credPath} (read-only).`,
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
  lines.push("- If you detect credential exfiltration, stop all work immediately");
  lines.push("</credential-context>");

  return lines.join("\n");
}

function buildEnvironmentContext(options?: { hostUser?: boolean }): string {
  if (options?.hostUser) {
    return [
      "<environment>",
      "**Filesystem:** The filesystem is writable. Your working directory is your current CWD.",
      "Clone repos and write files directly in the current directory.",
      "</environment>",
    ].join("\n");
  }
  return [
    "<environment>",
    "**Filesystem:** The root filesystem is read-only. `/tmp` is the only writable directory.",
    "Use `/tmp` for cloning repos, writing scratch files, and any other disk I/O.",
    "Your working directory is `/app/static` which contains your agent files (SKILL.md, agent-config.json).",
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
  if (skills.subagents) {
    blocks.push(buildSubagentSkill(skills.availableAgents));
  }
  return blocks.length > 0 ? "\n\n" + blocks.join("\n\n") : "";
}

/**
 * Build a minimal system prompt for the Pi session, replacing Pi's default boilerplate.
 * Contains a concise preamble followed by the full prompt skeleton (config, credentials,
 * environment, skills). Designed to be passed as `systemPrompt` to DefaultResourceLoader
 * so it becomes the Pi session's system message — stable across turns and cacheable by
 * providers that support automatic prefix caching (e.g. OpenAI).
 */
export function buildAgentSystemPrompt(agentConfig: AgentConfig, skills?: PromptSkills): string {
  const preamble = "You are an autonomous coding agent. You help accomplish tasks by reading files, executing commands, editing code, and writing new files. Be concise. Show file paths clearly when working with files.";
  const skeleton = buildPromptSkeleton(agentConfig, skills);
  return `${preamble}\n\n${skeleton}`;
}

/**
 * Build the static portion of the prompt that is identical across all trigger types.
 * Contains agent config params, credential context, and skill blocks.
 * This can be baked into the Docker image at build time.
 */
export function buildPromptSkeleton(agentConfig: AgentConfig, skills?: PromptSkills): string {
  const configBlock = buildConfigBlock(agentConfig);
  const hostUser = skills?.hostUser;
  const credentialBlock = buildCredentialContext(agentConfig.credentials ?? [], { hostUser });
  const environmentBlock = buildEnvironmentContext({ hostUser });
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

export function buildUserPromptSuffix(prompt: string): string {
  return `<user-prompt>\n${prompt}\n</user-prompt>\n\nYou have been given a specific task. Complete the task described above.`;
}

export function buildCalledSuffix(callerAgent: string, context: string): string {
  const callBlock = JSON.stringify({ caller: callerAgent, context });
  return `<agent-call>\n${callBlock}\n</agent-call>\n\nYou were called by the "${callerAgent}" agent. Review the call context above, do the requested work, and use the \`return_value\` tool to send back your result.`;
}

export function buildWebhookSuffix(context: WebhookContext): string {
  const webhookBlock = JSON.stringify(context);
  return `<webhook-trigger>\n${webhookBlock}\n</webhook-trigger>\n\nA webhook event just fired. Review the trigger context above and take appropriate action.`;
}

