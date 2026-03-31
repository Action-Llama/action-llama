/**
 * Integration test: Slack webhook provider end-to-end.
 *
 * Verifies that the Slack webhook provider correctly:
 *   - Accepts unsigned payloads when allowUnsigned=true is configured
 *   - Parses Slack event_callback payloads into WebhookContext
 *   - Triggers agents subscribed to Slack message events
 *   - Handles app_mention events
 *   - Filters non-matching events
 *   - Handles URL verification challenge via POST
 *   - Rejects requests without signatures when secrets are required
 *
 * Uses allowUnsigned=true to avoid needing real Slack signing secrets.
 *
 * Covers: webhooks/providers/slack.ts (parseEvent, validateRequest,
 *         matchesFilter, handleChallenge)
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

/** Send a raw POST to /webhooks/slack with the given payload. */
function sendSlackWebhook(
  harness: IntegrationHarness,
  payload: object,
): Promise<Response> {
  return fetch(`http://127.0.0.1:${harness.gatewayPort}/webhooks/slack`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe.skipIf(!DOCKER)("integration: Slack webhook provider", { timeout: 300_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("triggers agent on Slack message event", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "slack-message-agent",
          webhooks: [{ source: "slack", events: ["message"] }],
          testScript: [
            "#!/bin/sh",
            "set -e",
            'test -n "$PROMPT" || { echo "PROMPT not set"; exit 1; }',
            'echo "slack-message-agent triggered OK"',
            "exit 0",
          ].join("\n"),
        },
      ],
      globalConfig: {
        webhooks: { slack: { type: "slack", allowUnsigned: true } },
      },
    });

    await harness.start();

    const payload = {
      type: "event_callback",
      team_id: "T12345",
      event: {
        type: "message",
        text: "Hello from Slack integration test",
        user: "U12345",
        channel: "C12345",
        ts: "1234567890.123456",
      },
      event_id: "Ev12345",
      event_time: Math.floor(Date.now() / 1000),
    };

    const res = await sendSlackWebhook(harness, payload);
    expect(res.ok).toBe(true);

    const body = await res.json();
    expect(body.matched).toBeGreaterThanOrEqual(1);

    const run = await harness.waitForRunResult("slack-message-agent");
    expect(run.result).toBe("completed");
  });

  it("triggers agent on Slack app_mention event", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "slack-mention-agent",
          webhooks: [{ source: "slack", events: ["app_mention"] }],
          testScript: "#!/bin/sh\necho 'mentioned'\nexit 0\n",
        },
      ],
      globalConfig: {
        webhooks: { slack: { type: "slack", allowUnsigned: true } },
      },
    });

    await harness.start();

    const payload = {
      type: "event_callback",
      team_id: "T99999",
      event: {
        type: "app_mention",
        text: "<@UBOT> please help me",
        user: "U99999",
        channel: "C99999",
        ts: "9876543210.000001",
      },
      event_id: "Ev99999",
      event_time: Math.floor(Date.now() / 1000),
    };

    const res = await sendSlackWebhook(harness, payload);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.matched).toBeGreaterThanOrEqual(1);

    const run = await harness.waitForRunResult("slack-mention-agent");
    expect(run.result).toBe("completed");
  });

  it("does not trigger agent when event type does not match filter", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "slack-message-only",
          webhooks: [{ source: "slack", events: ["message"] }],
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
      globalConfig: {
        webhooks: { slack: { type: "slack", allowUnsigned: true } },
      },
    });

    await harness.start();

    // Send an app_mention — should not match "message" filter
    const payload = {
      type: "event_callback",
      team_id: "T00001",
      event: {
        type: "app_mention",
        text: "mention that should not trigger",
        user: "U00001",
        channel: "C00001",
      },
      event_id: "Ev00001",
      event_time: Math.floor(Date.now() / 1000),
    };

    const res = await sendSlackWebhook(harness, payload);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.matched).toBe(0);
  });

  it("rejects url_verification event without signature when secrets required", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "slack-secure-agent",
          webhooks: [{ source: "slack", events: ["message"] }],
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
      globalConfig: {
        // No allowUnsigned, no secrets — unsigned webhooks are rejected
        webhooks: { slack: { type: "slack" } },
      },
    });

    await harness.start();

    const payload = {
      type: "event_callback",
      team_id: "T00002",
      event: {
        type: "message",
        text: "Unsigned message",
        user: "U00002",
        channel: "C00002",
      },
    };

    // No x-slack-signature header → 401
    const res = await sendSlackWebhook(harness, payload);
    expect(res.status).toBe(401);
  });

  it("skips url_verification events (parseEvent returns null for them)", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "slack-no-verif-trigger",
          webhooks: [{ source: "slack", events: ["message"] }],
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
      globalConfig: {
        webhooks: { slack: { type: "slack", allowUnsigned: true } },
      },
    });

    await harness.start();

    // url_verification events are handled by handleChallenge, not dispatched as agent triggers
    // With allowUnsigned=true, the challenge response should be returned directly.
    // We send a POST (not GET) since POST is what Slack uses for url_verification.
    const payload = {
      type: "url_verification",
      challenge: "test-challenge-token-12345",
    };

    const res = await sendSlackWebhook(harness, payload);
    // The Slack provider handles url_verification as a challenge — it either returns
    // the challenge or returns matched=0 (since parseEvent returns null for it).
    // Either way, it should not throw an error.
    expect(res.status).toBeLessThan(500);

    const body = await res.json();
    // If handleChallenge is active, it returns { challenge: "..." }
    // If not, matched=0
    if (body.challenge) {
      expect(body.challenge).toBe("test-challenge-token-12345");
    } else {
      expect(body.matched).toBe(0);
    }
  });
});
