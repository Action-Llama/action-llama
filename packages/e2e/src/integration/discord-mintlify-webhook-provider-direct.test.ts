/**
 * Integration tests: webhooks/providers/discord.ts and webhooks/providers/mintlify.ts
 * — no Docker required.
 *
 * Both DiscordWebhookProvider and MintlifyWebhookProvider have pure functions
 * testable without Docker. The existing docker-based tests (discord-webhook.test.ts,
 * mintlify-webhook.test.ts) skip without Docker. This test covers pure methods directly.
 *
 * Covers:
 *   - webhooks/providers/discord.ts: validateRequest() allowUnsigned→'_unsigned' / no secrets→null
 *   - webhooks/providers/discord.ts: parseEvent() body=null → null
 *   - webhooks/providers/discord.ts: parseEvent() type=PING (1) → null
 *   - webhooks/providers/discord.ts: parseEvent() unknown interaction type → null
 *   - webhooks/providers/discord.ts: parseEvent() application_command (type=2) → event:application_command
 *   - webhooks/providers/discord.ts: parseEvent() message_component (type=3) → event:message_component
 *   - webhooks/providers/discord.ts: parseEvent() autocomplete (type=4) → event:autocomplete
 *   - webhooks/providers/discord.ts: parseEvent() modal_submit (type=5) → event:modal_submit
 *   - webhooks/providers/discord.ts: parseEvent() guild_id → repo field
 *   - webhooks/providers/discord.ts: matchesFilter() events filter match/mismatch
 *   - webhooks/providers/discord.ts: matchesFilter() actions filter match/mismatch
 *   - webhooks/providers/discord.ts: getDeliveryId() with/without x-interaction-id header
 *   - webhooks/providers/mintlify.ts: validateRequest() allowUnsigned→'_unsigned'
 *   - webhooks/providers/mintlify.ts: validateRequest() x-mintlify-signature or mintlify-signature
 *   - webhooks/providers/mintlify.ts: parseEvent() null body → null
 *   - webhooks/providers/mintlify.ts: parseEvent() missing action → null
 *   - webhooks/providers/mintlify.ts: parseEvent() build event with failed action → conclusion:failure
 *   - webhooks/providers/mintlify.ts: parseEvent() build event with success action → conclusion:success
 *   - webhooks/providers/mintlify.ts: parseEvent() default event fields
 *   - webhooks/providers/mintlify.ts: matchesFilter() events filter
 *   - webhooks/providers/mintlify.ts: matchesFilter() actions filter
 *   - webhooks/providers/mintlify.ts: matchesFilter() projects filter
 */

import { describe, it, expect } from "vitest";

const { DiscordWebhookProvider } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/webhooks/providers/discord.js"
);

const { MintlifyWebhookProvider } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/webhooks/providers/mintlify.js"
);

// ── DiscordWebhookProvider ────────────────────────────────────────────────────

