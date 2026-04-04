/**
 * Integration tests: models/providers/index.ts and webhooks/providers/index.ts
 * — no Docker required.
 *
 * Both modules export WebhookExtension and ModelExtension objects that wrap
 * the underlying provider instances. These extension objects are what the
 * ExtensionRegistry registers during scheduler startup — but the metadata
 * and init/shutdown callbacks have never been directly tested.
 *
 * Test scenarios (no Docker required):
 *   1. openAIModelExtension — metadata fields (name, type, version, description)
 *   2. openAIModelExtension — has provider instance
 *   3. openAIModelExtension — init() and shutdown() don't throw
 *   4. anthropicModelExtension — metadata fields
 *   5. anthropicModelExtension — has provider instance
 *   6. anthropicModelExtension — init() and shutdown() don't throw
 *   7. customModelExtension — metadata fields
 *   8. customModelExtension — has provider instance
 *   9. customModelExtension — init() and shutdown() don't throw
 *  10. githubWebhookExtension — metadata fields (name, type, version)
 *  11. githubWebhookExtension — requiredCredentials[0].type = "github_webhook_secret"
 *  12. githubWebhookExtension — init() and shutdown() don't throw
 *  13. linearWebhookExtension — metadata name="linear", type="webhook"
 *  14. mintlifyWebhookExtension — metadata name="mintlify", type="webhook"
 *  15. sentryWebhookExtension — metadata name="sentry", type="webhook"
 *  16. slackWebhookExtension — metadata name="slack", requiredCredentials
 *  17. testWebhookExtension — metadata name="test", empty requiredCredentials
 *  18. discordWebhookExtension — metadata name="discord", type="webhook"
 *  19. twitterWebhookExtension — metadata name="twitter", type="webhook"
 *  20. All webhook extensions — provider property is defined (not null/undefined)
 *  21. All webhook extensions — init() and shutdown() don't throw
 *
 * Covers:
 *   - models/providers/index.ts: openAIModelExtension, anthropicModelExtension,
 *     customModelExtension — metadata + init/shutdown
 *   - webhooks/providers/index.ts: all 8 webhook extension objects —
 *     metadata + init/shutdown
 */

import { describe, it, expect } from "vitest";

const {
  openAIModelExtension,
  anthropicModelExtension,
  customModelExtension,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/models/providers/index.js"
);

const {
  githubWebhookExtension,
  linearWebhookExtension,
  mintlifyWebhookExtension,
  sentryWebhookExtension,
  slackWebhookExtension,
  testWebhookExtension,
  discordWebhookExtension,
  twitterWebhookExtension,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/webhooks/providers/index.js"
);

// ── Model provider extensions ─────────────────────────────────────────────────

describe("integration: models/providers/index.ts — openAIModelExtension (no Docker required)", { timeout: 30_000 }, () => {
  it("metadata.name is 'openai'", () => {
    expect(openAIModelExtension.metadata.name).toBe("openai");
  });

  it("metadata.type is 'model'", () => {
    expect(openAIModelExtension.metadata.type).toBe("model");
  });

  it("metadata.version is defined", () => {
    expect(openAIModelExtension.metadata.version).toBeDefined();
    expect(typeof openAIModelExtension.metadata.version).toBe("string");
  });

  it("metadata.description is defined", () => {
    expect(openAIModelExtension.metadata.description).toBeTruthy();
  });

  it("metadata.requiredCredentials includes openai_api_key", () => {
    const creds = openAIModelExtension.metadata.requiredCredentials || [];
    expect(creds.some((c: any) => c.type === "openai_api_key")).toBe(true);
  });

  it("provider instance is defined", () => {
    expect(openAIModelExtension.provider).toBeDefined();
  });

  it("init() does not throw", async () => {
    await expect(openAIModelExtension.init()).resolves.toBeUndefined();
  });

  it("shutdown() does not throw", async () => {
    await expect(openAIModelExtension.shutdown()).resolves.toBeUndefined();
  });
});

describe("integration: models/providers/index.ts — anthropicModelExtension (no Docker required)", { timeout: 30_000 }, () => {
  it("metadata.name is 'anthropic'", () => {
    expect(anthropicModelExtension.metadata.name).toBe("anthropic");
  });

  it("metadata.type is 'model'", () => {
    expect(anthropicModelExtension.metadata.type).toBe("model");
  });

  it("metadata.requiredCredentials includes anthropic_api_key", () => {
    const creds = anthropicModelExtension.metadata.requiredCredentials || [];
    expect(creds.some((c: any) => c.type === "anthropic_api_key")).toBe(true);
  });

  it("provider instance is defined", () => {
    expect(anthropicModelExtension.provider).toBeDefined();
  });

  it("init() does not throw", async () => {
    await expect(anthropicModelExtension.init()).resolves.toBeUndefined();
  });

  it("shutdown() does not throw", async () => {
    await expect(anthropicModelExtension.shutdown()).resolves.toBeUndefined();
  });
});

