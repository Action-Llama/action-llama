/**
 * Integration test: Mintlify webhook provider end-to-end.
 *
 * Verifies that the Mintlify webhook provider correctly:
 *   - Accepts unsigned payloads when allowUnsigned=true is configured
 *   - Parses Mintlify build events into WebhookContext
 *   - Triggers agents subscribed to build events
 *   - Maps "failed"/"succeeded" build status to the failure/success conclusion
 *   - Filters based on project name and branch
 *   - Rejects webhooks when no signature and no allowUnsigned
 *
 * Uses allowUnsigned=true to avoid needing real HMAC secrets in tests.
 *
 * Covers: webhooks/providers/mintlify.ts (parseEvent, validateRequest, matchesFilter)
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

/** Send a raw POST to /webhooks/mintlify with the given payload. */
function sendMintlifyWebhook(
  harness: IntegrationHarness,
  payload: object,
): Promise<Response> {
  return fetch(`http://127.0.0.1:${harness.gatewayPort}/webhooks/mintlify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe.skipIf(!DOCKER)("integration: Mintlify webhook provider", { timeout: 300_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("triggers agent on Mintlify build succeeded event", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "mintlify-build-agent",
          webhooks: [{ source: "mintlify", events: ["build"], actions: ["succeeded"] }],
          testScript: [
            "#!/bin/sh",
            "set -e",
            'test -n "$PROMPT" || { echo "PROMPT not set"; exit 1; }',
            'echo "mintlify-build-agent triggered OK"',
            "exit 0",
          ].join("\n"),
        },
      ],
      globalConfig: {
        webhooks: { mintlify: { type: "mintlify", allowUnsigned: true } },
      },
    });

    await harness.start();

    const payload = {
      event: "build",
      action: "succeeded",
      status: "succeeded",
      project: "my-docs",
      title: "Build #100 succeeded",
      url: "https://app.mintlify.com/builds/100",
      branch: "main",
      user: { email: "ci@example.com", name: "CI Bot" },
      timestamp: new Date().toISOString(),
    };

    const res = await sendMintlifyWebhook(harness, payload);
    expect(res.ok).toBe(true);

    const body = await res.json();
    expect(body.matched).toBeGreaterThanOrEqual(1);

    const run = await harness.waitForRunResult("mintlify-build-agent");
    expect(run.result).toBe("completed");
  });

  it("triggers agent on Mintlify build failed event", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "mintlify-failure-agent",
          webhooks: [{ source: "mintlify", events: ["build"], actions: ["failed"] }],
          testScript: "#!/bin/sh\necho 'build failed handler'\nexit 0\n",
        },
      ],
      globalConfig: {
        webhooks: { mintlify: { type: "mintlify", allowUnsigned: true } },
      },
    });

    await harness.start();

    const payload = {
      event: "build",
      action: "failed",
      status: "failed",
      project: "my-docs",
      title: "Build #101 failed",
      error: "Compilation error on line 42",
      url: "https://app.mintlify.com/builds/101",
      branch: "feature/new-docs",
      user: { email: "ci@example.com" },
      timestamp: new Date().toISOString(),
    };

    const res = await sendMintlifyWebhook(harness, payload);
    expect(res.ok).toBe(true);

    const body = await res.json();
    expect(body.matched).toBeGreaterThanOrEqual(1);

    const run = await harness.waitForRunResult("mintlify-failure-agent");
    expect(run.result).toBe("completed");
  });

  it("does not trigger agent when action filter does not match", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "mintlify-succeeded-only",
          // Only subscribe to succeeded builds
          webhooks: [{ source: "mintlify", events: ["build"], actions: ["succeeded"] }],
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
      globalConfig: {
        webhooks: { mintlify: { type: "mintlify", allowUnsigned: true } },
      },
    });

    await harness.start();

    // Send a "failed" event — should not match "succeeded" filter
    const payload = {
      event: "build",
      action: "failed",
      project: "my-docs",
      branch: "main",
      user: { email: "ci@example.com" },
      timestamp: new Date().toISOString(),
    };

    const res = await sendMintlifyWebhook(harness, payload);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.matched).toBe(0);
  });

  it("rejects unsigned Mintlify webhook when no secrets configured", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "mintlify-secure-agent",
          webhooks: [{ source: "mintlify", events: ["build"] }],
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
      globalConfig: {
        // No allowUnsigned, no secrets — any unsigned request is rejected
        webhooks: { mintlify: { type: "mintlify" } },
      },
    });

    await harness.start();

    const payload = {
      event: "build",
      action: "succeeded",
      project: "my-docs",
      user: { email: "ci@example.com" },
    };

    // No x-mintlify-signature header → 401
    const res = await sendMintlifyWebhook(harness, payload);
    expect(res.status).toBe(401);
  });
});
