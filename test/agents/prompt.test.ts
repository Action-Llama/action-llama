import { describe, it, expect } from "vitest";
import {
  buildScheduledPrompt, buildWebhookPrompt, buildManualPrompt, buildCalledPrompt,
  buildCredentialContext, buildLockSkill, buildCallSkill, buildPromptSkeleton,
  buildScheduledSuffix, buildManualSuffix, buildCalledSuffix, buildWebhookSuffix,
} from "../../src/agents/prompt.js";
import type { WebhookContext } from "../../src/webhooks/types.js";
import { makeAgentConfig } from "../helpers.js";

const agentConfig = makeAgentConfig({
  name: "dev",
  params: { repos: ["acme/app"], triggerLabel: "agent", assignee: "bot" },
});

describe("buildCredentialContext", () => {
  it("includes github token context when credential present", () => {
    const result = buildCredentialContext(["github_token:default"]);
    expect(result).toContain("GITHUB_TOKEN");
    expect(result).toContain("gh");
    expect(result).toContain("credential-context");
  });

  it("includes sentry token context when credential present", () => {
    const result = buildCredentialContext(["github_token:default", "sentry_token:default"]);
    expect(result).toContain("SENTRY_AUTH_TOKEN");
    expect(result).toContain("curl");
  });

  it("documents git author identity when git_ssh credential present", () => {
    const result = buildCredentialContext(["github_token:default", "git_ssh:default"]);
    expect(result).toContain("GIT_AUTHOR_NAME");
    expect(result).toContain("GIT_SSH_COMMAND");
  });

  it("includes anti-exfiltration policy", () => {
    const result = buildCredentialContext(["github_token:default"]);
    expect(result).toContain("Anti-exfiltration");
    expect(result).toContain("NEVER output credentials");
    expect(result).toContain("al-shutdown");
  });
});

describe("buildScheduledPrompt", () => {
  it("includes agent-config block, credential context, and trigger text", () => {
    const result = buildScheduledPrompt(agentConfig);
    expect(result).toContain("<agent-config>");
    expect(result).toContain("</agent-config>");
    expect(result).toContain('"repos":["acme/app"]');
    expect(result).toContain('"triggerLabel":"agent"');
    expect(result).toContain('"assignee":"bot"');
    expect(result).toContain("<credential-context>");
    expect(result).toContain("GITHUB_TOKEN");
    expect(result).toContain("running on a schedule");
  });

  it("omits optional fields when not present", () => {
    const minimal: AgentConfig = {
      name: "test",
      credentials: [],
      model: { provider: "anthropic", model: "test", thinkingLevel: "off", authType: "api_key" },
    };
    const result = buildScheduledPrompt(minimal);
    expect(result).not.toContain("triggerLabel");
    expect(result).not.toContain("assignee");
    expect(result).not.toContain("sentryOrg");
  });

  it("does not include webhook-trigger block", () => {
    const result = buildScheduledPrompt(agentConfig);
    expect(result).not.toContain("<webhook-trigger>");
  });
});

describe("buildManualPrompt", () => {
  it("includes agent-config block, credential context, and manual trigger text", () => {
    const result = buildManualPrompt(agentConfig);
    expect(result).toContain("<agent-config>");
    expect(result).toContain("</agent-config>");
    expect(result).toContain("<credential-context>");
    expect(result).toContain("triggered manually");
  });

  it("does not include webhook-trigger block", () => {
    const result = buildManualPrompt(agentConfig);
    expect(result).not.toContain("<webhook-trigger>");
  });
});

describe("buildWebhookPrompt", () => {
  const webhookContext: WebhookContext = {
    source: "github",
    event: "issues",
    action: "labeled",
    repo: "acme/app",
    number: 42,
    title: "Fix the bug",
    body: "Description",
    url: "https://github.com/acme/app/issues/42",
    author: "dev1",
    assignee: "bot",
    labels: ["agent"],
    sender: "user1",
    timestamp: "2025-01-01T00:00:00.000Z",
  };

  it("includes agent-config, credential context, webhook-trigger, and trigger text", () => {
    const result = buildWebhookPrompt(agentConfig, webhookContext);
    expect(result).toContain("<agent-config>");
    expect(result).toContain("</agent-config>");
    expect(result).toContain("<credential-context>");
    expect(result).toContain("<webhook-trigger>");
    expect(result).toContain("</webhook-trigger>");
    expect(result).toContain('"event":"issues"');
    expect(result).toContain('"number":42');
    expect(result).toContain("webhook event just fired");
  });

  it("has sections in correct order: config, credentials, trigger, instruction", () => {
    const result = buildWebhookPrompt(agentConfig, webhookContext);
    const configIdx = result.indexOf("<agent-config>");
    const credIdx = result.indexOf("<credential-context>");
    const triggerIdx = result.indexOf("<webhook-trigger>");
    const instructionIdx = result.indexOf("webhook event just fired");
    expect(configIdx).toBeLessThan(credIdx);
    expect(credIdx).toBeLessThan(triggerIdx);
    expect(triggerIdx).toBeLessThan(instructionIdx);
  });
});

