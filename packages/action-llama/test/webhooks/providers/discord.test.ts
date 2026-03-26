import { describe, it, expect } from "vitest";
import { generateKeyPairSync, sign } from "crypto";
import { DiscordWebhookProvider } from "../../../src/webhooks/providers/discord.js";
import type { DiscordWebhookFilter, WebhookContext } from "../../../src/webhooks/types.js";

const provider = new DiscordWebhookProvider();

// Generate an Ed25519 keypair for tests
const { publicKey, privateKey } = generateKeyPairSync("ed25519");

// Export the raw 32-byte public key as hex for the secrets map
const rawPublicKeyHex = publicKey.export({ type: "spki", format: "der" }).subarray(12).toString("hex");

function signPayload(body: string, timestamp: string): string {
  const message = Buffer.from(timestamp + body);
  const sig = sign(null, message, privateKey);
  return sig.toString("hex");
}

const TEST_TIMESTAMP = "1700000000";

describe("DiscordWebhookProvider", () => {
  describe("getDeliveryId", () => {
    it("returns x-interaction-id header value", () => {
      expect(provider.getDeliveryId({ "x-interaction-id": "abc-123" })).toBe("abc-123");
    });

    it("returns null when header is missing", () => {
      expect(provider.getDeliveryId({})).toBeNull();
    });
  });

  describe("validateRequest", () => {
    const body = '{"type":2,"data":{"name":"test"}}';

    it("accepts valid Ed25519 signature and returns instance name", () => {
      const sig = signPayload(body, TEST_TIMESTAMP);
      const result = provider.validateRequest(
        { "x-signature-ed25519": sig, "x-signature-timestamp": TEST_TIMESTAMP },
        body,
        { myApp: rawPublicKeyHex }
      );
      expect(result).toBe("myApp");
    });

    it("rejects invalid signature", () => {
      const wrongSig = signPayload("different body", TEST_TIMESTAMP);
      const result = provider.validateRequest(
        { "x-signature-ed25519": wrongSig, "x-signature-timestamp": TEST_TIMESTAMP },
        body,
        { myApp: rawPublicKeyHex }
      );
      expect(result).toBeNull();
    });

    it("rejects missing signature header when secret is configured", () => {
      const result = provider.validateRequest(
        { "x-signature-timestamp": TEST_TIMESTAMP },
        body,
        { myApp: rawPublicKeyHex }
      );
      expect(result).toBeNull();
    });

    it("rejects missing timestamp header when secret is configured", () => {
      const sig = signPayload(body, TEST_TIMESTAMP);
      const result = provider.validateRequest(
        { "x-signature-ed25519": sig },
        body,
        { myApp: rawPublicKeyHex }
      );
      expect(result).toBeNull();
    });

    it("accepts request when no secret is configured and allowUnsigned is true", () => {
      expect(provider.validateRequest({}, body, undefined, true)).toBe("_unsigned");
      expect(provider.validateRequest({}, body, {}, true)).toBe("_unsigned");
    });

    it("rejects request when no secret is configured and allowUnsigned is false (default)", () => {
      expect(provider.validateRequest({}, body)).toBeNull();
      expect(provider.validateRequest({}, body, undefined)).toBeNull();
      expect(provider.validateRequest({}, body, {})).toBeNull();
      expect(provider.validateRequest({}, body, undefined, false)).toBeNull();
    });

    it("tries multiple instances and returns matching one", () => {
      const { publicKey: pk2, privateKey: pk2Private } = generateKeyPairSync("ed25519");
      const pk2Hex = pk2.export({ type: "spki", format: "der" }).subarray(12).toString("hex");
      const sig = sign(null, Buffer.from(TEST_TIMESTAMP + body), pk2Private).toString("hex");
      const result = provider.validateRequest(
        { "x-signature-ed25519": sig, "x-signature-timestamp": TEST_TIMESTAMP },
        body,
        { firstApp: rawPublicKeyHex, secondApp: pk2Hex }
      );
      expect(result).toBe("secondApp");
    });

    it("rejects signature with wrong length (not 128 hex chars)", () => {
      const result = provider.validateRequest(
        { "x-signature-ed25519": "deadbeef", "x-signature-timestamp": TEST_TIMESTAMP },
        body,
        { myApp: rawPublicKeyHex }
      );
      expect(result).toBeNull();
    });
  });

  describe("parseEvent", () => {
    it("returns null for PING (type 1)", () => {
      expect(provider.parseEvent({}, { type: 1 })).toBeNull();
    });

    it("returns null for null body", () => {
      expect(provider.parseEvent({}, null)).toBeNull();
    });

    it("returns null for non-object body", () => {
      expect(provider.parseEvent({}, "string")).toBeNull();
    });

    it("returns null for unknown interaction type", () => {
      expect(provider.parseEvent({}, { type: 99 })).toBeNull();
    });

    it("parses APPLICATION_COMMAND (type 2)", () => {
      const body = {
        type: 2,
        guild_id: "guild-123",
        channel_id: "channel-456",
        member: { user: { username: "alice" } },
        data: {
          name: "ask",
          options: [{ name: "question", value: "What is the status?" }],
        },
      };
      const ctx = provider.parseEvent({}, body);
      expect(ctx).not.toBeNull();
      expect(ctx!.source).toBe("discord");
      expect(ctx!.event).toBe("application_command");
      expect(ctx!.action).toBe("ask");
      expect(ctx!.title).toBe("ask");
      expect(ctx!.repo).toBe("guild-123");
      expect(ctx!.branch).toBe("channel-456");
      expect(ctx!.sender).toBe("alice");
      expect(ctx!.body).toBe("question: What is the status?");
    });

    it("parses APPLICATION_COMMAND without options", () => {
      const body = {
        type: 2,
        guild_id: "guild-123",
        channel_id: "channel-456",
        user: { username: "bob" },
        data: { name: "ping" },
      };
      const ctx = provider.parseEvent({}, body);
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("application_command");
      expect(ctx!.action).toBe("ping");
      expect(ctx!.body).toBeUndefined();
      expect(ctx!.sender).toBe("bob");
    });

    it("parses MESSAGE_COMPONENT (type 3)", () => {
      const body = {
        type: 3,
        guild_id: "guild-123",
        channel_id: "channel-456",
        member: { user: { username: "carol" } },
        data: { component_type: 2, custom_id: "approve_button" },
      };
      const ctx = provider.parseEvent({}, body);
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("message_component");
      expect(ctx!.action).toBe("2");
      expect(ctx!.title).toBe("approve_button");
    });

    it("parses AUTOCOMPLETE (type 4)", () => {
      const body = {
        type: 4,
        guild_id: "guild-999",
        channel_id: "ch-111",
        member: { user: { username: "dave" } },
        data: { name: "deploy" },
      };
      const ctx = provider.parseEvent({}, body);
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("autocomplete");
      expect(ctx!.action).toBe("deploy");
      expect(ctx!.title).toBe("deploy");
    });

    it("parses MODAL_SUBMIT (type 5)", () => {
      const body = {
        type: 5,
        guild_id: "guild-123",
        channel_id: "channel-456",
        member: { user: { username: "eve" } },
        data: { custom_id: "feedback_modal" },
      };
      const ctx = provider.parseEvent({}, body);
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("modal_submit");
      expect(ctx!.action).toBe("feedback_modal");
      expect(ctx!.title).toBe("feedback_modal");
    });

    it("handles DM interactions without guild_id", () => {
      const body = {
        type: 2,
        channel_id: "dm-channel",
        user: { username: "frank" },
        data: { name: "help" },
      };
      const ctx = provider.parseEvent({}, body);
      expect(ctx).not.toBeNull();
      expect(ctx!.repo).toBe("");
      expect(ctx!.branch).toBe("dm-channel");
    });

    it("uses unknown as sender when no user info", () => {
      const body = {
        type: 2,
        data: { name: "test" },
      };
      const ctx = provider.parseEvent({}, body);
      expect(ctx!.sender).toBe("unknown");
    });
  });

  describe("matchesFilter", () => {
    const baseContext: WebhookContext = {
      source: "discord",
      event: "application_command",
      action: "ask",
      repo: "guild-123",
      branch: "channel-456",
      sender: "alice",
      timestamp: "2024-01-01T00:00:00Z",
      title: "ask",
    };

    it("matches with empty filter", () => {
      expect(provider.matchesFilter(baseContext, {})).toBe(true);
    });

    it("matches by events", () => {
      expect(provider.matchesFilter(baseContext, { events: ["application_command"] })).toBe(true);
      expect(provider.matchesFilter(baseContext, { events: ["modal_submit"] })).toBe(false);
    });

    it("matches by guilds", () => {
      expect(provider.matchesFilter(baseContext, { guilds: ["guild-123"] })).toBe(true);
      expect(provider.matchesFilter(baseContext, { guilds: ["guild-999"] })).toBe(false);
    });

    it("matches by channels", () => {
      expect(provider.matchesFilter(baseContext, { channels: ["channel-456"] })).toBe(true);
      expect(provider.matchesFilter(baseContext, { channels: ["channel-999"] })).toBe(false);
    });

    it("matches by commands for application_command events", () => {
      expect(provider.matchesFilter(baseContext, { commands: ["ask"] })).toBe(true);
      expect(provider.matchesFilter(baseContext, { commands: ["deploy"] })).toBe(false);
    });

    it("commands filter passes through for non-command events (components, modals)", () => {
      const componentContext: WebhookContext = {
        ...baseContext,
        event: "message_component",
        title: "approve_button",
      };
      // Commands filter should not block non-command events
      expect(provider.matchesFilter(componentContext, { commands: ["ask", "deploy"] })).toBe(true);
    });

    it("applies AND logic across multiple filter fields", () => {
      const filter: DiscordWebhookFilter = {
        guilds: ["guild-123"],
        channels: ["channel-456"],
        commands: ["ask"],
        events: ["application_command"],
      };
      expect(provider.matchesFilter(baseContext, filter)).toBe(true);

      const wrongGuild: DiscordWebhookFilter = { ...filter, guilds: ["guild-999"] };
      expect(provider.matchesFilter(baseContext, wrongGuild)).toBe(false);
    });

    it("matches autocomplete event by commands filter", () => {
      const autocompleteContext: WebhookContext = {
        ...baseContext,
        event: "autocomplete",
        title: "deploy",
        action: "deploy",
      };
      expect(provider.matchesFilter(autocompleteContext, { commands: ["deploy"] })).toBe(true);
      expect(provider.matchesFilter(autocompleteContext, { commands: ["ask"] })).toBe(false);
    });
  });
});
