import { describe, it, expect } from "vitest";
import {
  buildCredentialContext, buildLockSkill, buildSubagentSkill, buildPromptSkeleton,
  buildScheduledSuffix, buildManualSuffix, buildCalledSuffix, buildWebhookSuffix,
  buildUserPromptSuffix, buildAgentSystemPrompt,
} from "../../src/agents/prompt.js";
import type { WebhookContext } from "../../src/webhooks/types.js";
import { makeAgentConfig } from "../helpers.js";

const agentConfig = makeAgentConfig({
  name: "dev",
  params: { repos: ["acme/app"], triggerLabel: "agent", assignee: "bot" },
});

describe("buildCredentialContext", () => {
  it("includes github token context when credential present", () => {
    const result = buildCredentialContext(["github_token"]);
    expect(result).toContain("GITHUB_TOKEN");
    expect(result).toContain("gh");
    expect(result).toContain("credential-context");
  });

  it("includes sentry token context when credential present", () => {
    const result = buildCredentialContext(["github_token", "sentry_token"]);
    expect(result).toContain("SENTRY_AUTH_TOKEN");
    expect(result).toContain("curl");
  });

  it("documents git author identity when git_ssh credential present", () => {
    const result = buildCredentialContext(["github_token", "git_ssh"]);
    expect(result).toContain("GIT_AUTHOR_NAME");
    expect(result).toContain("GIT_SSH_COMMAND");
  });

  it("includes anti-exfiltration policy", () => {
    const result = buildCredentialContext(["github_token"]);
    expect(result).toContain("Anti-exfiltration");
    expect(result).toContain("NEVER output credentials");
    expect(result).toContain("stop all work immediately");
  });
});

describe("buildLockSkill", () => {
  it("includes skill-lock tags", () => {
    const result = buildLockSkill();
    expect(result).toContain("<skill-lock>");
    expect(result).toContain("</skill-lock>");
  });

  it("references acquire_lock and release_lock tools", () => {
    const result = buildLockSkill();
    expect(result).toContain("acquire_lock");
    expect(result).toContain("release_lock");
  });

  it("documents one-lock-at-a-time constraint", () => {
    const result = buildLockSkill();
    expect(result).toContain("at most one lock at a time");
  });

  it("documents URI requirement for resource keys", () => {
    const result = buildLockSkill();
    expect(result).toContain("valid URIs");
  });

  it("instructs to skip resource on lock failure", () => {
    const result = buildLockSkill();
    expect(result).toContain("skip that resource");
  });
});

describe("buildSubagentSkill", () => {
  it("includes skill-subagent tags", () => {
    const result = buildSubagentSkill();
    expect(result).toContain("<skill-subagent>");
    expect(result).toContain("</skill-subagent>");
  });

  it("references call_agent, check_call, and return_value tools", () => {
    const result = buildSubagentSkill();
    expect(result).toContain("call_agent");
    expect(result).toContain("check_call");
    expect(result).toContain("return_value");
  });

  it("documents non-blocking nature", () => {
    const result = buildSubagentSkill();
    expect(result).toContain("non-blocking");
  });

  it("includes available agents catalog when provided", () => {
    const result = buildSubagentSkill([
      { name: "researcher", description: "Searches for competitive intelligence" },
      { name: "reviewer", description: "Reviews pull requests" },
    ]);
    expect(result).toContain("### Available Agents");
    expect(result).toContain("**researcher**: Searches for competitive intelligence");
    expect(result).toContain("**reviewer**: Reviews pull requests");
  });

  it("omits available agents section when empty", () => {
    const result = buildSubagentSkill([]);
    expect(result).not.toContain("### Available Agents");
  });
});

describe("buildPromptSkeleton", () => {
  it("contains agent-config and credential-context blocks", () => {
    const result = buildPromptSkeleton(agentConfig);
    expect(result).toContain("<agent-config>");
    expect(result).toContain("</agent-config>");
    expect(result).toContain("<credential-context>");
    expect(result).toContain("</credential-context>");
  });

  it("does not contain trigger-specific text", () => {
    const result = buildPromptSkeleton(agentConfig);
    expect(result).not.toContain("running on a schedule");
    expect(result).not.toContain("triggered manually");
    expect(result).not.toContain("<webhook-trigger>");
    expect(result).not.toContain("<agent-trigger>");
  });

  it("includes skills when provided", () => {
    const result = buildPromptSkeleton(agentConfig, { locking: true });
    expect(result).toContain("<skill-lock>");
  });

});