describe("buildCalledPrompt", () => {
  it("includes agent-config, credential context, agent-call, and instruction", () => {
    const result = buildCalledPrompt(agentConfig, "dev", "Please review PR #42");
    expect(result).toContain("<agent-config>");
    expect(result).toContain("</agent-config>");
    expect(result).toContain("<credential-context>");
    expect(result).toContain("<agent-call>");
    expect(result).toContain("</agent-call>");
    expect(result).toContain('"caller":"dev"');
    expect(result).toContain("Please review PR #42");
    expect(result).toContain('called by the "dev" agent');
  });
});

describe("buildLockSkill", () => {
  it("includes skill-lock tags", () => {
    const result = buildLockSkill();
    expect(result).toContain("<skill-lock>");
    expect(result).toContain("</skill-lock>");
  });

  it("documents rlock and runlock commands", () => {
    const result = buildLockSkill();
    expect(result).toContain("rlock");
    expect(result).toContain("runlock");
  });

  it("includes command usage examples", () => {
    const result = buildLockSkill();
    expect(result).toContain('rlock "github://acme/app/issues/42"');
    expect(result).toContain('runlock "github://acme/app/issues/42"');
  });

  it("documents conflict response", () => {
    const result = buildLockSkill();
    expect(result).toContain("ok");
    expect(result).toContain("holder");
  });

  it("documents rlock-heartbeat command", () => {
    const result = buildLockSkill();
    expect(result).toContain("rlock-heartbeat");
    expect(result).toContain('rlock-heartbeat "github://acme/app/issues/42"');
  });

  it("documents one-lock-at-a-time constraint", () => {
    const result = buildLockSkill();
    expect(result).toContain("one lock at a time");
  });
});

describe("buildCallSkill", () => {
  it("includes skill-call tags", () => {
    const result = buildCallSkill();
    expect(result).toContain("<skill-call>");
    expect(result).toContain("</skill-call>");
  });

  it("documents al-call, al-check, and al-wait commands", () => {
    const result = buildCallSkill();
    expect(result).toContain("al-call");
    expect(result).toContain("al-check");
    expect(result).toContain("al-wait");
  });

  it("documents al-return command", () => {
    const result = buildCallSkill();
    expect(result).toContain("al-return");
  });

  it("documents non-blocking nature", () => {
    const result = buildCallSkill();
    expect(result).toContain("non-blocking");
  });
});

describe("prompt skills integration", () => {
  it("includes lock skill in scheduled prompt when enabled", () => {
    const result = buildScheduledPrompt(agentConfig, { locking: true });
    expect(result).toContain("<skill-lock>");
    expect(result).toContain("rlock");
  });

  it("does not include lock skill when not enabled", () => {
    const result = buildScheduledPrompt(agentConfig);
    expect(result).not.toContain("<skill-lock>");
  });

  it("includes lock skill in webhook prompt when enabled", () => {
    const webhookContext: WebhookContext = {
      source: "github", event: "issues", action: "labeled",
      repo: "acme/app", number: 42, title: "Fix", body: "",
      url: "https://github.com/acme/app/issues/42",
      author: "dev1", assignee: "bot", labels: ["agent"],
      sender: "user1", timestamp: "2025-01-01T00:00:00.000Z",
    };
    const result = buildWebhookPrompt(agentConfig, webhookContext, { locking: true });
    expect(result).toContain("<skill-lock>");
  });

  it("includes lock skill in manual prompt when enabled", () => {
    const result = buildManualPrompt(agentConfig, { locking: true });
    expect(result).toContain("<skill-lock>");
  });

  it("includes lock skill in called prompt when enabled", () => {
    const result = buildCalledPrompt(agentConfig, "dev", "context", { locking: true });
    expect(result).toContain("<skill-lock>");
  });

  it("includes call skill in scheduled prompt when enabled", () => {
    const result = buildScheduledPrompt(agentConfig, { calling: true });
    expect(result).toContain("<skill-call>");
    expect(result).toContain("al-call");
  });

  it("does not include call skill when not enabled", () => {
    const result = buildScheduledPrompt(agentConfig);
    expect(result).not.toContain("<skill-call>");
  });

  it("places lock skill between credentials and trigger instruction", () => {
    const result = buildScheduledPrompt(agentConfig, { locking: true });
    const credIdx = result.indexOf("</credential-context>");
    const skillIdx = result.indexOf("<skill-lock>");
    const instructionIdx = result.indexOf("running on a schedule");
    expect(credIdx).toBeLessThan(skillIdx);
    expect(skillIdx).toBeLessThan(instructionIdx);
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

  it("full prompt equals skeleton + suffix", () => {
    const skeleton = buildPromptSkeleton(agentConfig);
    const suffix = buildScheduledSuffix();
    const full = buildScheduledPrompt(agentConfig);
    expect(full).toBe(`${skeleton}\n\n${suffix}`);
  });
});

describe("environment context", () => {
  it("sets working directory to /app/static for agent file access", () => {
    const result = buildScheduledPrompt(agentConfig);
    expect(result).toContain("/app/static");
    expect(result).toContain("ACTIONS.md");
  });

  it("instructs writes to /tmp", () => {
    const result = buildScheduledPrompt(agentConfig);
    expect(result).toContain("write operations");
    expect(result).toContain("/tmp");
  });
});

describe("prompt suffix functions", () => {
  it("buildScheduledSuffix returns schedule text", () => {
    expect(buildScheduledSuffix()).toContain("running on a schedule");
  });

  it("buildManualSuffix returns manual text", () => {
    expect(buildManualSuffix()).toContain("triggered manually");
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
