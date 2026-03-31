/**
 * Integration test: Twitter webhook provider end-to-end.
 *
 * Verifies that the Twitter webhook provider correctly:
 *   - Accepts unsigned payloads when allowUnsigned=true is configured
 *   - Parses tweet_create_events into WebhookContext
 *   - Parses follow_events into WebhookContext
 *   - Triggers agents subscribed to Twitter events
 *   - Filters non-matching event types
 *   - Rejects unsigned webhooks when no secrets configured
 *
 * Twitter uses base64-encoded HMAC-SHA256 signatures (different from GitHub).
 * Uses allowUnsigned=true to avoid needing real Twitter API secrets in tests.
 *
 * Covers: webhooks/providers/twitter.ts (parseEvent, validateRequest,
 *         matchesFilter)
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

/** Send a raw POST to /webhooks/twitter with the given payload. */
function sendTwitterWebhook(
  harness: IntegrationHarness,
  payload: object,
): Promise<Response> {
  return fetch(`http://127.0.0.1:${harness.gatewayPort}/webhooks/twitter`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe.skipIf(!DOCKER)("integration: Twitter webhook provider", { timeout: 300_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("triggers agent on Twitter tweet_create_events", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "twitter-tweet-agent",
          webhooks: [{ source: "twitter", events: ["tweet_create_events"] }],
          testScript: [
            "#!/bin/sh",
            "set -e",
            'test -n "$PROMPT" || { echo "PROMPT not set"; exit 1; }',
            'echo "twitter-tweet-agent triggered OK"',
            "exit 0",
          ].join("\n"),
        },
      ],
      globalConfig: {
        webhooks: { twitter: { type: "twitter", allowUnsigned: true } },
      },
    });

    await harness.start();

    // Twitter Account Activity API payload for tweet_create_events
    const payload = {
      for_user_id: "user-123456",
      tweet_create_events: [
        {
          id_str: "tweet-001",
          full_text: "Hello from the integration test #testing",
          user: {
            id_str: "user-001",
            screen_name: "integrationtest",
            name: "Integration Test",
          },
          created_at: "Mon Jan 01 00:00:00 +0000 2025",
        },
      ],
    };

    const res = await sendTwitterWebhook(harness, payload);
    expect(res.ok).toBe(true);

    const body = await res.json();
    expect(body.matched).toBeGreaterThanOrEqual(1);

    const run = await harness.waitForRunResult("twitter-tweet-agent");
    expect(run.result).toBe("completed");
  });

  it("triggers agent on Twitter follow_events", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "twitter-follow-agent",
          webhooks: [{ source: "twitter", events: ["follow_events"] }],
          testScript: "#!/bin/sh\necho 'new follower'\nexit 0\n",
        },
      ],
      globalConfig: {
        webhooks: { twitter: { type: "twitter", allowUnsigned: true } },
      },
    });

    await harness.start();

    const payload = {
      for_user_id: "user-654321",
      follow_events: [
        {
          type: "follow",
          created_timestamp: Date.now().toString(),
          source: { id: "follower-001", name: "Follower One", screen_name: "follower1" },
          target: { id: "user-654321", name: "My Account", screen_name: "myaccount" },
        },
      ],
    };

    const res = await sendTwitterWebhook(harness, payload);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.matched).toBeGreaterThanOrEqual(1);

    const run = await harness.waitForRunResult("twitter-follow-agent");
    expect(run.result).toBe("completed");
  });

  it("does not trigger agent when event type filter does not match", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "twitter-tweet-only",
          webhooks: [{ source: "twitter", events: ["tweet_create_events"] }],
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
      globalConfig: {
        webhooks: { twitter: { type: "twitter", allowUnsigned: true } },
      },
    });

    await harness.start();

    // Send follow_events — should not match tweet_create_events filter
    const payload = {
      for_user_id: "user-999",
      follow_events: [
        {
          type: "follow",
          created_timestamp: Date.now().toString(),
          source: { id: "user-abc", name: "Someone", screen_name: "someone" },
          target: { id: "user-999", name: "Me", screen_name: "me" },
        },
      ],
    };

    const res = await sendTwitterWebhook(harness, payload);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.matched).toBe(0);
  });

  it("rejects Twitter webhook when no secrets configured and not allowUnsigned", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "twitter-secure-agent",
          webhooks: [{ source: "twitter", events: ["tweet_create_events"] }],
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
      globalConfig: {
        // No allowUnsigned, no consumer_secret — unsigned webhooks rejected
        webhooks: { twitter: { type: "twitter" } },
      },
    });

    await harness.start();

    const payload = {
      for_user_id: "user-000",
      tweet_create_events: [
        {
          id_str: "tweet-unsafe",
          full_text: "Unsigned tweet",
          user: { id_str: "user-000", screen_name: "attacker", name: "Attacker" },
        },
      ],
    };

    // No x-twitter-webhooks-signature header → 401
    const res = await sendTwitterWebhook(harness, payload);
    expect(res.status).toBe(401);
  });
});
