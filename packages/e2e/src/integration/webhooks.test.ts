import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: webhooks", { timeout: 180_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("triggers agent via POST /webhooks/test", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "webhook-agent",
          webhooks: [{ source: "test-hook" }],
          testScript: [
            "#!/bin/sh",
            "set -e",
            // Verify PROMPT contains webhook context
            'echo "webhook-agent: prompt=$PROMPT"',
            'test -n "$GATEWAY_URL" || exit 1',
            "exit 0",
          ].join("\n"),
        },
      ],
      globalConfig: {
        webhooks: { "test-hook": { type: "test" } },
      },
    });

    await harness.start();

    const res = await harness.sendWebhook({
      source: "test",
      event: "deploy",
      action: "created",
      repo: "acme/app",
      sender: "tester",
      title: "Deploy v1.0",
    });

    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.matched).toBeGreaterThanOrEqual(1);

    // Wait for the webhook-triggered run via event bus
    const run = await harness.waitForRunResult("webhook-agent");
    expect(run.result).toBe("completed");
  });

  it("filters webhooks — non-matching events are skipped", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "filtered-agent",
          webhooks: [{ source: "test-hook", events: ["deploy"] }],
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
      globalConfig: {
        webhooks: { "test-hook": { type: "test" } },
      },
    });

    await harness.start();

    // Non-matching event → matched=0
    const res1 = await harness.sendWebhook({
      event: "push",
      repo: "acme/app",
      sender: "tester",
    });
    expect(res1.ok).toBe(true);
    expect((await res1.json()).matched).toBe(0);

    // Matching event → matched≥1
    const res2 = await harness.sendWebhook({
      event: "deploy",
      repo: "acme/app",
      sender: "tester",
    });
    expect(res2.ok).toBe(true);
    expect((await res2.json()).matched).toBeGreaterThanOrEqual(1);
  });

  it("GET /webhooks/:source returns 404 when source does not support CRC challenge", async () => {
    // The GET /webhooks/:source route handles CRC challenge-response handshakes
    // (only supported by the Twitter provider). For all other webhook sources
    // (like the test provider), it should return 404.
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "crc-test-agent",
          webhooks: [{ source: "test-crc" }],
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
      globalConfig: {
        webhooks: { "test-crc": { type: "test" } },
      },
    });

    await harness.start();

    // The test provider does not implement handleCrcChallenge, so GET should return 404
    const res = await fetch(
      `http://127.0.0.1:${harness.gatewayPort}/webhooks/test-crc?crc_token=some_token`,
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("CRC not supported");
  });

  it("GET /webhooks/:source returns 404 for a completely unknown source", async () => {
    // When no provider is registered for the given source, the GET CRC
    // challenge route also returns 404.
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "crc-unknown-agent",
          webhooks: [{ source: "test-hook" }],
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
      globalConfig: {
        webhooks: { "test-hook": { type: "test" } },
      },
    });

    await harness.start();

    // "totally-unknown-source" has no registered provider
    const res = await fetch(
      `http://127.0.0.1:${harness.gatewayPort}/webhooks/totally-unknown-source?crc_token=x`,
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("CRC not supported");
  });
});
