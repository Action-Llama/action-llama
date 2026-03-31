/**
 * Integration test: Sentry webhook provider end-to-end.
 *
 * Verifies that the Sentry webhook provider correctly:
 *   - Accepts unsigned payloads when allowUnsigned=true is configured
 *   - Parses event_alert, metric_alert, issue, and error Sentry events
 *   - Triggers agents subscribed to Sentry resource types
 *   - Applies resource type filters correctly
 *   - Rejects webhooks when no HMAC secrets configured and not allowUnsigned
 *
 * Sentry sends the event type via the `sentry-hook-resource` header,
 * not as part of the JSON body. Uses allowUnsigned=true in tests.
 *
 * Covers: webhooks/providers/sentry.ts (parseEvent, validateRequest,
 *         matchesFilter) including event_alert, issue, error event parsing
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

/** Send a raw POST to /webhooks/sentry with the given payload and resource header. */
function sendSentryWebhook(
  harness: IntegrationHarness,
  resource: string,
  payload: object,
): Promise<Response> {
  return fetch(`http://127.0.0.1:${harness.gatewayPort}/webhooks/sentry`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Sentry-Hook-Resource": resource,
      "Sentry-Hook-Timestamp": Date.now().toString(),
    },
    body: JSON.stringify(payload),
  });
}

describe.skipIf(!DOCKER)("integration: Sentry webhook provider", { timeout: 300_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("triggers agent on Sentry event_alert", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "sentry-alert-agent",
          webhooks: [
            { source: "sentry", events: ["event_alert"] },
          ],
          testScript: [
            "#!/bin/sh",
            "set -e",
            'test -n "$PROMPT" || { echo "PROMPT not set"; exit 1; }',
            'echo "sentry-alert-agent triggered OK"',
            "exit 0",
          ].join("\n"),
        },
      ],
      globalConfig: {
        webhooks: { sentry: { type: "sentry", allowUnsigned: true } },
      },
    });

    await harness.start();

    const payload = {
      action: "triggered",
      actor: { type: "sentry", name: "Sentry" },
      data: {
        triggered_rule: "Error rate > 5%",
        event: {
          title: "NullPointerException in ProductService",
          web_url: "https://sentry.io/organizations/test-org/issues/123/",
          message: "java.lang.NullPointerException at ProductService.java:42",
        },
      },
    };

    const res = await sendSentryWebhook(harness, "event_alert", payload);
    expect(res.ok).toBe(true);

    const body = await res.json();
    expect(body.matched).toBeGreaterThanOrEqual(1);

    const run = await harness.waitForRunResult("sentry-alert-agent");
    expect(run.result).toBe("completed");
  });

  it("triggers agent on Sentry issue event", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "sentry-issue-agent",
          webhooks: [{ source: "sentry", events: ["issue"] }],
          testScript: "#!/bin/sh\necho 'issue agent'\nexit 0\n",
        },
      ],
      globalConfig: {
        webhooks: { sentry: { type: "sentry", allowUnsigned: true } },
      },
    });

    await harness.start();

    const payload = {
      action: "created",
      actor: { type: "user", name: "dev-user" },
      data: {
        issue: {
          id: "sentry-issue-001",
          title: "Failed to connect to database",
          web_url: "https://sentry.io/organizations/my-org/issues/001/",
          project: { slug: "backend-api" },
          assignedTo: { name: "dev-user" },
        },
      },
    };

    const res = await sendSentryWebhook(harness, "issue", payload);
    expect(res.ok).toBe(true);
    expect((await res.json()).matched).toBeGreaterThanOrEqual(1);

    const run = await harness.waitForRunResult("sentry-issue-agent");
    expect(run.result).toBe("completed");
  });

  it("does not trigger agent when resource type filter does not match", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "sentry-metric-only",
          webhooks: [{ source: "sentry", events: ["metric_alert"] }],
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
      globalConfig: {
        webhooks: { sentry: { type: "sentry", allowUnsigned: true } },
      },
    });

    await harness.start();

    // Send an event_alert — should not match metric_alert filter
    const payload = {
      action: "triggered",
      actor: { type: "sentry" },
      data: {
        triggered_rule: "Error rate",
        event: { title: "High error rate", web_url: "https://sentry.io/issues/1" },
      },
    };

    const res = await sendSentryWebhook(harness, "event_alert", payload);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.matched).toBe(0);
  });

  it("triggers agent on Sentry error event", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "sentry-error-agent",
          webhooks: [{ source: "sentry", events: ["error"] }],
          testScript: "#!/bin/sh\necho 'error event'\nexit 0\n",
        },
      ],
      globalConfig: {
        webhooks: { sentry: { type: "sentry", allowUnsigned: true } },
      },
    });

    await harness.start();

    const payload = {
      action: "created",
      actor: { type: "sentry" },
      data: {
        error: {
          id: "error-123",
          title: "TypeError: Cannot read properties of undefined",
          web_url: "https://sentry.io/organizations/test/issues/error-123/",
          project: { slug: "frontend" },
          message: "Cannot read properties of undefined (reading 'map')",
        },
      },
    };

    const res = await sendSentryWebhook(harness, "error", payload);
    expect(res.ok).toBe(true);
    expect((await res.json()).matched).toBeGreaterThanOrEqual(1);

    const run = await harness.waitForRunResult("sentry-error-agent");
    expect(run.result).toBe("completed");
  });

  it("rejects Sentry webhook when no secrets and not allowUnsigned", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "sentry-secure-agent",
          webhooks: [{ source: "sentry", events: ["event_alert"] }],
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
      globalConfig: {
        // No allowUnsigned, no sentry_client_secret — unsigned requests rejected
        webhooks: { sentry: { type: "sentry" } },
      },
    });

    await harness.start();

    const payload = {
      action: "triggered",
      data: { triggered_rule: "Error rate", event: { title: "Error" } },
    };

    // No sentry-hook-signature header → 401
    const res = await sendSentryWebhook(harness, "event_alert", payload);
    expect(res.status).toBe(401);
  });
});
