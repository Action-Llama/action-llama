/**
 * Integration tests: webhooks/providers/slack.ts SlackWebhookProvider — no Docker required.
 *
 * SlackWebhookProvider has pure functions that can be tested without Docker:
 *   - validateRequest(): HMAC-SHA256 signature validation with Slack v0 format
 *   - parseEvent(): parses Slack event_callback payloads into WebhookContext
 *   - matchesFilter(): filters by events/team_ids/channels
 *   - handleChallenge(): handles URL verification challenges
 *
 * The existing slack-webhook.test.ts requires Docker. This test exercises
 * the same methods directly without Docker infrastructure.
 *
 * Covers:
 *   - webhooks/providers/slack.ts: validateRequest() no secrets + allowUnsigned → '_unsigned'
 *   - webhooks/providers/slack.ts: validateRequest() no secrets → null
 *   - webhooks/providers/slack.ts: validateRequest() missing timestamp → null
 *   - webhooks/providers/slack.ts: validateRequest() missing signature → null
 *   - webhooks/providers/slack.ts: validateRequest() stale timestamp → null
 *   - webhooks/providers/slack.ts: validateRequest() valid HMAC signature → instance name
 *   - webhooks/providers/slack.ts: validateRequest() invalid HMAC signature → null
 *   - webhooks/providers/slack.ts: parseEvent() url_verification → null (not dispatched)
 *   - webhooks/providers/slack.ts: parseEvent() non-event_callback type → null
 *   - webhooks/providers/slack.ts: parseEvent() no event field → null
 *   - webhooks/providers/slack.ts: parseEvent() message event → WebhookContext with event:message
 *   - webhooks/providers/slack.ts: parseEvent() app_mention → WebhookContext with channel comment
 *   - webhooks/providers/slack.ts: parseEvent() reaction_added → title = reaction name
 *   - webhooks/providers/slack.ts: parseEvent() unknown event type → generic context
 *   - webhooks/providers/slack.ts: matchesFilter() no filter → true
 *   - webhooks/providers/slack.ts: matchesFilter() events filter matches → true
 *   - webhooks/providers/slack.ts: matchesFilter() events filter mismatches → false
 *   - webhooks/providers/slack.ts: matchesFilter() team_ids filter matches → true
 *   - webhooks/providers/slack.ts: matchesFilter() team_ids filter mismatches → false
 *   - webhooks/providers/slack.ts: matchesFilter() channels filter matches → true
 *   - webhooks/providers/slack.ts: matchesFilter() channels filter mismatches → false
 *   - webhooks/providers/slack.ts: handleChallenge() url_verification → challenge response
 *   - webhooks/providers/slack.ts: handleChallenge() non-verification body → null
 *   - webhooks/providers/slack.ts: handleChallenge() invalid JSON → null
 */

import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";

const { SlackWebhookProvider } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/webhooks/providers/slack.js"
);

const provider = new SlackWebhookProvider();

/** Build valid Slack v0 HMAC signature headers for testing. */
function makeSlackSignature(secret: string, rawBody: string): { "x-slack-signature": string; "x-slack-request-timestamp": string } {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signingBase = `v0:${timestamp}:${rawBody}`;
  const signature = "v0=" + createHmac("sha256", secret).update(signingBase).digest("hex");
  return {
    "x-slack-signature": signature,
    "x-slack-request-timestamp": timestamp,
  };
}

const SLACK_SECRET = "slack-test-signing-secret";

