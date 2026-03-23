import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { registerWebhookRoutes } from "../../../src/events/routes/webhooks.js";
import { WebhookRegistry } from "../../../src/webhooks/registry.js";
import type { WebhookProvider, WebhookContext, WebhookFilter, DispatchResult } from "../../../src/webhooks/types.js";

// A minimal test provider that validates everything and returns a simple context
class TestProvider implements WebhookProvider {
  source = "test";

  getDeliveryId(headers: Record<string, string | undefined>): string | null {
    return headers["x-test-delivery"] ?? null;
  }

  validateRequest(): string | null {
    return "default";
  }

  parseEvent(headers: Record<string, string | undefined>, body: any): WebhookContext | null {
    return {
      source: "test",
      event: body.event ?? "test.event",
      repo: "org/repo",
      sender: "bot",
      timestamp: new Date().toISOString(),
    };
  }

  matchesFilter(): boolean {
    return true;
  }
}

function mockStatsStore() {
  return {
    recordWebhookReceipt: vi.fn(),
    updateWebhookReceiptStatus: vi.fn(),
    findWebhookReceiptByDeliveryId: vi.fn().mockReturnValue(undefined),
    getWebhookReceipt: vi.fn().mockReturnValue(undefined),
  } as any;
}

function mockLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as any;
}

function createApp(opts: { statsStore?: any; bindings?: Array<{ agentName: string; trigger: (ctx: WebhookContext) => boolean }> } = {}) {
  const app = new Hono();
  const logger = mockLogger();
  const registry = new WebhookRegistry(logger);
  registry.registerProvider(new TestProvider());

  // Add bindings if requested
  for (const binding of opts.bindings ?? []) {
    registry.addBinding({
      agentName: binding.agentName,
      type: "test",
      trigger: binding.trigger,
    });
  }

  registerWebhookRoutes(app, registry, {}, {}, logger, undefined, opts.statsStore);
  return { app, registry, stats: opts.statsStore };
}

describe("webhook routes", () => {
  it("records a webhook receipt on dispatch", async () => {
    const stats = mockStatsStore();
    const { app } = createApp({
      statsStore: stats,
      bindings: [{ agentName: "reporter", trigger: () => true }],
    });

    const res = await app.request("/webhooks/test", {
      method: "POST",
      body: JSON.stringify({ event: "issues.labeled" }),
      headers: { "content-type": "application/json" },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.matched).toBe(1);

    // Receipt should have been recorded and then updated
    expect(stats.recordWebhookReceipt).toHaveBeenCalledTimes(1);
    expect(stats.updateWebhookReceiptStatus).toHaveBeenCalledTimes(1);
    const updateCall = stats.updateWebhookReceiptStatus.mock.calls[0];
    expect(updateCall[1]).toBe(1); // matchedAgents
    expect(updateCall[2]).toBe("processed");
  });

  it("records dead-letter when no agents match", async () => {
    const stats = mockStatsStore();
    const { app } = createApp({ statsStore: stats }); // no bindings

    const res = await app.request("/webhooks/test", {
      method: "POST",
      body: JSON.stringify({ event: "push" }),
      headers: { "content-type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(stats.updateWebhookReceiptStatus).toHaveBeenCalledTimes(1);
    const updateCall = stats.updateWebhookReceiptStatus.mock.calls[0];
    expect(updateCall[1]).toBe(0); // matchedAgents
    expect(updateCall[2]).toBe("dead-letter");
    expect(updateCall[3]).toBe("no_match");
  });

  it("deduplicates by delivery ID", async () => {
    const stats = mockStatsStore();
    const triggerFn = vi.fn().mockReturnValue(true);
    const { app } = createApp({
      statsStore: stats,
      bindings: [{ agentName: "reporter", trigger: triggerFn }],
    });

    // First request
    await app.request("/webhooks/test", {
      method: "POST",
      body: JSON.stringify({ event: "issues" }),
      headers: { "content-type": "application/json", "x-test-delivery": "dup-123" },
    });

    expect(triggerFn).toHaveBeenCalledTimes(1);

    // Simulate finding the existing receipt on the second request
    stats.findWebhookReceiptByDeliveryId.mockReturnValue({ id: "existing", status: "processed" });

    const res2 = await app.request("/webhooks/test", {
      method: "POST",
      body: JSON.stringify({ event: "issues" }),
      headers: { "content-type": "application/json", "x-test-delivery": "dup-123" },
    });

    expect(res2.status).toBe(200);
    const data = await res2.json();
    expect(data.duplicate).toBe(true);
    // Trigger should NOT have been called again
    expect(triggerFn).toHaveBeenCalledTimes(1);
  });

  it("works without stats store (no receipts recorded)", async () => {
    const { app } = createApp({
      bindings: [{ agentName: "reporter", trigger: () => true }],
    });

    const res = await app.request("/webhooks/test", {
      method: "POST",
      body: JSON.stringify({ event: "test" }),
      headers: { "content-type": "application/json" },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it("replay endpoint re-dispatches stored payload", async () => {
    const stats = mockStatsStore();
    const triggerFn = vi.fn().mockReturnValue(true);
    const { app } = createApp({
      statsStore: stats,
      bindings: [{ agentName: "reporter", trigger: triggerFn }],
    });

    // Simulate an existing receipt with stored payload
    stats.getWebhookReceipt.mockReturnValue({
      id: "receipt-abc",
      source: "test",
      eventSummary: "test.event",
      timestamp: Date.now(),
      headers: JSON.stringify({ "content-type": "application/json" }),
      body: JSON.stringify({ event: "issues.labeled" }),
      matchedAgents: 1,
      status: "processed",
    });

    const res = await app.request("/api/webhooks/receipt-abc/replay", {
      method: "POST",
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.matched).toBe(1);
    expect(data.replayReceiptId).toBeDefined();
    expect(triggerFn).toHaveBeenCalled();

    // A new receipt should have been recorded for the replay
    expect(stats.recordWebhookReceipt).toHaveBeenCalledTimes(1);
    const replayReceipt = stats.recordWebhookReceipt.mock.calls[0][0];
    expect(replayReceipt.eventSummary).toContain("replay:");
  });

  it("replay endpoint returns 404 for missing receipt", async () => {
    const stats = mockStatsStore();
    const { app } = createApp({ statsStore: stats });

    const res = await app.request("/api/webhooks/nonexistent/replay", {
      method: "POST",
    });

    expect(res.status).toBe(404);
  });
});