describe("host-user environment context", () => {
  it("does not mention /app/static or read-only root filesystem", () => {
    const result = buildPromptSkeleton(agentConfig, { hostUser: true });
    expect(result).not.toContain("/app/static");
    expect(result).not.toContain("The root filesystem is read-only");
  });

  it("describes writable filesystem and CWD", () => {
    const result = buildPromptSkeleton(agentConfig, { hostUser: true });
    expect(result).toContain("writable");
    expect(result).toContain("current directory");
  });

  it("uses $AL_CREDENTIALS_PATH instead of /credentials/", () => {
    const result = buildPromptSkeleton(agentConfig, { hostUser: true });
    expect(result).toContain("$AL_CREDENTIALS_PATH");
    expect(result).not.toContain("`/credentials/`");
  });

  it("still includes credential env vars and anti-exfiltration policy", () => {
    const result = buildPromptSkeleton(agentConfig, { hostUser: true });
    expect(result).toContain("GITHUB_TOKEN");
    expect(result).toContain("Anti-exfiltration");
  });

  it("docker mode still references /credentials/", () => {
    const result = buildPromptSkeleton(agentConfig);
    expect(result).toContain("`/credentials/`");
    expect(result).not.toContain("$AL_CREDENTIALS_PATH");
  });
});

describe("prompt suffix functions", () => {
  it("buildScheduledSuffix returns schedule text", () => {
    expect(buildScheduledSuffix()).toContain("running on a schedule");
  });

  it("buildManualSuffix returns manual text", () => {
    expect(buildManualSuffix()).toContain("triggered manually");
  });

  it("buildUserPromptSuffix wraps prompt in user-prompt tags", () => {
    const result = buildUserPromptSuffix("review PR #42");
    expect(result).toContain("<user-prompt>");
    expect(result).toContain("review PR #42");
    expect(result).toContain("</user-prompt>");
    expect(result).toContain("specific task");
    expect(result).toContain("Complete the task");
    expect(result).not.toContain("triggered manually");
  });

  it("buildCalledSuffix includes agent-call block", () => {
    const result = buildCalledSuffix("dev", "Please review PR #42");
    expect(result).toContain("<agent-call>");
    expect(result).toContain('"caller":"dev"');
    expect(result).toContain("Please review PR #42");
  });

  it("buildWebhookSuffix includes webhook-trigger block", () => {
    const context: WebhookContext = {
      source: "github", event: "issues", action: "labeled",
      repo: "acme/app", number: 42, title: "Fix", body: "",
      url: "https://github.com/acme/app/issues/42",
      author: "dev1", assignee: "bot", labels: ["agent"],
      sender: "user1", timestamp: "2025-01-01T00:00:00.000Z",
    };
    const result = buildWebhookSuffix(context);
    expect(result).toContain("<webhook-trigger>");
    expect(result).toContain('"event":"issues"');
  });
});

describe("buildAgentSystemPrompt", () => {
  it("contains a concise preamble", () => {
    const result = buildAgentSystemPrompt(agentConfig);
    expect(result).toContain("autonomous coding agent");
    expect(result).toContain("Be concise");
  });

  it("contains the full skeleton (agent-config, credentials, environment)", () => {
    const result = buildAgentSystemPrompt(agentConfig);
    expect(result).toContain("<agent-config>");
    expect(result).toContain("</agent-config>");
    expect(result).toContain("<credential-context>");
    expect(result).toContain("</credential-context>");
    expect(result).toContain("<environment>");
    expect(result).toContain("</environment>");
  });

  it("includes skills when provided", () => {
    const result = buildAgentSystemPrompt(agentConfig, { locking: true });
    expect(result).toContain("<skill-lock>");
    expect(result).toContain("acquire_lock");
  });

  it("does not contain Pi-specific boilerplate", () => {
    const result = buildAgentSystemPrompt(agentConfig);
    expect(result).not.toContain("pi, a coding agent harness");
    expect(result).not.toContain("Pi documentation");
  });

  it("does not contain trigger-specific text", () => {
    const result = buildAgentSystemPrompt(agentConfig);
    expect(result).not.toContain("running on a schedule");
    expect(result).not.toContain("triggered manually");
    expect(result).not.toContain("<webhook-trigger>");
  });

  it("respects hostUser skill flag for environment context", () => {
    const result = buildAgentSystemPrompt(agentConfig, { hostUser: true });
    expect(result).toContain("writable");
    expect(result).not.toContain("/app/static");
  });
});
