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
import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { createHmac } from "crypto";
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

  it("GET /webhooks/twitter CRC challenge with configured secret returns HMAC response_token", async () => {
    // Twitter Account Activity API requires a CRC (challenge-response check) before
    // activating a webhook subscription. Twitter sends GET /webhooks/twitter?crc_token=<token>
    // and expects { response_token: "sha256=<hmac-of-token-with-consumer_secret>" }.
    //
    // Code path: GET /webhooks/:source → provider.handleCrcChallenge(queryParams, secrets)
    //   → twitter.ts: createHmac("sha256", secret).update(crcToken).digest("base64")
    //   → returns { status: 200, body: { response_token: "sha256=..." } }
    //
    // This exercises webhooks/providers/twitter.ts handleCrcChallenge() success path.
    const TEST_CONSUMER_SECRET = "test-crc-consumer-secret-12345";

    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "twitter-crc-agent",
          webhooks: [{ source: "twitter", events: ["tweet_create_events"] }],
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
      globalConfig: {
        webhooks: { twitter: { type: "twitter", allowUnsigned: true } },
      },
    });

    // Write the Twitter consumer_secret credential BEFORE start() so it's
    // picked up by setupWebhookRegistry() during scheduler initialization.
    const credDir = resolve(harness.credentialDir, "x_twitter_api", "default");
    mkdirSync(credDir, { recursive: true });
    writeFileSync(resolve(credDir, "consumer_secret"), TEST_CONSUMER_SECRET + "\n");

    await harness.start();

    const crcToken = "test-crc-token-" + Math.random().toString(36).slice(2);

    // GET /webhooks/twitter?crc_token=<token>
    const res = await fetch(
      `http://127.0.0.1:${harness.gatewayPort}/webhooks/twitter?crc_token=${encodeURIComponent(crcToken)}`,
      { method: "GET" },
    );
    expect(res.status).toBe(200);

    const body = await res.json() as { response_token: string };
    expect(body).toHaveProperty("response_token");
    expect(typeof body.response_token).toBe("string");
    // Must start with "sha256="
    expect(body.response_token.startsWith("sha256=")).toBe(true);

    // Verify the HMAC is correct (sha256 of crcToken with TEST_CONSUMER_SECRET)
    const expectedHmac = createHmac("sha256", TEST_CONSUMER_SECRET).update(crcToken).digest("base64");
    expect(body.response_token).toBe(`sha256=${expectedHmac}`);
  });

  it("GET /webhooks/twitter CRC challenge without crc_token returns 400", async () => {
    // When crc_token is missing, handleCrcChallenge returns null → 400 "CRC challenge failed".
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "twitter-crc-notoken-agent",
          webhooks: [{ source: "twitter", events: ["tweet_create_events"] }],
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
      globalConfig: {
        webhooks: { twitter: { type: "twitter", allowUnsigned: true } },
      },
    });

    await harness.start();

    // GET without crc_token param → handleCrcChallenge returns null → 400
    const res = await fetch(
      `http://127.0.0.1:${harness.gatewayPort}/webhooks/twitter`,
      { method: "GET" },
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBeTruthy();
  });
});
