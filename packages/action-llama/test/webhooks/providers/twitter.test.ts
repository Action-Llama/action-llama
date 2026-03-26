import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { TwitterWebhookProvider } from "../../../src/webhooks/providers/twitter.js";
import type { TwitterWebhookFilter } from "../../../src/webhooks/types.js";

const provider = new TwitterWebhookProvider();

function sign(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

function crcBase64(token: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(token).digest("base64");
}

describe("TwitterWebhookProvider", () => {
  describe("validateRequest", () => {
    const secret = "test-consumer-secret";

    it("accepts valid HMAC signature and returns instance name", () => {
      const body = '{"for_user_id":"123","tweet_create_events":[]}';
      const sig = sign(body, secret);
      expect(provider.validateRequest({ "x-twitter-webhooks-signature": sig }, body, { myApp: secret })).toBe("myApp");
    });

    it("rejects invalid HMAC signature", () => {
      const body = '{"for_user_id":"123"}';
      const sig = sign("different body", secret);
      expect(provider.validateRequest({ "x-twitter-webhooks-signature": sig }, body, { myApp: secret })).toBeNull();
    });

    it("rejects missing signature when secret is configured", () => {
      expect(provider.validateRequest({}, '{"for_user_id":"123"}', { myApp: secret })).toBeNull();
    });

    it("accepts any request when no secret is configured and allowUnsigned is true", () => {
      expect(provider.validateRequest({}, '{}', undefined, true)).toBe("_unsigned");
      expect(provider.validateRequest({}, '{}', {}, true)).toBe("_unsigned");
    });

    it("rejects requests when no secret is configured and allowUnsigned is false", () => {
      expect(provider.validateRequest({}, '{}')).toBeNull();
      expect(provider.validateRequest({}, '{}', undefined)).toBeNull();
      expect(provider.validateRequest({}, '{}', {})).toBeNull();
    });

    it("accepts when any of multiple secrets matches and returns correct instance", () => {
      const body = '{"for_user_id":"123"}';
      const sig = sign(body, "second-secret");
      expect(provider.validateRequest({ "x-twitter-webhooks-signature": sig }, body, { AppA: "wrong-secret", AppB: "second-secret" })).toBe("AppB");
    });

    it("rejects when none of multiple secrets match", () => {
      const body = '{"for_user_id":"123"}';
      const sig = sign(body, "actual-secret");
      expect(provider.validateRequest({ "x-twitter-webhooks-signature": sig }, body, { AppA: "wrong1", AppB: "wrong2" })).toBeNull();
    });
  });

  describe("handleCrcChallenge", () => {
    const secret = "consumer-secret-abc";

    it("returns correct base64 response_token for valid crc_token", () => {
      const crcToken = "test_crc_token_123";
      const result = provider.handleCrcChallenge({ crc_token: crcToken }, { myApp: secret });
      expect(result).not.toBeNull();
      expect(result!.status).toBe(200);
      expect(result!.body.response_token).toBe(crcBase64(crcToken, secret));
    });

    it("uses sha256= prefix in response_token", () => {
      const result = provider.handleCrcChallenge({ crc_token: "token" }, { myApp: secret });
      expect(result!.body.response_token).toMatch(/^sha256=/);
    });

    it("returns null when crc_token is missing", () => {
      expect(provider.handleCrcChallenge({}, { myApp: secret })).toBeNull();
    });

    it("returns null when no secrets are provided", () => {
      expect(provider.handleCrcChallenge({ crc_token: "token" }, undefined)).toBeNull();
      expect(provider.handleCrcChallenge({ crc_token: "token" }, {})).toBeNull();
    });

    it("uses the first available secret when multiple are provided", () => {
      const secrets = { first: "secret1", second: "secret2" };
      const result = provider.handleCrcChallenge({ crc_token: "mytoken" }, secrets);
      expect(result).not.toBeNull();
      // Should match the first secret in object iteration order
      const firstSecret = Object.values(secrets)[0];
      expect(result!.body.response_token).toBe(crcBase64("mytoken", firstSecret));
    });
  });

  describe("parseEvent", () => {
    it("returns null for null body", () => {
      expect(provider.parseEvent({}, null)).toBeNull();
    });

    it("returns null for non-object body", () => {
      expect(provider.parseEvent({}, "string")).toBeNull();
      expect(provider.parseEvent({}, 42)).toBeNull();
    });

    it("returns null when no event arrays found", () => {
      expect(provider.parseEvent({}, { for_user_id: "123" })).toBeNull();
    });

    it("parses tweet_create_events", () => {
      const body = {
        for_user_id: "123456",
        tweet_create_events: [
          {
            id_str: "tweet_001",
            text: "Hello Twitter!",
            created_at: "Thu Mar 26 18:00:00 +0000 2026",
            user: { screen_name: "alice", id_str: "111" },
          },
        ],
      };
      const ctx = provider.parseEvent({}, body);
      expect(ctx).not.toBeNull();
      expect(ctx!.source).toBe("twitter");
      expect(ctx!.event).toBe("tweet_create_events");
      expect(ctx!.action).toBe("create");
      expect(ctx!.repo).toBe("123456");
      expect(ctx!.sender).toBe("alice");
      expect(ctx!.title).toBe("Hello Twitter!");
      expect(ctx!.url).toContain("tweet_001");
    });

    it("parses tweet_delete_events", () => {
      const body = {
        for_user_id: "123456",
        tweet_delete_events: [
          {
            user_id: "111",
            status: { id: "tweet_001" },
            timestamp_ms: "1742000000000",
          },
        ],
      };
      const ctx = provider.parseEvent({}, body);
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("tweet_delete_events");
      expect(ctx!.action).toBe("delete");
      expect(ctx!.sender).toBe("111");
    });

    it("parses favorite_events", () => {
      const body = {
        for_user_id: "123456",
        favorite_events: [
          {
            user: { screen_name: "bob" },
            created_at: "Thu Mar 26 18:00:00 +0000 2026",
            favorited_status: {
              id_str: "tweet_002",
              text: "Original tweet",
              user: { screen_name: "alice" },
            },
          },
        ],
      };
      const ctx = provider.parseEvent({}, body);
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("favorite_events");
      expect(ctx!.action).toBe("favorite");
      expect(ctx!.sender).toBe("bob");
      expect(ctx!.body).toBe("Original tweet");
    });

    it("parses follow_events", () => {
      const body = {
        for_user_id: "123456",
        follow_events: [
          {
            source: { screen_name: "bob", id: "222" },
            target: { screen_name: "alice", id: "111" },
            created_timestamp: "1742000000000",
          },
        ],
      };
      const ctx = provider.parseEvent({}, body);
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("follow_events");
      expect(ctx!.action).toBe("follow");
      expect(ctx!.sender).toBe("bob");
      expect(ctx!.title).toContain("followed");
    });

    it("parses direct_message_events", () => {
      const body = {
        for_user_id: "123456",
        direct_message_events: [
          {
            created_timestamp: "1742000000000",
            message_create: {
              sender_id: "999",
              message_data: { text: "Hey there!" },
            },
          },
        ],
      };
      const ctx = provider.parseEvent({}, body);
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("direct_message_events");
      expect(ctx!.sender).toBe("999");
      expect(ctx!.body).toBe("Hey there!");
    });

    it("handles events with empty arrays gracefully", () => {
      const body = {
        for_user_id: "123456",
        tweet_create_events: [],
      };
      const ctx = provider.parseEvent({}, body);
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("tweet_create_events");
      expect(ctx!.repo).toBe("123456");
    });

    it("handles malformed tweet with missing user", () => {
      const body = {
        for_user_id: "123456",
        tweet_create_events: [{ id_str: "001", text: "no user" }],
      };
      const ctx = provider.parseEvent({}, body);
      expect(ctx).not.toBeNull();
      expect(ctx!.sender).toBe("unknown");
    });
  });

  describe("matchesFilter", () => {
    const baseCtx = {
      source: "twitter",
      event: "tweet_create_events",
      action: "create",
      repo: "123456",
      sender: "alice",
      timestamp: new Date().toISOString(),
    };

    it("empty filter matches all events", () => {
      expect(provider.matchesFilter(baseCtx, {})).toBe(true);
    });

    it("events filter matches when event is in the list", () => {
      const filter: TwitterWebhookFilter = { events: ["tweet_create_events", "favorite_events"] };
      expect(provider.matchesFilter(baseCtx, filter)).toBe(true);
    });

    it("events filter rejects when event is not in the list", () => {
      const filter: TwitterWebhookFilter = { events: ["favorite_events"] };
      expect(provider.matchesFilter(baseCtx, filter)).toBe(false);
    });

    it("users filter matches when repo (for_user_id) is in the list", () => {
      const filter: TwitterWebhookFilter = { users: ["123456", "789012"] };
      expect(provider.matchesFilter(baseCtx, filter)).toBe(true);
    });

    it("users filter rejects when repo is not in the list", () => {
      const filter: TwitterWebhookFilter = { users: ["999999"] };
      expect(provider.matchesFilter(baseCtx, filter)).toBe(false);
    });

    it("combined events and users filter — both must match", () => {
      const filter: TwitterWebhookFilter = {
        events: ["tweet_create_events"],
        users: ["123456"],
      };
      expect(provider.matchesFilter(baseCtx, filter)).toBe(true);
    });

    it("combined events and users filter — rejects when users don't match", () => {
      const filter: TwitterWebhookFilter = {
        events: ["tweet_create_events"],
        users: ["999999"],
      };
      expect(provider.matchesFilter(baseCtx, filter)).toBe(false);
    });
  });
});
