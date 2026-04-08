/**
 * Integration tests: gateway/routes/webhooks.ts registerGatewayWebhookRoutes() — no Docker required.
 *
 * registerGatewayWebhookRoutes() is a thin wrapper around events/routes/webhooks.ts
 * registerWebhookRoutes(). This test verifies that calling registerGatewayWebhookRoutes()
 * correctly sets up the webhook routes on a Hono app.
 *
 * Test scenarios (no Docker required):
 *   1. registerGatewayWebhookRoutes() does not throw with empty registry
 *   2. registerGatewayWebhookRoutes() does not throw with optional params omitted
 *   3. POST /webhooks/unknown-source → 404 when source not in registry
 *   4. GET /webhooks/unknown-source (CRC) → 404 when source not in registry
 *   5. POST /webhooks/test → 200 when test provider registered
 *   6. Both POST and GET routes accessible (not 404 from "route not registered")
 *
 * Covers:
 *   - gateway/routes/webhooks.ts: registerGatewayWebhookRoutes() — delegates to registerWebhookRoutes()
 *   - gateway/routes/webhooks.ts: unknown source → 404 (POST and GET)
 *   - gateway/routes/webhooks.ts: valid registered source → dispatched
 */

import { describe, it, expect, vi } from "vitest";

const { Hono } = await import(
  /* @vite-ignore */
  "/tmp/repo/node_modules/hono/dist/index.js"
);

const {
  registerGatewayWebhookRoutes,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/gateway/routes/webhooks.js"
);

const {
  WebhookRegistry,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/webhooks/registry.js"
);

const {
  TestWebhookProvider,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/webhooks/providers/test.js"
);

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
}

describe("integration: gateway/routes/webhooks.ts registerGatewayWebhookRoutes() (no Docker required)", { timeout: 30_000 }, () => {

  // ── Basic registration ────────────────────────────────────────────────────

  it("does not throw when called with empty registry", () => {
    const logger = makeLogger();
    const app = new Hono();
    const registry = new WebhookRegistry(logger);

    expect(() =>
      registerGatewayWebhookRoutes(app, {
        webhookRegistry: registry,
        webhookSecrets: {},
        webhookConfigs: {},
        logger,
      })
    ).not.toThrow();
  });

  it("does not throw with optional params omitted (no statsStore, no statusTracker)", () => {
    const logger = makeLogger();
    const app = new Hono();
    const registry = new WebhookRegistry(logger);

    expect(() =>
      registerGatewayWebhookRoutes(app, {
        webhookRegistry: registry,
        webhookSecrets: {},
        webhookConfigs: {},
        logger,
        // statusTracker and statsStore omitted
      })
    ).not.toThrow();
  });

  // ── Unknown source returns 404 ────────────────────────────────────────────

  it("POST /webhooks/unknown-source returns 404", async () => {
    const logger = makeLogger();
    const app = new Hono();
    const registry = new WebhookRegistry(logger);

    registerGatewayWebhookRoutes(app, {
      webhookRegistry: registry,
      webhookSecrets: {},
      webhookConfigs: {},
      logger,
    });

    const res = await app.request("/webhooks/unknown-source", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ test: "payload" }),
    });

    expect(res.status).toBe(404);
  });

  it("GET /webhooks/unknown-source (CRC) returns 404", async () => {
    const logger = makeLogger();
    const app = new Hono();
    const registry = new WebhookRegistry(logger);

    registerGatewayWebhookRoutes(app, {
      webhookRegistry: registry,
      webhookSecrets: {},
      webhookConfigs: {},
      logger,
    });

    const res = await app.request("/webhooks/unknown-source?crc_token=test123");
    expect(res.status).toBe(404);
  });

  // ── Registered test source ────────────────────────────────────────────────

  it("POST /webhooks/test → 200 when test provider registered", async () => {
    const logger = makeLogger();
    const app = new Hono();
    const registry = new WebhookRegistry(logger);

    // Register a test webhook provider
    const provider = new TestWebhookProvider();
    registry.registerProvider(provider);

    registerGatewayWebhookRoutes(app, {
      webhookRegistry: registry,
      webhookSecrets: {},
      webhookConfigs: {},
      logger,
    });

    const res = await app.request("/webhooks/test", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-event": "push",
      },
      body: JSON.stringify({ test: "payload", action: "opened" }),
    });

    // With no agents bound, should dispatch and return 200
    expect(res.status).toBe(200);
  });

  // ── Route coexistence ─────────────────────────────────────────────────────

  it("routes accessible after registration (both POST and GET endpoints)", async () => {
    const logger = makeLogger();
    const app = new Hono();
    const registry = new WebhookRegistry(logger);

    registerGatewayWebhookRoutes(app, {
      webhookRegistry: registry,
      webhookSecrets: {},
      webhookConfigs: {},
      logger,
    });

    // Both endpoints are registered (not 404 due to "no route found")
    const postRes = await app.request("/webhooks/any-source", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    // 404 from "source not found" in registry, not "route not registered"
    expect(postRes.status).toBe(404);
    const body = await postRes.json() as any;
    expect(body).toHaveProperty("error");

    const getRes = await app.request("/webhooks/any-source?crc_token=abc");
    expect(getRes.status).toBe(404);
    const getBody = await getRes.json() as any;
    expect(getBody).toHaveProperty("error");
  });
});
