import { describe, it, expect } from "vitest";
import { buildScheduledPrompt, buildWebhookPrompt, buildManualPrompt, buildTriggeredPrompt, buildCredentialContext, buildLockSkill } from "../../src/agents/prompt.js";
import type { AgentConfig } from "../../src/shared/config.js";
import type { WebhookContext } from "../../src/webhooks/types.js";

const agentConfig: AgentConfig = {
  name: "dev",
  credentials: ["github_token:default"],
  model: { provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium", authType: "api_key" },
  schedule: "*/5 * * * *",
  params: { repos: ["acme/app"], triggerLabel: "agent", assignee: "bot" },
};

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
    expect(result).toContain("/shutdown");
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

describe("buildTriggeredPrompt", () => {
  it("includes agent-config, credential context, agent-trigger, and instruction", () => {
    const result = buildTriggeredPrompt(agentConfig, "dev", "Please review PR #42");
    expect(result).toContain("<agent-config>");
    expect(result).toContain("</agent-config>");
    expect(result).toContain("<credential-context>");
    expect(result).toContain("<agent-trigger>");
    expect(result).toContain("</agent-trigger>");
    expect(result).toContain('"source":"dev"');
    expect(result).toContain("Please review PR #42");
    expect(result).toContain('triggered by the "dev" agent');
  });
});

describe("buildLockSkill", () => {
  it("includes skill-lock tags", () => {
    const result = buildLockSkill();
    expect(result).toContain("<skill-lock>");
    expect(result).toContain("</skill-lock>");
  });

  it("documents LOCK and UNLOCK operations", () => {
    const result = buildLockSkill();
    expect(result).toContain("LOCK(resource, key)");
    expect(result).toContain("UNLOCK(resource, key)");
  });

  it("includes curl examples with gateway vars", () => {
    const result = buildLockSkill();
    expect(result).toContain("$GATEWAY_URL/locks/acquire");
    expect(result).toContain("$GATEWAY_URL/locks/release");
    expect(result).toContain("$SHUTDOWN_SECRET");
  });

  it("documents conflict response", () => {
    const result = buildLockSkill();
    expect(result).toContain("409");
    expect(result).toContain("holder");
  });

  it("documents HEARTBEAT operation", () => {
    const result = buildLockSkill();
    expect(result).toContain("HEARTBEAT(resource, key)");
    expect(result).toContain("$GATEWAY_URL/locks/heartbeat");
  });

  it("documents one-lock-at-a-time constraint", () => {
    const result = buildLockSkill();
    expect(result).toContain("one lock at a time");
  });
});

describe("prompt skills integration", () => {
  it("includes lock skill in scheduled prompt when enabled", () => {
    const result = buildScheduledPrompt(agentConfig, { locking: true });
    expect(result).toContain("<skill-lock>");
    expect(result).toContain("LOCK(resource, key)");
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

  it("includes lock skill in triggered prompt when enabled", () => {
    const result = buildTriggeredPrompt(agentConfig, "dev", "context", { locking: true });
    expect(result).toContain("<skill-lock>");
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