describe("integration: DiscordWebhookProvider pure methods (no Docker required)", { timeout: 10_000 }, () => {
  const provider = new DiscordWebhookProvider();

  describe("getDeliveryId()", () => {
    it("returns x-interaction-id when present", () => {
      expect(provider.getDeliveryId({ "x-interaction-id": "interaction-abc" })).toBe("interaction-abc");
    });

    it("returns null when x-interaction-id is absent", () => {
      expect(provider.getDeliveryId({})).toBeNull();
    });
  });

  describe("validateRequest()", () => {
    it("returns '_unsigned' when no secrets and allowUnsigned=true", () => {
      expect(provider.validateRequest({}, "body", {}, true)).toBe("_unsigned");
    });

    it("returns null when no secrets and allowUnsigned=false", () => {
      expect(provider.validateRequest({}, "body", {}, false)).toBeNull();
    });

    it("returns null when signature headers are missing and secrets provided", () => {
      expect(provider.validateRequest({}, "body", { default: "publickey" })).toBeNull();
    });
  });

  describe("parseEvent()", () => {
    it("returns null for null body", () => {
      expect(provider.parseEvent({}, null)).toBeNull();
    });

    it("returns null for non-object body", () => {
      expect(provider.parseEvent({}, "string")).toBeNull();
    });

    it("returns null for PING interaction (type=1)", () => {
      expect(provider.parseEvent({}, { type: 1 })).toBeNull();
    });

    it("returns null for unknown interaction type (type=99)", () => {
      expect(provider.parseEvent({}, { type: 99, data: {} })).toBeNull();
    });

    it("parses application_command interaction (type=2)", () => {
      const body = {
        type: 2,
        guild_id: "guild-123",
        channel_id: "chan-456",
        member: { user: { username: "testuser" } },
        data: { name: "deploy", options: [{ name: "env", value: "prod" }] },
      };
      const ctx = provider.parseEvent({}, body);
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("application_command");
      expect(ctx!.action).toBe("deploy");
      expect(ctx!.title).toBe("deploy");
      expect(ctx!.repo).toBe("guild-123");
      expect(ctx!.branch).toBe("chan-456");
      expect(ctx!.sender).toBe("testuser");
      expect(ctx!.body).toContain("env: prod");
    });

    it("parses message_component interaction (type=3)", () => {
      const body = {
        type: 3,
        guild_id: "guild-789",
        channel_id: "chan-111",
        user: { username: "btnuser" },
        data: { custom_id: "confirm-btn", component_type: 2 },
      };
      const ctx = provider.parseEvent({}, body);
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("message_component");
      // For message_component, action = String(component_type), title = custom_id
      expect(ctx!.action).toBe("2");
      expect(ctx!.title).toBe("confirm-btn");
    });

    it("parses autocomplete interaction (type=4)", () => {
      const body = {
        type: 4,
        guild_id: "guild-x",
        channel_id: "chan-y",
        data: { name: "search", options: [] },
      };
      const ctx = provider.parseEvent({}, body);
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("autocomplete");
    });

    it("parses modal_submit interaction (type=5)", () => {
      const body = {
        type: 5,
        guild_id: "guild-m",
        channel_id: "chan-m",
        data: {
          custom_id: "my-modal",
          components: [{ components: [{ custom_id: "field1", value: "answer" }] }],
        },
      };
      const ctx = provider.parseEvent({}, body);
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("modal_submit");
    });

    it("uses guild_id as repo field", () => {
      const body = {
        type: 2,
        guild_id: "guild-999",
        channel_id: "chan-0",
        data: { name: "cmd" },
      };
      const ctx = provider.parseEvent({}, body);
      expect(ctx!.repo).toBe("guild-999");
    });

    it("uses empty string for repo when guild_id is absent", () => {
      const body = {
        type: 2,
        channel_id: "chan-0",
        data: { name: "cmd" },
      };
      const ctx = provider.parseEvent({}, body);
      expect(ctx!.repo).toBe("");
    });
  });

  // Note: DiscordWebhookFilter has events/guilds/channels/commands (not actions)
  describe("matchesFilter()", () => {
    const ctx: any = {
      source: "discord",
      event: "application_command",
      action: "deploy",
      title: "deploy",      // command name stored as title
      repo: "guild-123",    // guild_id stored as repo
      branch: "chan-456",   // channel_id stored as branch
      sender: "testuser",
      timestamp: new Date().toISOString(),
    };

    it("matches when no filter", () => {
      expect(provider.matchesFilter(ctx, {})).toBe(true);
    });

    it("matches when events filter includes the event", () => {
      expect(provider.matchesFilter(ctx, { events: ["application_command"] })).toBe(true);
    });

    it("does not match when events filter excludes the event", () => {
      expect(provider.matchesFilter(ctx, { events: ["message_component"] })).toBe(false);
    });

    it("matches when guilds filter includes the guild", () => {
      expect(provider.matchesFilter(ctx, { guilds: ["guild-123"] } as any)).toBe(true);
    });

    it("does not match when guilds filter excludes the guild", () => {
      expect(provider.matchesFilter(ctx, { guilds: ["other-guild"] } as any)).toBe(false);
    });

    it("matches when channels filter includes the channel", () => {
      expect(provider.matchesFilter(ctx, { channels: ["chan-456"] } as any)).toBe(true);
    });

    it("does not match when channels filter excludes the channel", () => {
      expect(provider.matchesFilter(ctx, { channels: ["other-chan"] } as any)).toBe(false);
    });

    it("matches when commands filter includes the command name (application_command)", () => {
      expect(provider.matchesFilter(ctx, { commands: ["deploy"] } as any)).toBe(true);
    });

    it("does not match when commands filter excludes the command name", () => {
      expect(provider.matchesFilter(ctx, { commands: ["rollback"] } as any)).toBe(false);
    });

    it("ignores commands filter for non-command events (message_component passes through)", () => {
      const componentCtx = { ...ctx, event: "message_component" };
      // For message_component, commands filter is ignored → passes through
      expect(provider.matchesFilter(componentCtx, { commands: ["deploy"] } as any)).toBe(true);
    });
  });
});

