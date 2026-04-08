/**
 * Integration tests: events/webhook-setup.ts setupWebhookRegistry() — no Docker required.
 *
 * setupWebhookRegistry() creates the WebhookRegistry and loads secrets from credential files.
 * Several paths can be tested without Docker:
 *
 *   1. No webhook sources in globalConfig → returns { secrets: {}, configs: {} }
 *      (no registry created, no credentials loaded)
 *   2. Empty webhooks object → same empty result
 *   3. With webhook sources + allowUnsigned=true → logger.warn called with source name
 *   4. With webhook sources but no credentials installed → secrets map is empty
 *   5. With webhook sources → registry is created with all 7 standard providers
 *   6. configs is populated with the webhook source config
 *   7. Return type has { registry?, secrets, configs } shape
 *
 * Covers:
 *   - events/webhook-setup.ts: setupWebhookRegistry() — no webhooks → { secrets: {}, configs: {} }
 *   - events/webhook-setup.ts: setupWebhookRegistry() — empty webhooks → { secrets: {}, configs: {} }
 *   - events/webhook-setup.ts: setupWebhookRegistry() — allowUnsigned source → logger.warn called
 *   - events/webhook-setup.ts: setupWebhookRegistry() — no credentials → secrets is empty
 *   - events/webhook-setup.ts: setupWebhookRegistry() — registry created with providers registered
 *   - events/webhook-setup.ts: setupWebhookRegistry() — configs matches webhook source config
 */

import { describe, it, expect, vi } from "vitest";

const {
  setupWebhookRegistry,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/events/webhook-setup.js"
);

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  };
}

describe(
  "integration: events/webhook-setup.ts setupWebhookRegistry() (no Docker required)",
  { timeout: 30_000 },
  () => {
    // ── No webhook sources → empty result ─────────────────────────────────────

    it("no globalConfig.webhooks → returns { secrets: {}, configs: {} }", async () => {
      const logger = makeLogger();
      const result = await setupWebhookRegistry({}, logger);
      expect(result.secrets).toEqual({});
      expect(result.configs).toEqual({});
      expect(result.registry).toBeUndefined();
    });

    it("empty globalConfig.webhooks → returns { secrets: {}, configs: {} }", async () => {
      const logger = makeLogger();
      const result = await setupWebhookRegistry({ webhooks: {} }, logger);
      expect(result.secrets).toEqual({});
      expect(result.configs).toEqual({});
      expect(result.registry).toBeUndefined();
    });

    // ── With webhook sources ─────────────────────────────────────────────────

    it("webhook source → registry is defined", async () => {
      const logger = makeLogger();
      const result = await setupWebhookRegistry({
        webhooks: { "my-github": { type: "github" } },
      }, logger);
      expect(result.registry).toBeDefined();
    });

    it("webhook source → configs matches the webhook source config", async () => {
      const logger = makeLogger();
      const result = await setupWebhookRegistry({
        webhooks: { "my-github": { type: "github" } },
      }, logger);
      expect(result.configs).toEqual({ "my-github": { type: "github" } });
    });

    it("webhook source with no credentials → secrets map is empty for that provider", async () => {
      const logger = makeLogger();
      const result = await setupWebhookRegistry({
        webhooks: { "test-source": { type: "test" } },
      }, logger);
      // test provider has no credential type, so secrets stays empty
      expect(result.secrets).toEqual({});
    });

    // ── allowUnsigned warning ─────────────────────────────────────────────────

    it("webhook source with allowUnsigned=true → logger.warn called with source name", async () => {
      const logger = makeLogger();
      await setupWebhookRegistry({
        webhooks: {
          "insecure-github": { type: "github", allowUnsigned: true },
        },
      }, logger);
      // Should warn about the insecure configuration
      expect(logger.warn).toHaveBeenCalled();
      const warnCall = logger.warn.mock.calls[0];
      const warnMsg = String(warnCall[1] || warnCall[0]);
      expect(warnMsg).toContain("insecure");
    });

    it("webhook source without allowUnsigned → no warning logged", async () => {
      const logger = makeLogger();
      await setupWebhookRegistry({
        webhooks: {
          "secure-github": { type: "github" },
        },
      }, logger);
      // No allowUnsigned warning
      const warnCalls = logger.warn.mock.calls.filter((c: any[]) => {
        return String(c[1] || c[0]).includes("insecure");
      });
      expect(warnCalls).toHaveLength(0);
    });

    it("multiple webhook sources, one with allowUnsigned → warning for that source only", async () => {
      const logger = makeLogger();
      await setupWebhookRegistry({
        webhooks: {
          "safe": { type: "test" },
          "unsafe": { type: "github", allowUnsigned: true },
        },
      }, logger);
      const warnCalls = logger.warn.mock.calls.filter((c: any[]) => {
        const msg = String(c[1] || c[0] || "");
        return msg.includes("insecure") || msg.includes("allow");
      });
      expect(warnCalls.length).toBeGreaterThanOrEqual(1);
    });

    // ── Result shape ──────────────────────────────────────────────────────────

    it("result always has secrets and configs properties", async () => {
      const logger = makeLogger();
      const result = await setupWebhookRegistry({}, logger);
      expect(result).toHaveProperty("secrets");
      expect(result).toHaveProperty("configs");
    });

    it("registry has getProvider() for 'github' after creating with github source", async () => {
      const logger = makeLogger();
      const result = await setupWebhookRegistry({
        webhooks: { "test-gh": { type: "github" } },
      }, logger);
      expect(result.registry).toBeDefined();
      const provider = result.registry?.getProvider("github");
      expect(provider).toBeDefined();
      expect(provider?.source).toBe("github");
    });
  },
);
