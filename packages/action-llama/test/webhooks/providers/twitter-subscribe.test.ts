import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { twitterAutoSubscribe, type TwitterSubscribeOpts } from "../../../src/webhooks/providers/twitter-subscribe.js";

function mockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
    fatal: vi.fn(),
    trace: vi.fn(),
    level: "info",
    silent: vi.fn(),
    isLevelEnabled: vi.fn().mockReturnValue(true),
  } as any;
}

function baseOpts(logger: any): TwitterSubscribeOpts {
  return {
    bearerToken: "bt",
    oauth2AccessToken: "oat",
    oauth2RefreshToken: "ort",
    oauth2ClientId: "cid",
    oauth2ClientSecret: "csec",
    credentialInstance: "default",
    logger,
  };
}

describe("twitterAutoSubscribe", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("warns and returns when no webhook URL is registered", async () => {
    const logger = mockLogger();
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [] }), { status: 200 })
    );

    await twitterAutoSubscribe(baseOpts(logger));

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("no webhook URL registered"));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("warns and returns when webhook list API fails", async () => {
    const logger = mockLogger();
    fetchSpy.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));

    await twitterAutoSubscribe(baseOpts(logger));

    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }), expect.stringContaining("failed to check"));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("skips subscribe when bot user is already subscribed", async () => {
    const logger = mockLogger();
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({
        data: [{ id: "123", url: "https://example.com/webhooks/twitter", valid: true }],
      }), { status: 200 })
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { subscribed: true } }), { status: 200 })
    );

    await twitterAutoSubscribe(baseOpts(logger));

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("already subscribed"));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("subscribes when bot user is not subscribed", async () => {
    const logger = mockLogger();
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({
        data: [{ id: "123", url: "https://example.com/webhooks/twitter", valid: true }],
      }), { status: 200 })
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { subscribed: false } }), { status: 200 })
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { subscribed: true } }), { status: 200 })
    );

    await twitterAutoSubscribe(baseOpts(logger));

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("subscribed to Account Activity"));
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    const postCall = fetchSpy.mock.calls[2];
    expect(postCall[1]?.method).toBe("POST");
  });

  it("warns when subscribe POST fails", async () => {
    const logger = mockLogger();
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({
        data: [{ id: "123", url: "https://example.com/webhooks/twitter", valid: true }],
      }), { status: 200 })
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { subscribed: false } }), { status: 200 })
    );
    fetchSpy.mockResolvedValueOnce(new Response("Forbidden", { status: 403 }));

    await twitterAutoSubscribe(baseOpts(logger));

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ status: 403 }),
      expect.stringContaining("failed to subscribe"),
    );
  });

  it("warns when webhook URL is marked invalid", async () => {
    const logger = mockLogger();
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({
        data: [{ id: "123", url: "https://example.com/webhooks/twitter", valid: false }],
      }), { status: 200 })
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { subscribed: true } }), { status: 200 })
    );

    await twitterAutoSubscribe(baseOpts(logger));

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://example.com/webhooks/twitter" }),
      expect.stringContaining("marked as invalid"),
    );
  });

  it("handles network errors gracefully", async () => {
    const logger = mockLogger();
    fetchSpy.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await twitterAutoSubscribe(baseOpts(logger));

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining("failed to check"),
    );
  });

  it("uses webhook_id from list response in subscription URLs", async () => {
    const logger = mockLogger();
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({
        data: [{ id: "456789", url: "https://example.com/webhooks/twitter", valid: true }],
      }), { status: 200 })
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { subscribed: true } }), { status: 200 })
    );

    await twitterAutoSubscribe(baseOpts(logger));

    const subCall = fetchSpy.mock.calls[1];
    expect(subCall[0]).toContain("/webhooks/456789/");
  });

  it("uses Bearer Token for webhook list, OAuth 2.0 user token for subscriptions", async () => {
    const logger = mockLogger();
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({
        data: [{ id: "123", url: "https://example.com/webhooks/twitter", valid: true }],
      }), { status: 200 })
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { subscribed: true } }), { status: 200 })
    );

    await twitterAutoSubscribe(baseOpts(logger));

    // First call (webhook list) uses app-only Bearer Token
    const listHeaders = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(listHeaders.Authorization).toBe("Bearer bt");

    // Second call (subscription check) uses OAuth 2.0 user Bearer Token
    const subHeaders = fetchSpy.mock.calls[1][1]?.headers as Record<string, string>;
    expect(subHeaders.Authorization).toBe("Bearer oat");
  });

  it("refreshes token on 401 and retries", async () => {
    const logger = mockLogger();
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({
        data: [{ id: "123", url: "https://example.com/webhooks/twitter", valid: true }],
      }), { status: 200 })
    );
    // GET subscription check → 401 (token expired)
    fetchSpy.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));
    // Token refresh → success
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "new_oat", refresh_token: "new_ort" }), { status: 200 })
    );
    // Retry GET subscription check with new token → subscribed
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { subscribed: true } }), { status: 200 })
    );

    await twitterAutoSubscribe(baseOpts(logger));

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("expired"));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("already subscribed"));

    // Verify the retry used the new token
    const retryHeaders = fetchSpy.mock.calls[3][1]?.headers as Record<string, string>;
    expect(retryHeaders.Authorization).toBe("Bearer new_oat");
  });
});
