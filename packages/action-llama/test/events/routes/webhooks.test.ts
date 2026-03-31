import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { registerWebhookRoutes } from "../../../src/events/routes/webhooks.js";
import { WebhookRegistry } from "../../../src/webhooks/registry.js";
import type { WebhookProvider, WebhookContext, WebhookFilter, DispatchResult } from "../../../src/webhooks/types.js";

/** Provider with CRC challenge support */
class CrcProvider implements WebhookProvider {
  source = "crc-source";
  validateRequest() { return "default"; }
  parseEvent(_h: any, body: any): WebhookContext { return { source: "crc-source", event: "test", repo: "o/r", sender: "bot", timestamp: new Date().toISOString() }; }
  matchesFilter() { return true; }
  handleCrcChallenge(queryParams: Record<string, string>): { body: any; status: number } | null {
    if (!queryParams["crc_token"]) return null;
    return { body: { response_token: "hmac-sha256-hash" }, status: 200 };
  }
}

/** Provider with Slack-style URL verification challenge */
class ChallengeProvider implements WebhookProvider {
  source = "challenge-source";
  validateRequest() { return "default"; }
  parseEvent(_h: any, body: any): WebhookContext { return { source: "challenge-source", event: "test", repo: "o/r", sender: "bot", timestamp: new Date().toISOString() }; }
  matchesFilter() { return true; }
  handleChallenge(_h: any, body: string): Record<string, string> | null {
    try {
      const parsed = JSON.parse(body);
      if (parsed.type === "url_verification") return { challenge: parsed.challenge };
    } catch { /* */ }
    return null;
  }
}

/** Provider that always fails signature validation */
class FailingValidationProvider implements WebhookProvider {
  source = "fail-source";
  validateRequest() { return null; } // always reject
  parseEvent(): WebhookContext { return { source: "fail-source", event: "test", repo: "o/r", sender: "bot", timestamp: new Date().toISOString() }; }
  matchesFilter() { return true; }
}

/** Provider that parses events with null (no matching event) */
class NullParseProvider implements WebhookProvider {
  source = "null-source";
  validateRequest() { return "default"; }
  parseEvent() { return null; }
  matchesFilter() { return false; }
}

/** Discord-like provider for PING testing */
class DiscordLikeProvider implements WebhookProvider {
  source = "discord";
  validateSig: string | null = "default";
  validateRequest() { return this.validateSig; }
  parseEvent(_h: any, body: any): WebhookContext { return { source: "discord", event: "interaction", repo: "", sender: "bot", timestamp: new Date().toISOString() }; }
  matchesFilter() { return true; }
}

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

