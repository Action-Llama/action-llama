/**
 * Integration tests: webhooks/providers/twitter.ts TwitterWebhookProvider — no Docker required.
 *
 * TwitterWebhookProvider has pure functions testable without Docker:
 *   - validateRequest(): HMAC-SHA256 (base64-encoded, not hex like GitHub)
 *   - handleCrcChallenge(): Twitter Account Activity API CRC verification
 *   - parseEvent(): parses Twitter event payloads into WebhookContext
 *   - matchesFilter(): filters by events and users
 *
 * The existing twitter-webhook.test.ts requires Docker for end-to-end tests.
 * This test covers pure methods directly.
 *
 * Covers:
 *   - webhooks/providers/twitter.ts: validateRequest() no secrets + allowUnsigned → '_unsigned'
 *   - webhooks/providers/twitter.ts: validateRequest() no secrets → null
 *   - webhooks/providers/twitter.ts: validateRequest() missing signature header → null
 *   - webhooks/providers/twitter.ts: validateRequest() valid base64-HMAC → instance name
 *   - webhooks/providers/twitter.ts: validateRequest() invalid signature → null
 *   - webhooks/providers/twitter.ts: handleCrcChallenge() valid → { response_token: "sha256=..." }
 *   - webhooks/providers/twitter.ts: handleCrcChallenge() no crc_token → null
 *   - webhooks/providers/twitter.ts: handleCrcChallenge() no secrets → null
 *   - webhooks/providers/twitter.ts: parseEvent() null body → null
 *   - webhooks/providers/twitter.ts: parseEvent() no event array key → null
 *   - webhooks/providers/twitter.ts: parseEvent() tweet_create_events → event:tweet action:create
 *   - webhooks/providers/twitter.ts: parseEvent() favorite_events → event:favorite action:favorite
 *   - webhooks/providers/twitter.ts: parseEvent() follow_events → event:follow action:follow
 *   - webhooks/providers/twitter.ts: parseEvent() direct_message_events → event:direct_message
 *   - webhooks/providers/twitter.ts: parseEvent() empty events array → null
 *   - webhooks/providers/twitter.ts: matchesFilter() no filter → true
 *   - webhooks/providers/twitter.ts: matchesFilter() events filter match/mismatch
 *   - webhooks/providers/twitter.ts: matchesFilter() users filter match/mismatch
 */

import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";

const { TwitterWebhookProvider } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/webhooks/providers/twitter.js"
);

const provider = new TwitterWebhookProvider();
const TWITTER_SECRET = "twitter-test-consumer-secret";

/** Compute valid Twitter base64-HMAC-SHA256 signature. */
function makeTwitterSignature(secret: string, rawBody: string): string {
  return "sha256=" + createHmac("sha256", secret).update(rawBody).digest("base64");
}

