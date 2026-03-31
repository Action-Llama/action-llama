/**
 * Integration test: Linear webhook provider end-to-end.
 *
 * Verifies that the Linear webhook provider correctly:
 *   - Accepts unsigned payloads when allowUnsigned=true is configured
 *   - Parses Linear Issue events into WebhookContext
 *   - Triggers agents subscribed to "issues" events from a Linear source
 *   - Filters out events that don't match the agent's configured event type
 *   - Handles Comment events and maps them to "issue_comment"
 *
 * Uses allowUnsigned=true to avoid needing real HMAC secrets in tests.
 *
 * NOTE: The webhook source name must match the provider type ("linear") so
 * that the route-level config lookup (webhookConfigs["linear"]) picks up the
 * allowUnsigned setting. This is how all provider types work in the gateway.
 *
 * Covers: webhooks/providers/linear.ts (parseEvent, validateRequest, matchesFilter)
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

/** Send a raw POST to /webhooks/linear with the given payload. */
function sendLinearWebhook(
  harness: IntegrationHarness,
  payload: object,
): Promise<Response> {
  return fetch(`http://127.0.0.1:${harness.gatewayPort}/webhooks/linear`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe.skipIf(!DOCKER)("integration: Linear webhook provider", { timeout: 300_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  it("triggers agent on Linear Issue create event", async () => {
    // Name the webhook source "linear" to match the provider type so the
    // gateway's webhookConfigs["linear"] lookup picks up allowUnsigned=true.
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "linear-issue-agent",
          webhooks: [{ source: "linear", events: ["issues"], actions: ["create"] }],
          testScript: [
            "#!/bin/sh",
            "set -e",
            // Verify the PROMPT env var is set (webhook context is baked in)
            'test -n "$PROMPT" || { echo "PROMPT not set"; exit 1; }',
            'echo "linear-issue-agent triggered OK"',
            "exit 0",
          ].join("\n"),
        },
      ],
      globalConfig: {
        webhooks: { linear: { type: "linear", allowUnsigned: true } },
      },
    });

    await harness.start();

    // Construct a valid Linear Issue "create" payload
    const payload = {
      action: "create",
      type: "Issue",
      organizationId: "org-test-123",
      data: {
        id: "issue-abc-001",
        number: 42,
        title: "Test Linear issue from integration test",
        description: "This is a test issue created by the integration test suite.",
        url: "https://linear.app/test-org/issue/TEST-42",
        creator: { email: "developer@test.com" },
        assignee: null,
        labels: [{ name: "bug" }, { name: "high-priority" }],
        team: {
          organization: { id: "org-test-123" },
        },
      },
      createdBy: { email: "developer@test.com" },
    };

    const webhookRes = await sendLinearWebhook(harness, payload);
    expect(webhookRes.ok).toBe(true);

    const body = await webhookRes.json();
    expect(body.matched).toBeGreaterThanOrEqual(1);

    // Wait for the triggered run to complete
    const run = await harness.waitForRunResult("linear-issue-agent");
    expect(run.result).toBe("completed");
  });

  it("does not trigger agent for non-matching Linear event type", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "linear-filter-agent",
          webhooks: [{ source: "linear", events: ["issues"] }],
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
      globalConfig: {
        webhooks: { linear: { type: "linear", allowUnsigned: true } },
      },
    });

    await harness.start();

    // Send a "Project" type event — should parse as "project" (not "issues")
    // The Linear provider maps unknown types to type.toLowerCase() = "project"
    const payload = {
      action: "update",
      type: "Project",
      organizationId: "org-test-456",
      data: {
        id: "project-001",
        name: "Test Project",
        title: "Test Project",
        url: "https://linear.app/test-org/project/TEST-1",
        team: {
          organization: { id: "org-test-456" },
        },
      },
    };

    const webhookRes = await sendLinearWebhook(harness, payload);
    // The webhook is received and processed, but matched=0 since "project" ≠ "issues"
    expect(webhookRes.ok).toBe(true);
    const body = await webhookRes.json();
    expect(body.matched).toBe(0);
  });

  it("parses Linear Comment event as issue_comment and triggers matching agent", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "linear-comment-agent",
          webhooks: [{ source: "linear", events: ["issue_comment"] }],
          testScript: "#!/bin/sh\necho 'got comment event'\nexit 0\n",
        },
      ],
      globalConfig: {
        webhooks: { linear: { type: "linear", allowUnsigned: true } },
      },
    });

    await harness.start();

    // Send a Linear Comment event — maps to "issue_comment" in the provider
    const payload = {
      action: "create",
      type: "Comment",
      organizationId: "org-test-789",
      data: {
        id: "comment-001",
        body: "This is a test comment.",
        url: "https://linear.app/test-org/issue/TEST-42#comment-001",
        issue: {
          id: "issue-001",
          number: 42,
          title: "Parent issue for comment test",
          url: "https://linear.app/test-org/issue/TEST-42",
          creator: { email: "user@test.com" },
          labels: [],
          team: {
            organization: { id: "org-test-789" },
          },
        },
      },
      createdBy: { email: "commenter@test.com" },
    };

    const webhookRes = await sendLinearWebhook(harness, payload);
    expect(webhookRes.ok).toBe(true);

    const body = await webhookRes.json();
    expect(body.matched).toBeGreaterThanOrEqual(1);

    const run = await harness.waitForRunResult("linear-comment-agent");
    expect(run.result).toBe("completed");
  });

  it("rejects Linear webhook with no signature when secrets are required", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "linear-signed-agent",
          webhooks: [{ source: "linear", events: ["issues"] }],
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
      globalConfig: {
        // No allowUnsigned=true, no secrets configured.
        // With no secrets and allowUnsigned=false, the provider returns null (reject).
        webhooks: { linear: { type: "linear" } },
      },
    });

    await harness.start();

    const payload = {
      action: "create",
      type: "Issue",
      organizationId: "org-test-000",
      data: {
        id: "issue-002",
        number: 1,
        title: "Unsigned issue",
        team: { organization: { id: "org-test-000" } },
      },
    };

    // POST without linear-signature header — signature validation fails → 401
    const res = await sendLinearWebhook(harness, payload);
    expect(res.status).toBe(401);
  });
});
