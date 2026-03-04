import { describe, it, expect } from "vitest";
import { buildScheduledPrompt, buildWebhookPrompt, buildCredentialContext } from "../../src/agents/prompt.js";
import type { AgentConfig } from "../../src/shared/config.js";
import type { WebhookContext } from "../../src/webhooks/types.js";

const agentConfig: AgentConfig = {
  name: "dev",
  credentials: ["github-token"],
  model: { provider: "anthropic", model: "claude-sonnet-4-20250514", thinkingLevel: "medium", authType: "api_key" },
  schedule: "*/5 * * * *",
  prompt: "Do development work.",
  repos: ["acme/app"],
  params: { triggerLabel: "agent", assignee: "bot" },
};

describe("buildCredentialContext", () => {
  it("includes github token context when credential present", () => {
    const result = buildCredentialContext(["github-token"]);
    expect(result).toContain("GITHUB_TOKEN");
    expect(result).toContain("gh");
    expect(result).toContain("credential-context");
  });

  it("includes sentry token context when credential present", () => {
    const result = buildCredentialContext(["github-token", "sentry-token"]);
    expect(result).toContain("SENTRY_AUTH_TOKEN");
    expect(result).toContain("curl");
  });

  it("includes anti-exfiltration policy", () => {
    const result = buildCredentialContext(["github-token"]);
    expect(result).toContain("Anti-exfiltration");
    expect(result).toContain("NEVER output credentials");
    expect(result).toContain("/shutdown");
  });
});

describe("buildScheduledPrompt", () => {
  it("includes agent-config block, credential context, and prompt", () => {
    const result = buildScheduledPrompt(agentConfig);
    expect(result).toContain("<agent-config>");
    expect(result).toContain("</agent-config>");
    expect(result).toContain('"repos":["acme/app"]');
    expect(result).toContain('"triggerLabel":"agent"');
    expect(result).toContain('"assignee":"bot"');
    expect(result).toContain("<credential-context>");
    expect(result).toContain("GITHUB_TOKEN");
    expect(result).toContain("Do development work.");
  });

  it("omits optional fields when not present", () => {
    const minimal: AgentConfig = {
      name: "test",
      credentials: [],
      model: { provider: "anthropic", model: "test", thinkingLevel: "off", authType: "api_key" },
      prompt: "test prompt",
      repos: ["r/r"],
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

  it("includes agent-config, credential context, webhook-trigger, and prompt", () => {
    const result = buildWebhookPrompt(agentConfig, webhookContext);
    expect(result).toContain("<agent-config>");
    expect(result).toContain("</agent-config>");
    expect(result).toContain("<credential-context>");
    expect(result).toContain("<webhook-trigger>");
    expect(result).toContain("</webhook-trigger>");
    expect(result).toContain('"event":"issues"');
    expect(result).toContain('"number":42');
    expect(result).toContain("Do development work.");
  });

  it("has sections in correct order: config, credentials, trigger, prompt", () => {
    const result = buildWebhookPrompt(agentConfig, webhookContext);
    const configIdx = result.indexOf("<agent-config>");
    const credIdx = result.indexOf("<credential-context>");
    const triggerIdx = result.indexOf("<webhook-trigger>");
    const promptIdx = result.indexOf("Do development work.");
    expect(configIdx).toBeLessThan(credIdx);
    expect(credIdx).toBeLessThan(triggerIdx);
    expect(triggerIdx).toBeLessThan(promptIdx);
  });
});