describe("integration: models/providers/index.ts — customModelExtension (no Docker required)", { timeout: 30_000 }, () => {
  it("metadata.name is 'custom'", () => {
    expect(customModelExtension.metadata.name).toBe("custom");
  });

  it("metadata.type is 'model'", () => {
    expect(customModelExtension.metadata.type).toBe("model");
  });

  it("provider instance is defined", () => {
    expect(customModelExtension.provider).toBeDefined();
  });

  it("init() does not throw", async () => {
    await expect(customModelExtension.init()).resolves.toBeUndefined();
  });

  it("shutdown() does not throw", async () => {
    await expect(customModelExtension.shutdown()).resolves.toBeUndefined();
  });
});

// ── Webhook extensions ────────────────────────────────────────────────────────

describe("integration: webhooks/providers/index.ts — all webhook extensions (no Docker required)", { timeout: 30_000 }, () => {
  const allExtensions = [
    { name: "github", ext: githubWebhookExtension, secretType: "github_webhook_secret" },
    { name: "linear", ext: linearWebhookExtension, secretType: "linear_webhook_secret" },
    { name: "mintlify", ext: mintlifyWebhookExtension, secretType: "mintlify_webhook_secret" },
    { name: "sentry", ext: sentryWebhookExtension, secretType: "sentry_client_secret" },
    { name: "slack", ext: slackWebhookExtension, secretType: "slack_signing_secret" },
    { name: "test", ext: testWebhookExtension, secretType: null },
    { name: "discord", ext: discordWebhookExtension, secretType: "discord_bot" },
    { name: "twitter", ext: twitterWebhookExtension, secretType: "x_twitter_api" },
  ];

  for (const { name, ext } of allExtensions) {
    it(`${name}: metadata.name is '${name}'`, () => {
      expect(ext.metadata.name).toBe(name);
    });

    it(`${name}: metadata.type is 'webhook'`, () => {
      expect(ext.metadata.type).toBe("webhook");
    });

    it(`${name}: metadata.version is defined`, () => {
      expect(typeof ext.metadata.version).toBe("string");
    });

    it(`${name}: metadata.description is non-empty`, () => {
      expect(ext.metadata.description).toBeTruthy();
    });

    it(`${name}: provider property is defined`, () => {
      expect(ext.provider).toBeDefined();
    });

    it(`${name}: init() does not throw`, async () => {
      await expect(ext.init()).resolves.toBeUndefined();
    });

    it(`${name}: shutdown() does not throw`, async () => {
      await expect(ext.shutdown()).resolves.toBeUndefined();
    });
  }

  // ── Credential-related metadata ──────────────────────────────────────────

  it("github extension: requiredCredentials[0].type = 'github_webhook_secret'", () => {
    const creds = githubWebhookExtension.metadata.requiredCredentials || [];
    expect(creds[0]?.type).toBe("github_webhook_secret");
  });

  it("test extension: requiredCredentials is empty (no credentials needed)", () => {
    const creds = testWebhookExtension.metadata.requiredCredentials || [];
    expect(creds.length).toBe(0);
  });

  it("discord extension: providesCredentialTypes includes discord_bot", () => {
    const types = discordWebhookExtension.metadata.providesCredentialTypes || [];
    expect(types.some((t: any) => t.type === "discord_bot")).toBe(true);
  });

  it("twitter extension: providesCredentialTypes includes x_twitter_api", () => {
    const types = twitterWebhookExtension.metadata.providesCredentialTypes || [];
    expect(types.some((t: any) => t.type === "x_twitter_api")).toBe(true);
  });

  it("twitter extension: providesCredentialTypes includes x_twitter_user_oauth1", () => {
    const types = twitterWebhookExtension.metadata.providesCredentialTypes || [];
    expect(types.some((t: any) => t.type === "x_twitter_user_oauth1")).toBe(true);
  });

  it("twitter extension: providesCredentialTypes includes x_twitter_user_oauth2", () => {
    const types = twitterWebhookExtension.metadata.providesCredentialTypes || [];
    expect(types.some((t: any) => t.type === "x_twitter_user_oauth2")).toBe(true);
  });

  it("all 8 extension objects are defined", () => {
    expect(githubWebhookExtension).toBeDefined();
    expect(linearWebhookExtension).toBeDefined();
    expect(mintlifyWebhookExtension).toBeDefined();
    expect(sentryWebhookExtension).toBeDefined();
    expect(slackWebhookExtension).toBeDefined();
    expect(testWebhookExtension).toBeDefined();
    expect(discordWebhookExtension).toBeDefined();
    expect(twitterWebhookExtension).toBeDefined();
  });
});