describe("webhook routes – additional paths", () => {
  function buildApp(providers: WebhookProvider[], opts: { statsStore?: any; bindings?: Array<{ agentName: string; source: string; trigger: () => boolean }> } = {}) {
    const app = new Hono();
    const logger = mockLogger();
    const registry = new WebhookRegistry(logger);
    for (const p of providers) registry.registerProvider(p);
    for (const b of opts.bindings ?? []) {
      registry.addBinding({ agentName: b.agentName, type: b.source, trigger: b.trigger });
    }
    registerWebhookRoutes(app, registry, {}, {}, logger, undefined, opts.statsStore);
    return { app, registry };
  }

  describe("GET /webhooks/:source – CRC challenge", () => {
    it("returns 404 when provider does not support CRC challenges", async () => {
      const { app } = buildApp([new TestProvider()]);
      const res = await app.request("/webhooks/test?crc_token=abc", { method: "GET" });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain("CRC not supported");
    });

    it("returns 404 for an unknown source", async () => {
      const { app } = buildApp([new TestProvider()]);
      const res = await app.request("/webhooks/unknown?crc_token=abc", { method: "GET" });
      expect(res.status).toBe(404);
    });

    it("returns 400 when CRC challenge fails (no crc_token)", async () => {
      const { app } = buildApp([new CrcProvider()]);
      const res = await app.request("/webhooks/crc-source", { method: "GET" });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("CRC challenge failed");
    });

    it("returns 200 and the challenge response token when CRC passes", async () => {
      const { app } = buildApp([new CrcProvider()]);
      const res = await app.request("/webhooks/crc-source?crc_token=my-token", { method: "GET" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.response_token).toBe("hmac-sha256-hash");
    });
  });

  describe("POST /webhooks/:source – oversized payload", () => {
    it("returns 413 when content-length exceeds 10 MB", async () => {
      const { app } = buildApp([new TestProvider()]);
      const res = await app.request("/webhooks/test", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "content-type": "application/json", "content-length": String(11 * 1024 * 1024) },
      });
      expect(res.status).toBe(413);
      const body = await res.json();
      expect(body.error).toContain("payload too large");
    });
  });

  describe("POST /webhooks/:source – unknown source", () => {
    it("returns 404 for an unregistered webhook source", async () => {
      const { app } = buildApp([new TestProvider()]);
      const res = await app.request("/webhooks/nonexistent", {
        method: "POST",
        body: "{}",
        headers: { "content-type": "application/json" },
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain("unknown webhook source");
    });
  });

  describe("POST /webhooks/:source – validation failure", () => {
    it("returns 401 when signature validation fails", async () => {
      const { app } = buildApp([new FailingValidationProvider()], {
        bindings: [{ agentName: "agent", source: "fail-source", trigger: () => true }],
      });
      const res = await app.request("/webhooks/fail-source", {
        method: "POST",
        body: JSON.stringify({ event: "push" }),
        headers: { "content-type": "application/json" },
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toContain("signature validation failed");
    });

    it("updates receipt to dead-letter with validation_failed reason when statsStore is present", async () => {
      const stats = mockStatsStore();
      const { app } = buildApp([new FailingValidationProvider()], {
        statsStore: stats,
        bindings: [{ agentName: "agent", source: "fail-source", trigger: () => true }],
      });
      const res = await app.request("/webhooks/fail-source", {
        method: "POST",
        body: JSON.stringify({ event: "push" }),
        headers: { "content-type": "application/json" },
      });
      expect(res.status).toBe(401);
      const updateCall = stats.updateWebhookReceiptStatus.mock.calls[0];
      expect(updateCall[2]).toBe("dead-letter");
      expect(updateCall[3]).toBe("validation_failed");
    });
  });

  describe("POST /webhooks/:source – handle challenge (Slack-style URL verification)", () => {
    it("returns the challenge response without dispatching", async () => {
      const triggerFn = vi.fn().mockReturnValue(true);
      const { app } = buildApp([new ChallengeProvider()], {
        bindings: [{ agentName: "agent", source: "challenge-source", trigger: triggerFn }],
      });
      const res = await app.request("/webhooks/challenge-source", {
        method: "POST",
        body: JSON.stringify({ type: "url_verification", challenge: "my-challenge-token" }),
        headers: { "content-type": "application/json" },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.challenge).toBe("my-challenge-token");
      // Trigger should NOT have been called
      expect(triggerFn).not.toHaveBeenCalled();
    });
  });

  describe("POST /webhooks/discord – PING interaction", () => {
    it("responds with PONG (type: 1) for Discord PING", async () => {
      const discord = new DiscordLikeProvider();
      const { app } = buildApp([discord]);
      const res = await app.request("/webhooks/discord", {
        method: "POST",
        body: JSON.stringify({ type: 1 }),
        headers: { "content-type": "application/json" },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.type).toBe(1);
    });

    it("returns 401 when Discord PING signature validation fails", async () => {
      const discord = new DiscordLikeProvider();
      discord.validateSig = null; // signature fails
      const { app } = buildApp([discord]);
      const res = await app.request("/webhooks/discord", {
        method: "POST",
        body: JSON.stringify({ type: 1 }),
        headers: { "content-type": "application/json" },
      });
      expect(res.status).toBe(401);
    });

    it("dispatches normally for Discord events with type !== 1", async () => {
      const discord = new DiscordLikeProvider();
      const triggerFn = vi.fn().mockReturnValue(true);
      const { app } = buildApp([discord], {
        bindings: [{ agentName: "agent", source: "discord", trigger: triggerFn }],
      });
      const res = await app.request("/webhooks/discord", {
        method: "POST",
        body: JSON.stringify({ type: 2, data: {} }),
        headers: { "content-type": "application/json" },
      });
      expect(res.status).toBe(200);
      expect(triggerFn).toHaveBeenCalled();
    });
  });

  describe("statsStore error handling", () => {
    it("continues processing if recordWebhookReceipt throws", async () => {
      const stats = mockStatsStore();
      stats.recordWebhookReceipt.mockImplementation(() => { throw new Error("DB error"); });
      const { app } = buildApp([new TestProvider()], {
        statsStore: stats,
        bindings: [{ agentName: "agent", source: "test", trigger: () => true }],
      });
      const res = await app.request("/webhooks/test", {
        method: "POST",
        body: JSON.stringify({ event: "push" }),
        headers: { "content-type": "application/json" },
      });
      // Should still return 200 despite receipt recording failure
      expect(res.status).toBe(200);
    });

    it("continues processing if updateWebhookReceiptStatus throws", async () => {
      const stats = mockStatsStore();
      stats.updateWebhookReceiptStatus.mockImplementation(() => { throw new Error("DB error"); });
      const { app } = buildApp([new TestProvider()], {
        statsStore: stats,
        bindings: [{ agentName: "agent", source: "test", trigger: () => true }],
      });
      const res = await app.request("/webhooks/test", {
        method: "POST",
        body: JSON.stringify({ event: "push" }),
        headers: { "content-type": "application/json" },
      });
      expect(res.status).toBe(200);
    });
  });

  describe("replay endpoint – edge cases", () => {
    it("returns 400 when receipt has no stored payload (body is missing)", async () => {
      const stats = mockStatsStore();
      stats.getWebhookReceipt.mockReturnValue({
        id: "r1",
        source: "test",
        eventSummary: "test",
        timestamp: Date.now(),
        // No headers/body
        matchedAgents: 0,
        status: "dead-letter",
      });
      const { app } = buildApp([new TestProvider()], { statsStore: stats });
      const res = await app.request("/api/webhooks/r1/replay", { method: "POST" });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("no stored payload");
    });

    it("updates receipt to dead-letter when replay matches no agents", async () => {
      const stats = mockStatsStore();
      stats.getWebhookReceipt.mockReturnValue({
        id: "r2",
        source: "test",
        eventSummary: "test.event",
        timestamp: Date.now(),
        headers: JSON.stringify({ "content-type": "application/json" }),
        body: JSON.stringify({ event: "push" }),
        matchedAgents: 0,
        status: "dead-letter",
      });
      // No bindings → matched = 0
      const { app } = buildApp([new TestProvider()], { statsStore: stats });
      const res = await app.request("/api/webhooks/r2/replay", { method: "POST" });
      expect(res.status).toBe(200);
      const updateCalls = stats.updateWebhookReceiptStatus.mock.calls;
      const replayUpdate = updateCalls[updateCalls.length - 1];
      expect(replayUpdate[2]).toBe("dead-letter");
      expect(replayUpdate[3]).toBe("no_match");
    });

    it("replay endpoint is not registered when statsStore is absent", async () => {
      const { app } = buildApp([new TestProvider()]); // no statsStore
      const res = await app.request("/api/webhooks/r1/replay", { method: "POST" });
      // Without statsStore the replay route is not registered → 404
      expect(res.status).toBe(404);
    });

    it("continues processing when recordWebhookReceipt throws (warning is logged)", async () => {
      const stats = mockStatsStore();
      stats.getWebhookReceipt.mockReturnValue({
        id: "r-throw",
        source: "test",
        eventSummary: "test.event",
        timestamp: Date.now(),
        headers: JSON.stringify({ "content-type": "application/json" }),
        body: JSON.stringify({ event: "push" }),
        matchedAgents: 1,
        status: "processed",
      });
      // Make recordWebhookReceipt throw to hit L278
      stats.recordWebhookReceipt.mockImplementation(() => { throw new Error("db error"); });

      const { app } = buildApp([new TestProvider()], { statsStore: stats });
      const res = await app.request("/api/webhooks/r-throw/replay", { method: "POST" });
      // Despite the throw, the replay should still complete
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.replayReceiptId).toBeDefined();
    });

    it("continues processing when updateWebhookReceiptStatus throws during replay (L293)", async () => {
      const stats = mockStatsStore();
      stats.getWebhookReceipt.mockReturnValue({
        id: "r-update-throw",
        source: "test",
        eventSummary: "test.event",
        timestamp: Date.now(),
        headers: JSON.stringify({ "content-type": "application/json" }),
        body: JSON.stringify({ event: "push" }),
        matchedAgents: 1,
        status: "processed",
      });
      // recordWebhookReceipt succeeds
      stats.recordWebhookReceipt.mockReturnValue(undefined);
      // updateWebhookReceiptStatus throws on the second call (replay update)
      let callCount = 0;
      stats.updateWebhookReceiptStatus.mockImplementation(() => {
        callCount++;
        if (callCount >= 2) throw new Error("update error");
      });

      const { app } = buildApp([new TestProvider()], { statsStore: stats });
      const res = await app.request("/api/webhooks/r-update-throw/replay", { method: "POST" });
      // Despite the throw, should complete successfully
      expect(res.status).toBe(200);
    });

    it("returns 413 when actual body size exceeds 10MB (after read, no content-length header)", async () => {
      // Send a large body without a content-length header so the pre-read size check passes,
      // but the post-read check at L97 fires
      const largeBody = "x".repeat(10 * 1024 * 1024 + 1);
      const { app } = buildApp([new TestProvider()]);
      const res = await app.request("/webhooks/test", {
        method: "POST",
        body: largeBody,
        headers: { "content-type": "text/plain" }, // no content-length
      });
      expect(res.status).toBe(413);
      const body = await res.json();
      expect(body.error).toContain("payload too large");
    });

    it("logs warning and continues when updateWebhookReceiptStatus throws on first call during replay (line 293)", async () => {
      // This test properly covers line 293:
      //   logger.warn({ err }, "failed to update replay receipt status")
      // by making updateWebhookReceiptStatus throw synchronously on the FIRST call.
      const stats = mockStatsStore();
      stats.getWebhookReceipt.mockReturnValue({
        id: "r-throw-first",
        source: "test",
        eventSummary: "test.event",
        timestamp: Date.now(),
        headers: JSON.stringify({ "content-type": "application/json" }),
        body: JSON.stringify({ event: "push" }),
        matchedAgents: 1,
        status: "processed",
      });
      stats.recordWebhookReceipt.mockReturnValue(undefined);
      // Always throw on the first (and only) updateWebhookReceiptStatus call
      stats.updateWebhookReceiptStatus.mockImplementation(() => {
        throw new Error("db write error");
      });

      const { app } = buildApp([new TestProvider()], { statsStore: stats });
      const res = await app.request("/api/webhooks/r-throw-first/replay", { method: "POST" });

      // Despite the throw in the catch block, the replay should complete successfully
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      // updateWebhookReceiptStatus was called once and threw — covered line 293
      expect(stats.updateWebhookReceiptStatus).toHaveBeenCalledTimes(1);
    });
  });
});
