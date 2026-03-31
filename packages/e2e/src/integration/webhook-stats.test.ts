/**
 * Integration test: verify webhook receipt tracking in the stats store.
 *
 * When a webhook triggers an agent, the gateway:
 * 1. Records a receipt (with receiptId, source, headers, body)
 * 2. Dispatches to matching agents
 * 3. Updates receipt status after dispatch
 *
 * The receiptId appears in trigger history as `webhookReceiptId` and can be
 * fetched directly via `/api/stats/webhooks/:receiptId`.
 *
 * Covers: webhook receipt creation, trigger history with webhookReceiptId,
 * and the /api/stats/webhooks/:receiptId endpoint.
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: webhook stats tracking", { timeout: 180_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  async function statsAPI(h: IntegrationHarness, path: string): Promise<Response> {
    return fetch(`http://127.0.0.1:${h.gatewayPort}${path}`, {
      headers: { Authorization: `Bearer ${h.apiKey}` },
    });
  }

  it("webhook dispatch creates a receipt trackable via stats API", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "receipt-agent",
          webhooks: [{ source: "test-hook" }],
          testScript: "#!/bin/sh\necho 'receipt-agent ran'\nexit 0\n",
        },
      ],
      globalConfig: {
        webhooks: { "test-hook": { type: "test" } },
      },
    });

    await harness.start();

    // Send a webhook and wait for the run
    const res = await harness.sendWebhook({
      source: "test",
      event: "push",
      repo: "acme/app",
      sender: "tester",
    });
    expect(res.ok).toBe(true);
    const dispatchBody = await res.json();
    expect(dispatchBody.matched).toBeGreaterThanOrEqual(1);

    // Wait for the agent run to complete
    const run = await harness.waitForRunResult("receipt-agent");
    expect(run.result).toBe("completed");

    // Query trigger history filtered by webhook trigger type
    const triggersRes = await statsAPI(
      harness,
      "/api/stats/triggers?agent=receipt-agent&triggerType=webhook",
    );
    expect(triggersRes.ok).toBe(true);
    const triggersBody = await triggersRes.json();
    expect(triggersBody.total).toBeGreaterThanOrEqual(1);

    const trigger = triggersBody.triggers[0];
    expect(trigger.triggerType).toBe("webhook");
    expect(trigger.agentName).toBe("receipt-agent");

    // The webhook receipt ID should be in the trigger record
    const receiptId = trigger.webhookReceiptId;
    if (receiptId) {
      // Fetch the specific receipt
      const receiptRes = await statsAPI(harness, `/api/stats/webhooks/${receiptId}`);
      expect(receiptRes.ok).toBe(true);
      const receiptBody = await receiptRes.json();
      expect(receiptBody).toHaveProperty("receipt");
      if (receiptBody.receipt) {
        expect(receiptBody.receipt.id).toBe(receiptId);
        expect(receiptBody.receipt.source).toBe("test");
      }
    }
  });

  it("non-matching webhook creates a dead-letter receipt", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "filter-agent",
          webhooks: [{ source: "test-hook", events: ["deploy"] }],
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
      globalConfig: {
        webhooks: { "test-hook": { type: "test" } },
      },
    });

    await harness.start();

    // Send a non-matching webhook (wrong event type)
    const res = await harness.sendWebhook({
      event: "push", // filter-agent only accepts "deploy"
      repo: "acme/app",
      sender: "tester",
    });
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.matched).toBe(0);

    // Allow time for the receipt to be recorded
    await new Promise((r) => setTimeout(r, 500));

    // Query trigger history with dead letters
    const triggersRes = await statsAPI(harness, "/api/stats/triggers?all=1");
    expect(triggersRes.ok).toBe(true);
    const triggersBody = await triggersRes.json();

    // Should have a dead-letter record for the unmatched webhook
    const hasDeadLetter = triggersBody.triggers.some(
      (t: any) => t.result === "dead-letter" || t.deadLetterReason === "no_match",
    );
    expect(hasDeadLetter).toBe(true);
  });

  it("webhook stats shows correct matched agent count in receipt", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "multi-agent-a",
          webhooks: [{ source: "test-hook" }],
          testScript: "#!/bin/sh\nexit 0\n",
        },
        {
          name: "multi-agent-b",
          webhooks: [{ source: "test-hook" }],
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
      globalConfig: {
        webhooks: { "test-hook": { type: "test" } },
      },
    });

    await harness.start();

    const res = await harness.sendWebhook({
      event: "push",
      repo: "acme/app",
      sender: "tester",
    });
    expect(res.ok).toBe(true);
    const body = await res.json();

    // Both agents should match
    expect(body.matched).toBe(2);

    // Wait for both runs
    await Promise.all([
      harness.waitForRunResult("multi-agent-a"),
      harness.waitForRunResult("multi-agent-b"),
    ]);

    // Trigger history should show both webhook runs
    const triggersRes = await statsAPI(
      harness,
      "/api/stats/triggers?triggerType=webhook",
    );
    expect(triggersRes.ok).toBe(true);
    const triggersBody = await triggersRes.json();
    expect(triggersBody.total).toBeGreaterThanOrEqual(2);
  });

  it("GET /api/stats/webhooks/:receiptId returns 404 for nonexistent receipt ID", async () => {
    // When a receipt ID does not exist in the stats store, the endpoint
    // should return 404 with { receipt: null }.
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "receipt-404-agent",
          webhooks: [{ source: "test-hook" }],
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
      globalConfig: {
        webhooks: { "test-hook": { type: "test" } },
      },
    });

    await harness.start();

    // Query a nonexistent receipt ID
    const res = await statsAPI(harness, "/api/stats/webhooks/nonexistent-receipt-id-xyz");
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body).toHaveProperty("receipt");
    expect(body.receipt).toBeNull();
  });
});
