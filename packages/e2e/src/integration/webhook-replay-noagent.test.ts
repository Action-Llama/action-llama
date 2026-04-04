/**
 * Integration tests: events/routes/webhooks.ts replay endpoint — no Docker required.
 *
 * The replay endpoint (POST /api/webhooks/:receiptId/replay) has several
 * code paths that can be exercised without Docker by constructing a Hono
 * app with registerWebhookRoutes() and a real StatsStore backed by SQLite.
 *
 * Test scenarios (no Docker required):
 *   1. Unknown receiptId → 404 "receipt not found"
 *   2. Receipt with null headers → 400 "receipt has no stored payload"
 *   3. Receipt with null body → 400 "receipt has no stored payload"
 *   4. Valid receipt with no matching agents → ok:true, matched:0, dead-letter updated
 *   5. Valid receipt with matching agent → ok:true, matched:1, replayReceiptId returned
 *   6. Replay creates a new receipt with "replay:" prefix in eventSummary
 *   7. Dead-letter reason "no_match" when no agents match the replayed receipt
 *
 * Also exercises:
 *   - events/routes/webhooks.ts: stripSignatureHeaders() (private, via dispatch path)
 *   - events/routes/webhooks.ts: registerWebhookRoutes() — statsStore gate for replay route
 *   - events/routes/webhooks.ts: replay route omitted when statsStore is undefined
 *
 * Covers:
 *   - events/routes/webhooks.ts: POST /api/webhooks/:receiptId/replay → 404 (receipt not found)
 *   - events/routes/webhooks.ts: POST /api/webhooks/:receiptId/replay → 400 (no stored payload)
 *   - events/routes/webhooks.ts: POST /api/webhooks/:receiptId/replay → ok:true matched=0 (dead-letter)
 *   - events/routes/webhooks.ts: POST /api/webhooks/:receiptId/replay → ok:true matched=1 with binding
 *   - events/routes/webhooks.ts: replay receipt eventSummary prefixed with "replay:"
 *   - events/routes/webhooks.ts: replay route not registered when statsStore=undefined (404)
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

const { StatsStore } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/stats/store.js"
);

const { WebhookRegistry } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/webhooks/registry.js"
);

const { TestWebhookProvider } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/webhooks/providers/test.js"
);

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
  const dir = mkdtempSync(join(tmpdir(), "al-webhook-replay-test-"));
  return new StatsStore(join(dir, "stats.db"));
}

/** Build a test registry with TestWebhookProvider. */
function makeRegistry() {
  const logger = makeLogger();
  const registry = new WebhookRegistry(logger);
  registry.registerProvider(new TestWebhookProvider());
  return registry;
}

/** A minimal valid JSON body for the test webhook provider. */
const VALID_BODY = JSON.stringify({
  event: "deploy",
  action: "created",
  repo: "acme/repo",
  labels: [],
  sender: "user",
});

/** Minimal stored headers (no signature headers — already stripped). */
const STORED_HEADERS = JSON.stringify({ "content-type": "application/json" });