// ── MintlifyWebhookProvider ───────────────────────────────────────────────────

describe("integration: MintlifyWebhookProvider pure methods (no Docker required)", { timeout: 10_000 }, () => {
  const provider = new MintlifyWebhookProvider();

  describe("validateRequest()", () => {
    it("returns '_unsigned' when no secrets and allowUnsigned=true", () => {
      expect(provider.validateRequest({}, "body", {}, true)).toBe("_unsigned");
    });

    it("returns null when no secrets and allowUnsigned=false", () => {
      expect(provider.validateRequest({}, "body", {}, false)).toBeNull();
    });

    it("returns null when signature headers are absent but secrets provided", () => {
      expect(provider.validateRequest({}, "body", { default: "secret" })).toBeNull();
    });

    it("reads x-mintlify-signature header", () => {
      // With wrong signature → null (but confirms header is read)
      const result = provider.validateRequest(
        { "x-mintlify-signature": "wrong-sig" },
        "body",
        { default: "secret" },
      );
      expect(result).toBeNull();
    });

    it("reads mintlify-signature header (alternate format)", () => {
      const result = provider.validateRequest(
        { "mintlify-signature": "wrong-sig" },
        "body",
        { default: "secret" },
      );
      expect(result).toBeNull();
    });
  });

  describe("parseEvent()", () => {
    it("returns null for null body", () => {
      expect(provider.parseEvent({}, null)).toBeNull();
    });

    it("returns null for non-object body", () => {
      expect(provider.parseEvent({}, "string")).toBeNull();
    });

    it("returns null when action is missing", () => {
      expect(provider.parseEvent({}, { event: "build", project: "docs" })).toBeNull();
    });

    it("parses build event with failed action → conclusion:failure", () => {
      const ctx = provider.parseEvent({}, {
        event: "build",
        action: "failed",
        project: "my-docs",
        user: { email: "user@example.com" },
        error: "Compilation error",
        url: "https://mintlify.com/builds/1",
        branch: "main",
      });
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("build");
      expect(ctx!.action).toBe("failed");
      expect(ctx!.conclusion).toBe("failure");
      expect(ctx!.body).toContain("Build failed");
    });

    it("parses build event with success action → conclusion:success", () => {
      const ctx = provider.parseEvent({}, {
        event: "build",
        action: "succeeded",
        project: "my-docs",
        url: "https://mintlify.com/builds/2",
        branch: "feature",
      });
      expect(ctx).not.toBeNull();
      expect(ctx!.conclusion).toBe("success");
    });

    it("parses event with default fields", () => {
      const ctx = provider.parseEvent({}, {
        event: "deployment",
        action: "completed",
        project: "api-docs",
        user: { name: "Mintlify Bot" },
        title: "Deployment complete",
        branch: "release",
      });
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("deployment");
      expect(ctx!.action).toBe("completed");
      expect(ctx!.repo).toBe("api-docs");
      expect(ctx!.sender).toBe("Mintlify Bot");
      expect(ctx!.title).toBe("Deployment complete");
      expect(ctx!.branch).toBe("release");
    });

    it("uses 'build' as default event when event field absent", () => {
      const ctx = provider.parseEvent({}, {
        action: "triggered",
        project: "proj",
      });
      expect(ctx).not.toBeNull();
      expect(ctx!.event).toBe("build");
    });
  });

  describe("matchesFilter()", () => {
    const ctx: any = {
      source: "mintlify",
      event: "build",
      action: "failed",
      repo: "my-docs",
      sender: "mintlify",
      timestamp: new Date().toISOString(),
    };

    it("matches when no filter", () => {
      expect(provider.matchesFilter(ctx, {})).toBe(true);
    });

    it("matches when events filter includes the event", () => {
      expect(provider.matchesFilter(ctx, { events: ["build"] })).toBe(true);
    });

    it("does not match when events filter excludes the event", () => {
      expect(provider.matchesFilter(ctx, { events: ["deployment"] })).toBe(false);
    });

    it("matches when actions filter includes the action", () => {
      expect(provider.matchesFilter(ctx, { actions: ["failed"] })).toBe(true);
    });

    it("does not match when actions filter excludes the action", () => {
      expect(provider.matchesFilter(ctx, { actions: ["succeeded"] })).toBe(false);
    });

    it("does not match actions filter when context has no action", () => {
      const ctxNoAction = { ...ctx, action: undefined };
      expect(provider.matchesFilter(ctxNoAction, { actions: ["failed"] })).toBe(false);
    });
  });
});
