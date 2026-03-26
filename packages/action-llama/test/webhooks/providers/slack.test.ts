import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHmac } from "crypto";
import { SlackWebhookProvider } from "../../../src/webhooks/providers/slack.js";
import type { SlackWebhookFilter, WebhookContext } from "../../../src/webhooks/types.js";

const provider = new SlackWebhookProvider();

const secret = "slack-signing-secret-123";

function makeTimestamp(): string {
  return String(Math.floor(Date.now() / 1000));
}

function sign(rawBody: string, timestamp: string, s: string): string {
  const signingBase = `v0:${timestamp}:${rawBody}`;
  return "v0=" + createHmac("sha256", s).update(signingBase).digest("hex");
}

describe("SlackWebhookProvider", () => {
  describe("validateRequest", () => {
    it("accepts valid signature and returns instance name", () => {
      const body = '{"type":"event_callback","event":{"type":"message"}}';
      const ts = makeTimestamp();
      const sig = sign(body, ts, secret);
      expect(
        provider.validateRequest(
          { "x-slack-signature": sig, "x-slack-request-timestamp": ts },
          body,
          { MyWorkspace: secret }
        )
      ).toBe("MyWorkspace");
    });

    it("rejects invalid signature", () => {
      const body = '{"type":"event_callback"}';
      const ts = makeTimestamp();
      const sig = sign("different body", ts, secret);
      expect(
        provider.validateRequest(
          { "x-slack-signature": sig, "x-slack-request-timestamp": ts },
          body,
          { MyWorkspace: secret }
        )
      ).toBeNull();
    });

    it("rejects missing signature header", () => {
      const body = '{"type":"event_callback"}';
      const ts = makeTimestamp();
      expect(
        provider.validateRequest(
          { "x-slack-request-timestamp": ts },
          body,
          { MyWorkspace: secret }
        )
      ).toBeNull();
    });

    it("rejects missing timestamp header", () => {
      const body = '{"type":"event_callback"}';
      const ts = makeTimestamp();
      const sig = sign(body, ts, secret);
      expect(
        provider.validateRequest(
          { "x-slack-signature": sig },
          body,
          { MyWorkspace: secret }
        )
      ).toBeNull();
    });

    it("rejects stale timestamp (older than 5 minutes)", () => {
      const body = '{"type":"event_callback"}';
      const staleTs = String(Math.floor(Date.now() / 1000) - 400); // 400 seconds ago
      const sig = sign(body, staleTs, secret);
      expect(
        provider.validateRequest(
          { "x-slack-signature": sig, "x-slack-request-timestamp": staleTs },
          body,
          { MyWorkspace: secret }
        )
      ).toBeNull();
    });

    it("allows unsigned when no secrets and allowUnsigned is true", () => {
      const body = '{"type":"event_callback"}';
      const ts = makeTimestamp();
      expect(provider.validateRequest({ "x-slack-request-timestamp": ts }, body, undefined, true)).toBe("_unsigned");
      expect(provider.validateRequest({ "x-slack-request-timestamp": ts }, body, {}, true)).toBe("_unsigned");
    });

    it("rejects when no secrets and allowUnsigned is false", () => {
      const body = '{"type":"event_callback"}';
      const ts = makeTimestamp();
      expect(provider.validateRequest({ "x-slack-request-timestamp": ts }, body, undefined, false)).toBeNull();
      expect(provider.validateRequest({ "x-slack-request-timestamp": ts }, body, {})).toBeNull();
    });

    it("matches correct instance when multiple secrets configured", () => {
      const body = '{"type":"event_callback"}';
      const ts = makeTimestamp();
      const sig = sign(body, ts, "second-secret");
      expect(
        provider.validateRequest(
          { "x-slack-signature": sig, "x-slack-request-timestamp": ts },
          body,
          { WorkspaceA: "wrong-secret", WorkspaceB: "second-secret" }
        )
      ).toBe("WorkspaceB");
    });

    it("rejects when none of multiple secrets match", () => {
      const body = '{"type":"event_callback"}';
      const ts = makeTimestamp();
      const sig = sign(body, ts, "actual-secret");
      expect(
        provider.validateRequest(
          { "x-slack-signature": sig, "x-slack-request-timestamp": ts },
          body,
          { WorkspaceA: "wrong-secret", WorkspaceB: "also-wrong" }
        )
      ).toBeNull();
    });
  });

  describe("parseEvent", () => {
    it("parses message event callback", () => {
      const body = {
        type: "event_callback",
        team_id: "T123",
        event: {
          type: "message",
          user: "U456",
          text: "Hello world",
          channel: "C789",
        },
      };
      const result = provider.parseEvent({}, body);
      expect(result).toMatchObject({
        source: "slack",
        event: "message",
        repo: "T123",
        sender: "U456",
        body: "Hello world",
        comment: "channel:C789",
      });
    });

    it("parses app_mention event callback", () => {
      const body = {
        type: "event_callback",
        team_id: "T123",
        event: {
          type: "app_mention",
          user: "U456",
          text: "<@BOTID> hello",
          channel: "C789",
        },
      };
      const result = provider.parseEvent({}, body);
      expect(result).toMatchObject({
        source: "slack",
        event: "app_mention",
        repo: "T123",
        sender: "U456",
        body: "<@BOTID> hello",
        comment: "channel:C789",
      });
    });

    it("parses reaction_added event callback", () => {
      const body = {
        type: "event_callback",
        team_id: "T123",
        event: {
          type: "reaction_added",
          user: "U456",
          reaction: "thumbsup",
          item: { type: "message", channel: "C789" },
        },
      };
      const result = provider.parseEvent({}, body);
      expect(result).toMatchObject({
        source: "slack",
        event: "reaction_added",
        repo: "T123",
        sender: "U456",
        title: "thumbsup",
      });
    });

    it("returns null for url_verification type", () => {
      const body = {
        type: "url_verification",
        challenge: "abc123",
      };
      expect(provider.parseEvent({}, body)).toBeNull();
    });

    it("returns null for non-event_callback types", () => {
      expect(provider.parseEvent({}, { type: "block_actions" })).toBeNull();
    });

    it("returns null when event field is missing", () => {
      expect(provider.parseEvent({}, { type: "event_callback", team_id: "T123" })).toBeNull();
    });

    it("handles truncation of long text", () => {
      const longText = "x".repeat(5000);
      const body = {
        type: "event_callback",
        team_id: "T123",
        event: {
          type: "message",
          user: "U456",
          text: longText,
          channel: "C789",
        },
      };
      const result = provider.parseEvent({}, body);
      expect(result?.body).toMatch(/^x+\.\.\.$/);
      expect((result?.body?.length ?? 0)).toBeLessThan(longText.length);
    });

    it("handles unknown event types gracefully", () => {
      const body = {
        type: "event_callback",
        team_id: "T123",
        event: {
          type: "channel_archive",
          user: "U456",
        },
      };
      const result = provider.parseEvent({}, body);
      expect(result).toMatchObject({
        source: "slack",
        event: "channel_archive",
        repo: "T123",
        sender: "U456",
      });
    });
  });

  describe("matchesFilter", () => {
    const context: WebhookContext = {
      source: "slack",
      event: "message",
      repo: "T123",
      sender: "U456",
      comment: "channel:C789",
      timestamp: "2024-01-01T12:00:00Z",
    };

    it("matches when no filters are specified", () => {
      const filter: SlackWebhookFilter = {};
      expect(provider.matchesFilter(context, filter)).toBe(true);
    });

    it("matches when event filter matches", () => {
      const filter: SlackWebhookFilter = { events: ["message", "app_mention"] };
      expect(provider.matchesFilter(context, filter)).toBe(true);
    });

    it("does not match when event filter does not match", () => {
      const filter: SlackWebhookFilter = { events: ["app_mention"] };
      expect(provider.matchesFilter(context, filter)).toBe(false);
    });

    it("matches when team_id filter matches", () => {
      const filter: SlackWebhookFilter = { team_ids: ["T123", "T456"] };
      expect(provider.matchesFilter(context, filter)).toBe(true);
    });

    it("does not match when team_id filter does not match", () => {
      const filter: SlackWebhookFilter = { team_ids: ["T999"] };
      expect(provider.matchesFilter(context, filter)).toBe(false);
    });

    it("matches when channel filter matches", () => {
      const filter: SlackWebhookFilter = { channels: ["C789"] };
      expect(provider.matchesFilter(context, filter)).toBe(true);
    });

    it("does not match when channel filter does not match", () => {
      const filter: SlackWebhookFilter = { channels: ["C999"] };
      expect(provider.matchesFilter(context, filter)).toBe(false);
    });

    it("does not match channel filter when context has no channel", () => {
      const contextNoChannel = { ...context, comment: undefined };
      const filter: SlackWebhookFilter = { channels: ["C789"] };
      expect(provider.matchesFilter(contextNoChannel, filter)).toBe(false);
    });

    it("matches with combined filters all passing", () => {
      const filter: SlackWebhookFilter = {
        events: ["message"],
        team_ids: ["T123"],
        channels: ["C789"],
      };
      expect(provider.matchesFilter(context, filter)).toBe(true);
    });

    it("does not match when any combined filter fails", () => {
      const filter: SlackWebhookFilter = {
        events: ["message"],
        team_ids: ["T123"],
        channels: ["C999"], // fails
      };
      expect(provider.matchesFilter(context, filter)).toBe(false);
    });
  });

  describe("handleChallenge", () => {
    it("returns challenge for valid url_verification with valid signature", () => {
      const body = JSON.stringify({
        type: "url_verification",
        challenge: "3eZbrw1aBm2rZgRNFdxV2595E9CY3gmdALWMmHkvFXO7tYXAYM8P",
      });
      const ts = makeTimestamp();
      const sig = sign(body, ts, secret);
      const result = provider.handleChallenge(
        { "x-slack-signature": sig, "x-slack-request-timestamp": ts },
        body,
        { MyWorkspace: secret }
      );
      expect(result).toEqual({ challenge: "3eZbrw1aBm2rZgRNFdxV2595E9CY3gmdALWMmHkvFXO7tYXAYM8P" });
    });

    it("returns null for non-verification requests", () => {
      const body = JSON.stringify({
        type: "event_callback",
        event: { type: "message" },
      });
      const ts = makeTimestamp();
      const sig = sign(body, ts, secret);
      const result = provider.handleChallenge(
        { "x-slack-signature": sig, "x-slack-request-timestamp": ts },
        body,
        { MyWorkspace: secret }
      );
      expect(result).toBeNull();
    });

    it("returns null when signature validation fails", () => {
      const body = JSON.stringify({
        type: "url_verification",
        challenge: "abc123",
      });
      const staleTs = String(Math.floor(Date.now() / 1000) - 400);
      const sig = sign(body, staleTs, secret);
      // Stale timestamp should fail validation
      const result = provider.handleChallenge(
        { "x-slack-signature": sig, "x-slack-request-timestamp": staleTs },
        body,
        { MyWorkspace: secret }
      );
      expect(result).toBeNull();
    });

    it("returns null for invalid JSON body", () => {
      const result = provider.handleChallenge({}, "not-json", { MyWorkspace: secret });
      expect(result).toBeNull();
    });
  });
});
