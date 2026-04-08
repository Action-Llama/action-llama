/**
 * Integration tests: events/routes/webhooks.ts deduplication path — no Docker required.
 *
 * When a webhook provider supports delivery IDs (via provider.getDeliveryId),
 * the webhook POST handler checks for an existing receipt with the same deliveryId
 * before dispatching. If a duplicate is found, it returns immediately with:
 *   { ok: true, matched: 0, skipped: 0, duplicate: true }
 *
 * This path is in events/routes/webhooks.ts:
 *   if (statsStore && provider.getDeliveryId) {
 *     const deliveryId = provider.getDeliveryId(headers);
 *     if (deliveryId) {
 *       const existing = statsStore.findWebhookReceiptByDeliveryId(deliveryId);
 *       if (existing) {
 *         return c.json({ ok: true, matched: 0, skipped: 0, duplicate: true });
 *       }
 *     }
 *   }
 *
 * The existing github-webhook.test.ts covers this path but only with Docker.
 * This test exercises the same dedupe logic without Docker by constructing a Hono
 * app with registerWebhookRoutes(), a GitHubWebhookProvider (which has getDeliveryId),
 * and a real StatsStore backed by SQLite.
 *
 * Test scenarios (no Docker required):
 *   1. First delivery with a new deliveryId → not duplicate → dispatched normally (ok:true, no duplicate field)
 *   2. Second delivery with same deliveryId → found in statsStore → { ok:true, matched:0, duplicate:true }
 *   3. Delivery with no x-github-delivery header → getDeliveryId returns null → no dedupe check → dispatched
 *   4. Delivery with statsStore=undefined → dedupe check skipped → dispatched normally
 *
 * Covers:
 *   - events/routes/webhooks.ts: dedupe check → duplicate found → ok:true, matched:0, duplicate:true
 *   - events/routes/webhooks.ts: dedupe check → no duplicate → fall through to dispatch
 *   - events/routes/webhooks.ts: dedupe check skipped when provider.getDeliveryId returns null
 *   - events/routes/webhooks.ts: dedupe check skipped when statsStore is undefined
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
  return {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  };
}

/** Create a StatsStore backed by a fresh SQLite DB in a temp directory. */
function makeStatsStore(): InstanceType<typeof StatsStore> {
  const dir = mkdtempSync(join(tmpdir(), "al-dedupe-test-"));
  return new StatsStore(join(dir, "stats.db"));
}

/**
 * Build a Hono app with GitHub provider registered.
 * Optionally provide a statsStore for deduplication support.
 */
function makeGitHubApp(
  webhookConfigs: Record<string, any>,
  webhookSecrets: Record<string, any> = {},
  statsStore?: InstanceType<typeof StatsStore>,
) {
  const app = new Hono();
  const logger = makeLogger();
  const registry = new WebhookRegistry(logger);
  registry.registerProvider(new GitHubWebhookProvider());
  registerWebhookRoutes(app, registry, webhookSecrets, webhookConfigs, logger, undefined, statsStore);
  return app;
}

/**
 * POST to /webhooks/github with a minimal push event.
 * Optionally include x-github-delivery header to simulate a unique delivery ID.
 */
function postGitHubWebhook(
  app: any,
  deliveryId: string | null,
  body: object = { ref: "refs/heads/main", repository: { full_name: "acme/repo" } },
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-github-event": "push",
  };
  if (deliveryId !== null) {
    headers["x-github-delivery"] = deliveryId;
  }
  return app.request("/webhooks/github", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe(
  "events/routes/webhooks.ts deduplication path (no Docker required)",
  { timeout: 30_000 },
  () => {
    it(
      "first delivery with unique deliveryId is not a duplicate → dispatched normally",
      async () => {
        const statsStore = makeStatsStore();
        const app = makeGitHubApp(
          { github: { type: "github", allowUnsigned: true } },
          {},
          statsStore,
        );

        const deliveryId = `delivery-${randomUUID()}`;
        const res = await postGitHubWebhook(app, deliveryId);

        // First delivery — no existing receipt, dispatches normally
        expect(res.status).toBe(200);
        const body = await res.json() as { ok: boolean; matched: number; duplicate?: boolean };
        expect(body.ok).toBe(true);
        expect(body.duplicate).toBeUndefined();
      },
    );

    it(
      "second delivery with same deliveryId is detected as duplicate → ok:true, matched:0, duplicate:true",
      async () => {
        const statsStore = makeStatsStore();
        const app = makeGitHubApp(
          { github: { type: "github", allowUnsigned: true } },
          {},
          statsStore,
        );

        const deliveryId = `delivery-${randomUUID()}`;

        // First delivery — creates the receipt
        const res1 = await postGitHubWebhook(app, deliveryId);
        expect(res1.status).toBe(200);
        const body1 = await res1.json() as { ok: boolean; duplicate?: boolean };
        expect(body1.duplicate).toBeUndefined();

        // Second delivery with same deliveryId — dedupe check finds existing receipt
        const res2 = await postGitHubWebhook(app, deliveryId);
        expect(res2.status).toBe(200);
        const body2 = await res2.json() as { ok: boolean; matched: number; skipped: number; duplicate: boolean };
        expect(body2.ok).toBe(true);
        expect(body2.matched).toBe(0);
        expect(body2.skipped).toBe(0);
        expect(body2.duplicate).toBe(true);
      },
    );

    it(
      "delivery without x-github-delivery header → getDeliveryId returns null → no dedupe check → dispatched",
      async () => {
        const statsStore = makeStatsStore();
        const app = makeGitHubApp(
          { github: { type: "github", allowUnsigned: true } },
          {},
          statsStore,
        );

        // No deliveryId in header → provider.getDeliveryId returns null → dedupe skipped
        const res = await postGitHubWebhook(app, null);

        expect(res.status).toBe(200);
        const body = await res.json() as { ok: boolean; duplicate?: boolean };
        expect(body.ok).toBe(true);
        // No duplicate field since no deliveryId to check
        expect(body.duplicate).toBeUndefined();
      },
    );

    it(
      "statsStore=undefined → dedupe check entirely skipped → dispatched normally",
      async () => {
        // No statsStore → the `if (statsStore && provider.getDeliveryId)` branch is false
        const appNoStats = makeGitHubApp(
          { github: { type: "github", allowUnsigned: true } },
          {},
          undefined, // no statsStore
        );

        const deliveryId = `delivery-${randomUUID()}`;
        const res = await postGitHubWebhook(appNoStats, deliveryId);

        expect(res.status).toBe(200);
        const body = await res.json() as { ok: boolean; duplicate?: boolean };
        expect(body.ok).toBe(true);
        expect(body.duplicate).toBeUndefined();
      },
    );

    it(
      "after second duplicate delivery, response has no 'skipped' value — duplicate short-circuits before counting",
      async () => {
        const statsStore = makeStatsStore();
        const app = makeGitHubApp(
          { github: { type: "github", allowUnsigned: true } },
          {},
          statsStore,
        );

        const deliveryId = `delivery-${randomUUID()}`;

        // First delivery to create the receipt
        await postGitHubWebhook(app, deliveryId);

        // Second delivery — duplicate detected
        const res = await postGitHubWebhook(app, deliveryId);
        expect(res.status).toBe(200);
        const body = await res.json() as { ok: boolean; matched: number; skipped: number; duplicate: boolean };

        // Confirm the exact shape of the duplicate response
        expect(body.ok).toBe(true);
        expect(body.matched).toBe(0);
        expect(body.skipped).toBe(0);
        expect(body.duplicate).toBe(true);
      },
    );
  },
);