describe("integration: events/routes/webhooks.ts replay endpoint (no Docker required)", { timeout: 30_000 }, () => {
  // ── 404 for unknown receipt ───────────────────────────────────────────────

  it("returns 404 when replaying a nonexistent receiptId", async () => {
    const app = new Hono();
    const statsStore = makeStatsStore();
    const registry = makeRegistry();
    const logger = makeLogger();

    registerWebhookRoutes(app, registry, {}, {}, logger, undefined, statsStore);

    const res = await app.request(
      `/api/webhooks/${randomUUID()}/replay`,
      { method: "POST" },
    );
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("receipt not found");
  });

  // ── 400 when receipt has no headers ──────────────────────────────────────

  it("returns 400 when receipt has null headers (no stored payload)", async () => {
    const app = new Hono();
    const statsStore = makeStatsStore();
    const registry = makeRegistry();
    const logger = makeLogger();

    registerWebhookRoutes(app, registry, {}, {}, logger, undefined, statsStore);

    const receiptId = randomUUID();
    statsStore.recordWebhookReceipt({
      id: receiptId,
      source: "test",
      eventSummary: "test:event",
      timestamp: Date.now(),
      headers: null as any,    // no headers stored
      body: VALID_BODY,
      matchedAgents: 1,
      status: "processed",
    });

    const res = await app.request(
      `/api/webhooks/${receiptId}/replay`,
      { method: "POST" },
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("no stored payload");
  });

  // ── 400 when receipt has no body ─────────────────────────────────────────

  it("returns 400 when receipt has null body (no stored payload)", async () => {
    const app = new Hono();
    const statsStore = makeStatsStore();
    const registry = makeRegistry();
    const logger = makeLogger();

    registerWebhookRoutes(app, registry, {}, {}, logger, undefined, statsStore);

    const receiptId = randomUUID();
    statsStore.recordWebhookReceipt({
      id: receiptId,
      source: "test",
      eventSummary: "test:event",
      timestamp: Date.now(),
      headers: STORED_HEADERS,
      body: null as any,       // no body stored
      matchedAgents: 1,
      status: "processed",
    });

    const res = await app.request(
      `/api/webhooks/${receiptId}/replay`,
      { method: "POST" },
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("no stored payload");
  });

  // ── matched=0 → dead-letter path ─────────────────────────────────────────

  it("returns ok:true with matched=0 when no agent bindings match the replay", async () => {
    const app = new Hono();
    const statsStore = makeStatsStore();
    const registry = makeRegistry();
    // No bindings registered — nothing matches
    const logger = makeLogger();

    registerWebhookRoutes(app, registry, {}, { test: { type: "test" } }, logger, undefined, statsStore);

    const receiptId = randomUUID();
    statsStore.recordWebhookReceipt({
      id: receiptId,
      source: "test",
      eventSummary: "test:deploy",
      timestamp: Date.now(),
      headers: STORED_HEADERS,
      body: VALID_BODY,
      matchedAgents: 0,
      status: "dead-letter",
    });

    const res = await app.request(
      `/api/webhooks/${receiptId}/replay`,
      { method: "POST" },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; matched: number; replayReceiptId: string };
    expect(body.ok).toBe(true);
    expect(body.matched).toBe(0);
    expect(body.replayReceiptId).toBeDefined();
    expect(typeof body.replayReceiptId).toBe("string");
  });

  // ── matched=1 when binding is registered ─────────────────────────────────

  it("returns ok:true with matched=1 when a binding matches the replayed event", async () => {
    const app = new Hono();
    const statsStore = makeStatsStore();
    const registry = makeRegistry();
    const logger = makeLogger();

    // Register a binding that matches "deploy" events on the "test" source
    const triggerFn = vi.fn(() => true);
    registry.addBinding({
      agentName: "replay-test-agent",
      type: "test",
      source: "test",
      filter: { events: ["deploy"] },
      trigger: triggerFn,
    });

    registerWebhookRoutes(app, registry, {}, { test: { type: "test" } }, logger, undefined, statsStore);

    const receiptId = randomUUID();
    statsStore.recordWebhookReceipt({
      id: receiptId,
      source: "test",
      eventSummary: "test:deploy",
      timestamp: Date.now(),
      headers: STORED_HEADERS,
      body: VALID_BODY,
      matchedAgents: 1,
      status: "processed",
    });

    const res = await app.request(
      `/api/webhooks/${receiptId}/replay`,
      { method: "POST" },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; matched: number; replayReceiptId: string };
    expect(body.ok).toBe(true);
    expect(body.matched).toBe(1);
    expect(body.replayReceiptId).toBeDefined();

    // The trigger callback should have been called
    expect(triggerFn).toHaveBeenCalledTimes(1);
  });

  // ── replay receipt eventSummary prefixed with "replay:" ──────────────────

  it("creates a new replay receipt with 'replay:' prefix in eventSummary", async () => {
    const app = new Hono();
    const statsStore = makeStatsStore();
    const registry = makeRegistry();
    const logger = makeLogger();

    registerWebhookRoutes(app, registry, {}, { test: { type: "test" } }, logger, undefined, statsStore);

    const receiptId = randomUUID();
    const originalSummary = "test:deploy";
    statsStore.recordWebhookReceipt({
      id: receiptId,
      source: "test",
      eventSummary: originalSummary,
      timestamp: Date.now(),
      headers: STORED_HEADERS,
      body: VALID_BODY,
      matchedAgents: 0,
      status: "dead-letter",
    });

    const res = await app.request(
      `/api/webhooks/${receiptId}/replay`,
      { method: "POST" },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { replayReceiptId: string };

    // Verify the new replay receipt exists with the "replay:" prefix
    const replayReceipt = statsStore.getWebhookReceipt(body.replayReceiptId);
    expect(replayReceipt).toBeDefined();
    expect(replayReceipt!.eventSummary).toBe(`replay:${originalSummary}`);
    expect(replayReceipt!.source).toBe("test");
  });

  // ── replay route omitted when statsStore is undefined ────────────────────

  it("replay route is not registered when statsStore is undefined → 404", async () => {
    const app = new Hono();
    const registry = makeRegistry();
    const logger = makeLogger();

    // Register routes without statsStore
    registerWebhookRoutes(app, registry, {}, {}, logger, undefined, undefined);

    const res = await app.request(
      `/api/webhooks/${randomUUID()}/replay`,
      { method: "POST" },
    );
    // Without statsStore, the /api/webhooks/:id/replay route is never registered → 404
    expect(res.status).toBe(404);
  });

  // ── dead-letter reason "no_match" in updated receipt ─────────────────────

  it("dead-letter receipt shows no_match reason when no agents match", async () => {
    const app = new Hono();
    const statsStore = makeStatsStore();
    const registry = makeRegistry();
    const logger = makeLogger();

    registerWebhookRoutes(app, registry, {}, { test: { type: "test" } }, logger, undefined, statsStore);

    const receiptId = randomUUID();
    statsStore.recordWebhookReceipt({
      id: receiptId,
      source: "test",
      eventSummary: "test:deploy",
      timestamp: Date.now(),
      headers: STORED_HEADERS,
      body: VALID_BODY,
      matchedAgents: 0,
      status: "dead-letter",
    });

    const res = await app.request(
      `/api/webhooks/${receiptId}/replay`,
      { method: "POST" },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { replayReceiptId: string; matched: number };
    expect(body.matched).toBe(0);

    // The replay receipt should be updated to dead-letter with no_match reason
    const replayReceipt = statsStore.getWebhookReceipt(body.replayReceiptId);
    expect(replayReceipt).toBeDefined();
    expect(replayReceipt!.status).toBe("dead-letter");
    expect(replayReceipt!.deadLetterReason).toBe("no_match");
  });
});
