/**
 * Integration tests: webhooks/providers/discord.ts DiscordWebhookProvider.matchesFilter()
 * edge cases — no Docker required.
 *
 * The existing discord-mintlify-webhook-provider-direct.test.ts covers guilds/channels/commands
 * for the basic match/mismatch cases. This test covers the remaining branches:
 *   1. channels filter passes when context.branch is absent (no channel_id)
 *      — `if (f.channels?.length && context.branch && ...)` — false when branch is undefined
 *   2. commands filter rejects when context.title is absent (no command name)
 *      — `if (!context.title || ...)` — true when title undefined
 *   3. commands filter accepts autocomplete event when title matches
 *   4. commands filter passes through modal_submit event (non-command)
 *   5. commands filter passes through message_component event (non-command)
 *
 * Covers:
 *   - webhooks/providers/discord.ts: matchesFilter() channels filter passes when no branch
 *   - webhooks/providers/discord.ts: matchesFilter() commands filter rejects when no title
 *   - webhooks/providers/discord.ts: matchesFilter() commands filter accepts autocomplete
 *   - webhooks/providers/discord.ts: matchesFilter() commands filter passes non-command events
 */

import { describe, it, expect } from "vitest";

const { DiscordWebhookProvider } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/webhooks/providers/discord.js"
);

const provider = new DiscordWebhookProvider();

function makeCtx(overrides: Record<string, any> = {}) {
  return {
    source: "discord",
    event: "application_command",
    repo: "guild-123",
    sender: "user1",
    title: "my-command",
    branch: "chan-456",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// ── channels filter with no branch in context ─────────────────────────────────

describe("DiscordWebhookProvider.matchesFilter() — channels filter with absent branch", { timeout: 10_000 }, () => {
  it("passes channels filter when context.branch is absent (no channel_id)", () => {
    // When context.branch is undefined, the channels filter check short-circuits:
    // `f.channels?.length && context.branch && ...` → false at context.branch check
    const ctx = makeCtx({ branch: undefined });
    expect(provider.matchesFilter(ctx, { channels: ["chan-789"] } as any)).toBe(true);
  });

  it("passes channels filter when context.branch is null", () => {
    const ctx = makeCtx({ branch: null });
    expect(provider.matchesFilter(ctx, { channels: ["chan-789"] } as any)).toBe(true);
  });
});

// ── commands filter with absent title ────────────────────────────────────────

describe("DiscordWebhookProvider.matchesFilter() — commands filter with absent title", { timeout: 10_000 }, () => {
  it("does not match commands filter when context.title is absent", () => {
    // For application_command events, if title is absent, commands filter rejects
    const ctx = makeCtx({ event: "application_command", title: undefined });
    expect(provider.matchesFilter(ctx, { commands: ["my-command"] } as any)).toBe(false);
  });

  it("does not match commands filter when context.title is empty string", () => {
    const ctx = makeCtx({ event: "application_command", title: "" });
    expect(provider.matchesFilter(ctx, { commands: ["my-command"] } as any)).toBe(false);
  });
});

// ── commands filter with autocomplete event ───────────────────────────────────

describe("DiscordWebhookProvider.matchesFilter() — commands filter with autocomplete", { timeout: 10_000 }, () => {
  it("matches commands filter for autocomplete event when title matches", () => {
    const ctx = makeCtx({ event: "autocomplete", title: "my-command" });
    expect(provider.matchesFilter(ctx, { commands: ["my-command"] } as any)).toBe(true);
  });

  it("does not match commands filter for autocomplete when title doesn't match", () => {
    const ctx = makeCtx({ event: "autocomplete", title: "other-command" });
    expect(provider.matchesFilter(ctx, { commands: ["my-command"] } as any)).toBe(false);
  });

  it("does not match commands filter for autocomplete when title absent", () => {
    const ctx = makeCtx({ event: "autocomplete", title: undefined });
    expect(provider.matchesFilter(ctx, { commands: ["my-command"] } as any)).toBe(false);
  });
});

// ── commands filter passes through non-command events ────────────────────────

describe("DiscordWebhookProvider.matchesFilter() — commands filter passes non-command events", { timeout: 10_000 }, () => {
  it("passes through modal_submit event even with commands filter set", () => {
    // modal_submit is not a command event → commands filter does not apply
    const ctx = makeCtx({ event: "modal_submit", title: "submit-form" });
    expect(provider.matchesFilter(ctx, { commands: ["some-command"] } as any)).toBe(true);
  });

  it("passes through message_component event even with commands filter set", () => {
    const ctx = makeCtx({ event: "message_component", title: "click-button" });
    expect(provider.matchesFilter(ctx, { commands: ["some-command"] } as any)).toBe(true);
  });
});
