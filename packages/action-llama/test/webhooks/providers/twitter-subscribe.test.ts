import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { twitterAutoSubscribe, type TwitterSubscribeOpts } from "../../../src/webhooks/providers/twitter-subscribe.js";

// Mock writeCredentialField so we can control its behavior per test
const { mockWriteCredentialField } = vi.hoisted(() => ({
  mockWriteCredentialField: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/shared/credentials.js", () => ({
  writeCredentialField: (...args: any[]) => mockWriteCredentialField(...args),
}));

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

  // ── refreshOAuth2Token: uncovered branches ────────────────────────────────

  describe("refreshOAuth2Token edge cases (via 401 trigger)", () => {
    it("warns and returns null when no refresh token is available", async () => {
      const logger = mockLogger();
      // Use opts with empty refresh token so refreshOAuth2Token returns null early
      const opts: TwitterSubscribeOpts = {
        ...baseOpts(logger),
        oauth2RefreshToken: "",
      };
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          data: [{ id: "123", url: "https://example.com/webhooks/twitter", valid: true }],
        }), { status: 200 })
      );
      // Subscription check → 401 (triggers refresh attempt)
      fetchSpy.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));
      // No refresh call because token is empty — oauth2Fetch returns original 401
      // Step 2 doesn't subscribe (not subscribed), step 3 subscribe POST → 200
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({}), { status: 200 })
      );

      await twitterAutoSubscribe(opts);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("no OAuth 2.0 refresh token available"),
      );
    });

    it("warns when token refresh fetch returns non-ok status", async () => {
      const logger = mockLogger();
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          data: [{ id: "123", url: "https://example.com/webhooks/twitter", valid: true }],
        }), { status: 200 })
      );
      // Subscription check → 401 (triggers refresh)
      fetchSpy.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));
      // Token refresh → 400 Bad Request
      fetchSpy.mockResolvedValueOnce(new Response("Bad Request", { status: 400 }));
      // oauth2Fetch returns original 401 (refresh failed), step 3 subscribe POST → 200
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({}), { status: 200 })
      );

      await twitterAutoSubscribe(baseOpts(logger));

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ status: 400 }),
        expect.stringContaining("failed to refresh OAuth 2.0 token"),
      );
    });

    it("warns when token refresh response is missing access_token", async () => {
      const logger = mockLogger();
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          data: [{ id: "123", url: "https://example.com/webhooks/twitter", valid: true }],
        }), { status: 200 })
      );
      // Subscription check → 401
      fetchSpy.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));
      // Token refresh → 200 but missing access_token
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ refresh_token: "new_rt" }), { status: 200 })
      );
      // oauth2Fetch returns original 401, step 3 subscribe POST → 200
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({}), { status: 200 })
      );

      await twitterAutoSubscribe(baseOpts(logger));

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("refresh response missing access_token"),
      );
    });

    it("warns when persisting refreshed tokens fails (writeCredentialField throws)", async () => {
      const logger = mockLogger();
      // Make writeCredentialField throw for this test
      mockWriteCredentialField.mockRejectedValueOnce(new Error("ENOENT: no such file"));

      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          data: [{ id: "123", url: "https://example.com/webhooks/twitter", valid: true }],
        }), { status: 200 })
      );
      // Subscription check → 401 (triggers refresh)
      fetchSpy.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));
      // Token refresh → 200 with new tokens
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "new_oat", refresh_token: "new_ort" }), { status: 200 })
      );
      // Retry subscription check with new token → subscribed
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { subscribed: true } }), { status: 200 })
      );

      await twitterAutoSubscribe(baseOpts(logger));

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringContaining("failed to persist"),
      );
    });
  });

  // ── twitterAutoSubscribe: catch blocks ────────────────────────────────────

  describe("twitterAutoSubscribe catch blocks", () => {
    it("warns when subscription status check throws a network error and proceeds to subscribe", async () => {
      const logger = mockLogger();
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          data: [{ id: "123", url: "https://example.com/webhooks/twitter", valid: true }],
        }), { status: 200 })
      );
      // oauth2Fetch for subscription check throws (network error)
      fetchSpy.mockRejectedValueOnce(new Error("ETIMEDOUT"));
      // Step 3 subscribe POST → 200 (we proceed despite step 2 error)
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({}), { status: 200 })
      );

      await twitterAutoSubscribe(baseOpts(logger));

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringContaining("failed to check Twitter subscription status"),
      );
      // Still attempts subscribe after catch
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("subscribed to Account Activity"),
      );
    });

    it("warns when subscribe POST throws a network error", async () => {
      const logger = mockLogger();
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({
          data: [{ id: "123", url: "https://example.com/webhooks/twitter", valid: true }],
        }), { status: 200 })
      );
      // Subscription check → success (not subscribed)
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { subscribed: false } }), { status: 200 })
      );
      // Subscribe POST → throws (network error)
      fetchSpy.mockRejectedValueOnce(new Error("ECONNRESET"));

      await twitterAutoSubscribe(baseOpts(logger));

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringContaining("failed to subscribe Twitter bot user"),
      );
    });
  });
});
