/**
 * Integration tests: events/routes/webhooks.ts receipt status update paths — no Docker required.
 *
 * After dispatching a webhook, the POST handler updates the receipt status in the stats store.
 * There are three status update branches:
 *
 *   1. result.ok=false + errors contain "signature validation failed" → "validation_failed"
 *   2. result.ok=false + errors contain "invalid JSON body" → "parse_error"
 *   3. result.ok=false (other errors) → "validation_failed" (default)
 *   4. result.ok=true + matched=0 → "dead-letter" with reason "no_match"
 *   5. result.ok=true + matched>0 → "processed"
 *
 * This test covers the `"parse_error"` branch (#2), which is reached when the
 * webhook body cannot be parsed as JSON. The GitHub provider calls JSON.parse()
 * on the body; if it fails, registry.dispatch() returns { ok: false, errors: ["invalid JSON body"] }.
 *
 * Covers:
 *   - events/routes/webhooks.ts: receipt status "parse_error" when errors include "invalid JSON body"
 *   - events/routes/webhooks.ts: receipt status "dead-letter" reason="no_match" when matched=0
 *   - events/routes/webhooks.ts: receipt status "processed" when matched>0
 */

import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

const { Hono } = await import(
  /* @vite-ignore */
  "/tmp/repo/node_modules/hono/dist/index.js"
);

const {
  registerWebhookRoutes,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/events/routes/webhooks.js"
);

const { WebhookRegistry } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/webhooks/registry.js"
);

const { GitHubWebhookProvider } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/webhooks/providers/github.js"
);

const { StatsStore } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/stats/store.js"
);

// ── Helpers ───────────────────────────────────────────────────────────────

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
}

function makeStatsStore(): InstanceType<typeof StatsStore> {
  const dir = mkdtempSync(join(tmpdir(), "al-receipt-status-test-"));
  return new StatsStore(join(dir, "stats.db"));
}

function makeGitHubApp(statsStore?: InstanceType<typeof StatsStore>, allowUnsigned = true) {
  const app = new Hono();
  const logger = makeLogger();
  const registry = new WebhookRegistry(logger);
  registry.registerProvider(new GitHubWebhookProvider());
  registerWebhookRoutes(
    app,
    registry,
    {},
    { github: { type: "github", allowUnsigned } },
    logger,
    undefined,
    statsStore,
  );
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe(
  "events/routes/webhooks.ts receipt status update paths (no Docker required)",
  { timeout: 30_000 },
  () => {
    it(
      "non-JSON body with allowUnsigned → receipt status 'dead-letter' with reason 'parse_error'",
      async () => {
        const statsStore = makeStatsStore();
        const app = makeGitHubApp(statsStore, true);

        const deliveryId = `delivery-${randomUUID()}`;

        // Non-JSON body → registry.dispatch returns { ok: false, errors: ["invalid JSON body"] }
        const res = await app.request("/webhooks/github", {
          method: "POST",
          headers: {
            "content-type": "text/plain",
            "x-github-event": "push",
            "x-github-delivery": deliveryId,
          },
          body: "this-is-not-json",
        });

        // The route returns 400 for invalid JSON body
        expect(res.status).toBe(400);
        const resBody = await res.json() as { error: string };
        expect(resBody.error).toContain("invalid JSON body");

        // Check receipt was updated with "parse_error" reason
        const receipt = statsStore.findWebhookReceiptByDeliveryId(deliveryId);
        expect(receipt).toBeDefined();
        expect(receipt!.status).toBe("dead-letter");
        expect(receipt!.deadLetterReason).toBe("parse_error");
      },
    );

    it(
      "valid JSON but no matching agents → receipt status 'dead-letter' with reason 'no_match'",
      async () => {
        const statsStore = makeStatsStore();
        const app = makeGitHubApp(statsStore, true);

        const deliveryId = `delivery-${randomUUID()}`;

        // Valid JSON, no agent bindings → matched=0 → dead-letter "no_match"
        const res = await app.request("/webhooks/github", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-github-event": "push",
            "x-github-delivery": deliveryId,
          },
          body: JSON.stringify({ ref: "refs/heads/main", repository: { full_name: "owner/repo" } }),
        });

        expect(res.status).toBe(200);
        const resBody = await res.json() as { ok: boolean; matched: number };
        expect(resBody.ok).toBe(true);
        expect(resBody.matched).toBe(0);

        const receipt = statsStore.findWebhookReceiptByDeliveryId(deliveryId);
        expect(receipt).toBeDefined();
        expect(receipt!.status).toBe("dead-letter");
        expect(receipt!.deadLetterReason).toBe("no_match");
      },
    );

    it(
      "matching agent binding → receipt status 'processed' with matchedAgents count",
      async () => {
        const statsStore = makeStatsStore();
        const app = new Hono();
        const logger = makeLogger();
        const registry = new WebhookRegistry(logger);
        registry.registerProvider(new GitHubWebhookProvider());

        // Register a binding that triggers for push events
        // Note: with allowUnsigned=true, matchedSource = "_unsigned", so
        // binding.source must be "_unsigned" or omitted (undefined) to match.
        let triggered = false;
        registry.addBinding({
          agentName: "push-agent",
          type: "github",
          source: undefined, // no source filter → matches any matchedSource
          filter: { events: ["push"] },
          trigger: vi.fn(() => {
            triggered = true;
            return true;
          }),
        });

        registerWebhookRoutes(
          app,
          registry,
          {},
          { github: { type: "github", allowUnsigned: true } },
          logger,
          undefined,
          statsStore,
        );

        const deliveryId = `delivery-${randomUUID()}`;

        const res = await app.request("/webhooks/github", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-github-event": "push",
            "x-github-delivery": deliveryId,
          },
          body: JSON.stringify({ ref: "refs/heads/main", repository: { full_name: "owner/repo" } }),
        });

        expect(res.status).toBe(200);
        const resBody = await res.json() as { ok: boolean; matched: number };
        expect(resBody.ok).toBe(true);
        expect(resBody.matched).toBe(1);
        expect(triggered).toBe(true);

        const receipt = statsStore.findWebhookReceiptByDeliveryId(deliveryId);
        expect(receipt).toBeDefined();
        expect(receipt!.status).toBe("processed");
        expect(receipt!.matchedAgents).toBe(1);
      },
    );

    it(
      "no statsStore → receipt status update skipped (no error)",
      async () => {
        // When no statsStore is provided, the receipt update block is skipped
        const app = makeGitHubApp(undefined, true); // no stats store

        const res = await app.request("/webhooks/github", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-github-event": "push",
          },
          body: JSON.stringify({ ref: "refs/heads/main" }),
        });

        // Route still works, just no receipt storage
        expect(res.status).toBe(200);
        const resBody = await res.json() as { ok: boolean };
        expect(resBody.ok).toBe(true);
      },
    );
  },
);