describe("integration: SlackWebhookProvider (no Docker required)", { timeout: 10_000 }, () => {

  // ── validateRequest() ──────────────────────────────────────────────────────

  describe("validateRequest()", () => {
    it("returns '_unsigned' when no secrets and allowUnsigned=true", () => {
      const result = provider.validateRequest({}, "body", {}, true);
      expect(result).toBe("_unsigned");
    });

    it("returns null when no secrets and allowUnsigned=false", () => {
      const result = provider.validateRequest({}, "body", {}, false);
      expect(result).toBeNull();
    });

    it("returns null when no secrets and allowUnsigned not set", () => {
      const result = provider.validateRequest({}, "body", undefined, undefined);
      expect(result).toBeNull();
    });

    it("returns null when x-slack-request-timestamp is missing", () => {
      const result = provider.validateRequest(
        { "x-slack-signature": "v0=abc" },
        "body",
        { default: SLACK_SECRET },
      );
      expect(result).toBeNull();
    });

    it("returns null when x-slack-signature is missing", () => {
      const result = provider.validateRequest(
        { "x-slack-request-timestamp": "1234567890" },
        "body",
        { default: SLACK_SECRET },
      );
      expect(result).toBeNull();
    });

    it("returns null when timestamp is stale (older than 5 minutes)", () => {
      const staleTimestamp = String(Math.floor(Date.now() / 1000) - 400); // 6+ minutes ago
      const result = provider.validateRequest(
        { "x-slack-request-timestamp": staleTimestamp, "x-slack-signature": "v0=abc" },
        "body",
        { default: SLACK_SECRET },
      );
      expect(result).toBeNull();
    });

    it("returns instance name for valid HMAC signature", () => {
      const rawBody = '{"type":"event_callback","event":{"type":"message"}}';
      const headers = makeSlackSignature(SLACK_SECRET, rawBody);
      const result = provider.validateRequest(headers, rawBody, { "my-slack": SLACK_SECRET });
      expect(result).toBe("my-slack");
    });

    it("returns null for invalid HMAC signature", () => {
      const rawBody = '{"type":"event_callback"}';
      const headers = makeSlackSignature("wrong-secret", rawBody);
      const result = provider.validateRequest(headers, rawBody, { default: SLACK_SECRET });
      expect(result).toBeNull();
    });
  });

  // ── parseEvent() ──────────────────────────────────────────────────────────

  describe("parseEvent()", () => {
    it("returns null for url_verification type", () => {
      const result = provider.parseEvent({}, { type: "url_verification", challenge: "abc" });
      expect(result).toBeNull();
    });

    it("returns null for non-event_callback type", () => {
      const result = provider.parseEvent({}, { type: "interactive_callback" });
      expect(result).toBeNull();
    });

    it("returns null when no event field in event_callback", () => {
      const result = provider.parseEvent({}, { type: "event_callback", team_id: "T123" });
      expect(result).toBeNull();
    });

    it("parses message event into WebhookContext", () => {
      const body = {
        type: "event_callback",
        team_id: "T12345",
        event: {
          type: "message",
          text: "Hello from Slack",
          user: "U67890",
          channel: "C111",
        },
      };
      const ctx = provider.parseEvent({}, body);
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("message");
      expect(ctx!.source).toBe("slack");
      expect(ctx!.repo).toBe("T12345");
      expect(ctx!.sender).toBe("U67890");
      expect(ctx!.body).toContain("Hello from Slack");
      expect(ctx!.comment).toBe("channel:C111");
    });

    it("parses app_mention event with channel in comment", () => {
      const body = {
        type: "event_callback",
        team_id: "T12345",
        event: {
          type: "app_mention",
          text: "@mybot do something",
          user: "U99",
          channel: "C222",
        },
      };
      const ctx = provider.parseEvent({}, body);
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("app_mention");
      expect(ctx!.comment).toBe("channel:C222");
    });

    it("parses reaction_added event with reaction as title", () => {
      const body = {
        type: "event_callback",
        team_id: "T12345",
        event: {
          type: "reaction_added",
          reaction: "thumbsup",
          user: "U99",
          item: { type: "message", channel: "C333" },
        },
      };
      const ctx = provider.parseEvent({}, body);
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("reaction_added");
      expect(ctx!.title).toBe("thumbsup");
      expect(ctx!.comment).toBe("message:C333");
    });

    it("parses unknown event type with generic context", () => {
      const body = {
        type: "event_callback",
        team_id: "T12345",
        event: {
          type: "custom_event_xyz",
          user: "U00",
          text: "some text",
        },
      };
      const ctx = provider.parseEvent({}, body);
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("custom_event_xyz");
      expect(ctx!.title).toBe("custom_event_xyz");
    });

    it("uses bot_id as sender when user is absent", () => {
      const body = {
        type: "event_callback",
        team_id: "T12345",
        event: { type: "message", bot_id: "B001", text: "bot message", channel: "C111" },
      };
      const ctx = provider.parseEvent({}, body);
      expect(ctx!.sender).toBe("B001");
    });

    it("falls back to 'unknown' sender when neither user nor bot_id is set", () => {
      const body = {
        type: "event_callback",
        team_id: "T12345",
        event: { type: "message", text: "anonymous", channel: "C111" },
      };
      const ctx = provider.parseEvent({}, body);
      expect(ctx!.sender).toBe("unknown");
    });
  });

  // ── matchesFilter() ────────────────────────────────────────────────────────

  describe("matchesFilter()", () => {
    const ctx = {
      source: "slack",
      event: "message",
      repo: "T12345",
      sender: "U001",
      timestamp: new Date().toISOString(),
      comment: "channel:C111",
    } as any;

    it("matches any event when no filter specified", () => {
      expect(provider.matchesFilter(ctx, {})).toBe(true);
    });

    it("matches when events filter includes the event", () => {
      expect(provider.matchesFilter(ctx, { events: ["message"] })).toBe(true);
    });

    it("does not match when events filter excludes the event", () => {
      expect(provider.matchesFilter(ctx, { events: ["app_mention"] })).toBe(false);
    });

    it("matches when team_ids filter includes the team", () => {
      expect(provider.matchesFilter(ctx, { team_ids: ["T12345"] } as any)).toBe(true);
    });

    it("does not match when team_ids filter excludes the team", () => {
      expect(provider.matchesFilter(ctx, { team_ids: ["T99999"] } as any)).toBe(false);
    });

    it("matches when channels filter includes the channel", () => {
      expect(provider.matchesFilter(ctx, { channels: ["C111"] } as any)).toBe(true);
    });

    it("does not match when channels filter excludes the channel", () => {
      expect(provider.matchesFilter(ctx, { channels: ["C999"] } as any)).toBe(false);
    });

    it("does not match channel filter when comment is absent", () => {
      const ctxNoChannel = { ...ctx, comment: undefined };
      expect(provider.matchesFilter(ctxNoChannel, { channels: ["C111"] } as any)).toBe(false);
    });

    it("does not match channel filter when comment has wrong format", () => {
      const ctxBadComment = { ...ctx, comment: "not-channel-format" };
      expect(provider.matchesFilter(ctxBadComment, { channels: ["not-channel-format"] } as any)).toBe(false);
    });
  });

  // ── handleChallenge() ─────────────────────────────────────────────────────

  describe("handleChallenge()", () => {
    it("returns challenge response for url_verification body when allowUnsigned", () => {
      const rawBody = JSON.stringify({ type: "url_verification", challenge: "test-challenge-xyz" });
      const result = provider.handleChallenge({}, rawBody, undefined, true);
      expect(result).toEqual({ challenge: "test-challenge-xyz" });
    });

    it("returns null for non-verification body type", () => {
      const rawBody = JSON.stringify({ type: "event_callback" });
      const result = provider.handleChallenge({}, rawBody, undefined, true);
      expect(result).toBeNull();
    });

    it("returns null when body has no challenge field", () => {
      const rawBody = JSON.stringify({ type: "url_verification" });
      const result = provider.handleChallenge({}, rawBody, undefined, true);
      expect(result).toBeNull();
    });

    it("returns null for invalid JSON body", () => {
      const result = provider.handleChallenge({}, "not-valid-json", undefined, true);
      expect(result).toBeNull();
    });

    it("validates signature when secrets provided — returns null for invalid sig", () => {
      const rawBody = JSON.stringify({ type: "url_verification", challenge: "ch1" });
      const headers = { "x-slack-request-timestamp": "9999", "x-slack-signature": "v0=invalid" };
      const result = provider.handleChallenge(headers, rawBody, { default: SLACK_SECRET }, false);
      expect(result).toBeNull();
    });
  });
});
