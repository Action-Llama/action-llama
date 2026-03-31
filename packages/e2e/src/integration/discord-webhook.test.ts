/**
 * Integration test: Discord webhook provider end-to-end.
 *
 * Verifies that the Discord webhook provider correctly:
 *   - Accepts unsigned payloads when allowUnsigned=true is configured
 *   - Handles PING interactions (type=1) by returning PONG
 *   - Parses application_command interactions into WebhookContext
 *   - Parses message_component interactions into WebhookContext
 *   - Triggers agents subscribed to Discord events
 *   - Filters non-matching event types
 *   - Rejects unsigned webhooks when no public key configured
 *
 * Discord uses Ed25519 signatures — we use allowUnsigned=true to skip
 * cryptographic validation in tests without requiring real Discord credentials.
 *
 * Covers: webhooks/providers/discord.ts (parseEvent, validateRequest,
 *         matchesFilter) and the special PING handling in events/routes/webhooks.ts
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

/** Send a raw POST to /webhooks/discord with the given payload. */
function sendDiscordWebhook(
  harness: IntegrationHarness,
  payload: object,
): Promise<Response> {
  return fetch(`http://127.0.0.1:${harness.gatewayPort}/webhooks/discord`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe.skipIf(!DOCKER)("integration: Discord webhook provider", { timeout: 300_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("handles Discord PING (type=1) and returns PONG when allowUnsigned=true", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "discord-ping-agent",
          webhooks: [{ source: "discord", events: ["application_command"] }],
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
      globalConfig: {
        webhooks: { discord: { type: "discord", allowUnsigned: true } },
      },
    });

    await harness.start();

    // Discord PING interaction (type=1)
    const pingPayload = {
      type: 1,
      id: "ping-interaction-001",
    };

    const res = await sendDiscordWebhook(harness, pingPayload);
    expect(res.ok).toBe(true);

    const body = await res.json();
    // PING should return PONG: { type: 1 }
    expect(body.type).toBe(1);
  });

  it("triggers agent on Discord application_command interaction", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "discord-cmd-agent",
          webhooks: [{ source: "discord", events: ["application_command"] }],
          testScript: [
            "#!/bin/sh",
            "set -e",
            'test -n "$PROMPT" || { echo "PROMPT not set"; exit 1; }',
            'echo "discord-cmd-agent triggered OK"',
            "exit 0",
          ].join("\n"),
        },
      ],
      globalConfig: {
        webhooks: { discord: { type: "discord", allowUnsigned: true } },
      },
    });

    await harness.start();

    // Discord application_command interaction (type=2)
    const payload = {
      type: 2,
      id: "cmd-interaction-001",
      guild_id: "guild-123",
      channel_id: "channel-456",
      member: { user: { username: "test-user", id: "user-789" } },
      data: {
        name: "run-agent",
        type: 1,
        options: [
          { name: "prompt", value: "Do something useful", type: 3 },
        ],
      },
    };

    const res = await sendDiscordWebhook(harness, payload);
    expect(res.ok).toBe(true);

    const body = await res.json();
    expect(body.matched).toBeGreaterThanOrEqual(1);

    const run = await harness.waitForRunResult("discord-cmd-agent");
    expect(run.result).toBe("completed");
  });

  it("triggers agent on Discord message_component interaction", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "discord-component-agent",
          webhooks: [{ source: "discord", events: ["message_component"] }],
          testScript: "#!/bin/sh\necho 'component click'\nexit 0\n",
        },
      ],
      globalConfig: {
        webhooks: { discord: { type: "discord", allowUnsigned: true } },
      },
    });

    await harness.start();

    // Discord message_component interaction (type=3)
    const payload = {
      type: 3,
      id: "component-interaction-001",
      guild_id: "guild-999",
      channel_id: "channel-999",
      member: { user: { username: "clicker", id: "user-999" } },
      data: {
        custom_id: "approve-button",
        component_type: 2,
      },
    };

    const res = await sendDiscordWebhook(harness, payload);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.matched).toBeGreaterThanOrEqual(1);

    const run = await harness.waitForRunResult("discord-component-agent");
    expect(run.result).toBe("completed");
  });

  it("does not trigger agent when event type filter does not match", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "discord-cmd-only",
          webhooks: [{ source: "discord", events: ["application_command"] }],
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
      globalConfig: {
        webhooks: { discord: { type: "discord", allowUnsigned: true } },
      },
    });

    await harness.start();

    // Send a message_component (type=3) — should not match "application_command" filter
    const payload = {
      type: 3,
      id: "component-interaction-nomatch",
      guild_id: "guild-000",
      channel_id: "channel-000",
      member: { user: { username: "nomatch-user", id: "user-000" } },
      data: { custom_id: "cancel-button", component_type: 2 },
    };

    const res = await sendDiscordWebhook(harness, payload);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.matched).toBe(0);
  });

  it("rejects Discord webhooks when no secrets configured and not allowUnsigned", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "discord-secure-agent",
          webhooks: [{ source: "discord", events: ["application_command"] }],
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
      globalConfig: {
        // No allowUnsigned, no public key — unsigned requests rejected
        webhooks: { discord: { type: "discord" } },
      },
    });

    await harness.start();

    const payload = {
      type: 2,
      id: "unsigned-interaction",
      guild_id: "guild-000",
      channel_id: "channel-000",
      member: { user: { username: "bad-actor", id: "user-bad" } },
      data: { name: "malicious-command", type: 1 },
    };

    // No Ed25519 signature headers → 401
    const res = await sendDiscordWebhook(harness, payload);
    expect(res.status).toBe(401);
  });
});
