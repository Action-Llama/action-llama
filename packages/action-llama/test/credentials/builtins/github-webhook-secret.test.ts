/**
 * Unit test for credentials/builtins/github-webhook-secret.ts
 */
import { describe, it, expect } from "vitest";
import githubWebhookSecret from "../../../src/credentials/builtins/github-webhook-secret.js";

describe("github-webhook-secret credential definition", () => {
  it("has id 'github_webhook_secret'", () => {
    expect(githubWebhookSecret.id).toBe("github_webhook_secret");
  });

  it("has exactly one field: secret", () => {
    expect(githubWebhookSecret.fields).toHaveLength(1);
    expect(githubWebhookSecret.fields[0].name).toBe("secret");
    expect(githubWebhookSecret.fields[0].secret).toBe(true);
  });

  it("has no envVars (gateway-only, not injected into agents)", () => {
    expect(githubWebhookSecret.envVars).toBeUndefined();
  });

  it("has a helpUrl referencing GitHub docs", () => {
    expect(githubWebhookSecret.helpUrl).toContain("github.com");
  });
});