describe("integration: TwitterWebhookProvider pure methods (no Docker required)", { timeout: 10_000 }, () => {

  // ── validateRequest() ──────────────────────────────────────────────────────

  describe("validateRequest()", () => {
    it("returns '_unsigned' when no secrets and allowUnsigned=true", () => {
      expect(provider.validateRequest({}, "body", {}, true)).toBe("_unsigned");
    });

    it("returns null when no secrets and allowUnsigned=false", () => {
      expect(provider.validateRequest({}, "body", {}, false)).toBeNull();
    });

    it("returns null when no secrets and allowUnsigned not specified", () => {
      expect(provider.validateRequest({}, "body", undefined, undefined)).toBeNull();
    });

    it("returns null when x-twitter-webhooks-signature is missing", () => {
      expect(provider.validateRequest({}, "body", { default: TWITTER_SECRET })).toBeNull();
    });

    it("returns instance name for valid base64-HMAC signature", () => {
      const rawBody = '{"for_user_id":"123","tweet_create_events":[{}]}';
      const sig = makeTwitterSignature(TWITTER_SECRET, rawBody);
      const result = provider.validateRequest(
        { "x-twitter-webhooks-signature": sig },
        rawBody,
        { "my-twitter": TWITTER_SECRET },
      );
      expect(result).toBe("my-twitter");
    });

    it("returns null for invalid signature", () => {
      const rawBody = '{"for_user_id":"123"}';
      const result = provider.validateRequest(
        { "x-twitter-webhooks-signature": "sha256=wrongsignature" },
        rawBody,
        { default: TWITTER_SECRET },
      );
      expect(result).toBeNull();
    });
  });

  // ── handleCrcChallenge() ──────────────────────────────────────────────────

  describe("handleCrcChallenge()", () => {
    it("returns CRC response with sha256 response_token", () => {
      const crcToken = "test-crc-token-abc";
      const result = provider.handleCrcChallenge(
        { crc_token: crcToken },
        { default: TWITTER_SECRET },
      );
      expect(result).not.toBeNull();
      expect(result!.status).toBe(200);
      expect(result!.body.response_token).toMatch(/^sha256=/);
      // Verify the response_token is correct
      const expectedHmac = "sha256=" + createHmac("sha256", TWITTER_SECRET).update(crcToken).digest("base64");
      expect(result!.body.response_token).toBe(expectedHmac);
    });

    it("returns null when crc_token is missing from query params", () => {
      const result = provider.handleCrcChallenge({}, { default: TWITTER_SECRET });
      expect(result).toBeNull();
    });

    it("returns null when no secrets are provided", () => {
      const result = provider.handleCrcChallenge({ crc_token: "test-token" }, {});
      expect(result).toBeNull();
    });

    it("returns null when secrets is undefined", () => {
      const result = provider.handleCrcChallenge({ crc_token: "test-token" }, undefined);
      expect(result).toBeNull();
    });
  });

  // ── parseEvent() ────────────────────────────────────────────────────────────

  describe("parseEvent()", () => {
    it("returns null for null body", () => {
      expect(provider.parseEvent({}, null)).toBeNull();
    });

    it("returns null for non-object body", () => {
      expect(provider.parseEvent({}, "string")).toBeNull();
    });

    it("returns null when no event array key is found", () => {
      // Only metadata keys (for_user_id) — no event arrays
      expect(provider.parseEvent({}, { for_user_id: "123", user_has_blocked: false })).toBeNull();
    });

    it("returns base context (not null) when event array is empty", () => {
      // When events array is empty, firstEvent=null → returns base as WebhookContext
      const ctx = provider.parseEvent({}, { for_user_id: "123", tweet_create_events: [] });
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("tweet_create_events");
      expect(ctx!.repo).toBe("123");
    });

    it("parses tweet_create_events → event:tweet_create_events action:create", () => {
      // event = eventKey (full name), action = last part without _events suffix
      const body = {
        for_user_id: "user-123",
        tweet_create_events: [{
          id_str: "tweet-1",
          text: "Hello world!",
          user: { screen_name: "testuser" },
        }],
      };
      const ctx = provider.parseEvent({}, body);
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("tweet_create_events");
      expect(ctx!.action).toBe("create");
      expect(ctx!.repo).toBe("user-123");
      expect(ctx!.source).toBe("twitter");
      expect(ctx!.sender).toBe("testuser");
    });

    it("parses favorite_events → event:favorite_events action:favorite", () => {
      const body = {
        for_user_id: "user-456",
        favorite_events: [{
          favorited_status: { text: "liked tweet" },
          user: { screen_name: "liker" },
        }],
      };
      const ctx = provider.parseEvent({}, body);
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("favorite_events");
      expect(ctx!.action).toBe("favorite");
    });

    it("parses follow_events → event:follow_events action:follow", () => {
      const body = {
        for_user_id: "user-789",
        follow_events: [{
          target: { screen_name: "followed-user" },
          source: { screen_name: "follower" },
        }],
      };
      const ctx = provider.parseEvent({}, body);
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("follow_events");
      expect(ctx!.action).toBe("follow");
    });

    it("parses direct_message_events → event:direct_message_events", () => {
      const body = {
        for_user_id: "user-dm",
        direct_message_events: [{
          message_create: {
            sender_id: "sender-123",
            message_data: { text: "Hello DM!" },
          },
          created_timestamp: "1700000000000",
        }],
      };
      const ctx = provider.parseEvent({}, body);
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("direct_message_events");
      expect(ctx!.sender).toBe("sender-123");
      expect(ctx!.title).toContain("Direct message");
    });

    it("parses unknown event key → event is the full key name", () => {
      const body = {
        for_user_id: "user-x",
        custom_events: [{ id: "custom-1" }],
      };
      const ctx = provider.parseEvent({}, body);
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("custom_events");
    });
  });

  // ── matchesFilter() ────────────────────────────────────────────────────────

  describe("matchesFilter()", () => {
    const ctx: any = {
      source: "twitter",
      event: "tweet_create_events",  // event = full event key
      action: "create",
      repo: "user-123",  // for_user_id stored as repo
      sender: "testuser",
      timestamp: new Date().toISOString(),
    };

    it("matches when no filter", () => {
      expect(provider.matchesFilter(ctx, {})).toBe(true);
    });

    it("matches when events filter includes the event (full key name)", () => {
      expect(provider.matchesFilter(ctx, { events: ["tweet_create_events"] })).toBe(true);
    });

    it("does not match when events filter excludes the event", () => {
      expect(provider.matchesFilter(ctx, { events: ["follow_events"] })).toBe(false);
    });

    it("matches when users filter includes the user", () => {
      expect(provider.matchesFilter(ctx, { users: ["user-123"] } as any)).toBe(true);
    });

    it("does not match when users filter excludes the user", () => {
      expect(provider.matchesFilter(ctx, { users: ["other-user"] } as any)).toBe(false);
    });

    it("matches when both events and users match", () => {
      expect(provider.matchesFilter(ctx, { events: ["tweet_create_events"], users: ["user-123"] } as any)).toBe(true);
    });

    it("does not match when events match but users don't", () => {
      expect(provider.matchesFilter(ctx, { events: ["tweet_create_events"], users: ["wrong-user"] } as any)).toBe(false);
    });
  });
});
