/**
 * Integration test: webhook replay endpoint.
 *
 * Verifies that previously received webhooks can be replayed via:
 *   POST /api/webhooks/:receiptId/replay
 *
 * The replay endpoint:
 *   1. Fetches the stored webhook receipt (body + headers) from the stats store
 *   2. Re-dispatches it to the webhook registry (skipping signature validation)
 *   3. Returns the dispatch result (matched count, new receipt ID)
 *
 * This is an authenticated endpoint (requires Bearer token).
 *
 * Covers: events/routes/webhooks.ts POST /api/webhooks/:receiptId/replay
 *         including the re-dispatch path and stats store interaction.
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: webhook replay", { timeout: 300_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  /** Call an authenticated API with the harness API key. */
  function authedFetch(
    h: IntegrationHarness,
    method: string,
    path: string,
    body?: object,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${h.apiKey}`,
    };
    if (body) headers["Content-Type"] = "application/json";
    return fetch(`http://127.0.0.1:${h.gatewayPort}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  it("replays a webhook and triggers the agent a second time", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "replay-target-agent",
          webhooks: [{ source: "test-replay", events: ["deploy"] }],
          testScript: "#!/bin/sh\necho 'replay-target-agent ran'\nexit 0\n",
        },
      ],
      globalConfig: {
        webhooks: { "test-replay": { type: "test" } },
      },
    });

    await harness.start();

    // Send the first webhook
    const webhookRes = await fetch(`http://127.0.0.1:${harness.gatewayPort}/webhooks/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "test-replay",
        event: "deploy",
        action: "created",
        repo: "acme/app",
        sender: "ci-bot",
        title: "Deploy v1.0",
      }),
    });
    expect(webhookRes.ok).toBe(true);
    const webhookBody = await webhookRes.json();
    expect(webhookBody.matched).toBeGreaterThanOrEqual(1);
    expect(webhookBody.receiptId).toBeDefined();

    const receiptId: string = webhookBody.receiptId;

    // Wait for the first run to complete
    const firstRun = await harness.waitForRunResult("replay-target-agent");
    expect(firstRun.result).toBe("completed");

    // Verify the receipt exists in the stats store
    const receiptRes = await authedFetch(harness, "GET", `/api/stats/webhooks/${receiptId}`);
    expect(receiptRes.ok).toBe(true);
    const receipt = await receiptRes.json();
    expect(receipt.receiptId).toBe(receiptId);

    // Replay the webhook
    const replayRes = await authedFetch(
      harness,
      "POST",
      `/api/webhooks/${receiptId}/replay`,
    );
    expect(replayRes.ok).toBe(true);

    const replayBody = await replayRes.json();
    expect(replayBody.ok).toBe(true);
    expect(replayBody.matched).toBeGreaterThanOrEqual(1);

    // The replay should have triggered the agent again
    const secondRun = await harness.waitForRunResult("replay-target-agent");
    expect(secondRun.result).toBe("completed");
  });

  it("returns 404 when replaying a nonexistent receipt ID", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "replay-404-agent",
          webhooks: [{ source: "test-replay-404", events: ["deploy"] }],
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
      globalConfig: {
        webhooks: { "test-replay-404": { type: "test" } },
      },
    });

    await harness.start();

    const res = await authedFetch(
      harness,
      "POST",
      "/api/webhooks/nonexistent-receipt-id-00000/replay",
    );
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  it("replay includes matched count from re-dispatched event", async () => {
    // Two agents subscribed to the same source — replay should match both
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "replay-multi-1",
          webhooks: [{ source: "test-multi-replay", events: ["push"] }],
          testScript: "#!/bin/sh\nexit 0\n",
        },
        {
          name: "replay-multi-2",
          webhooks: [{ source: "test-multi-replay", events: ["push"] }],
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
      globalConfig: {
        webhooks: { "test-multi-replay": { type: "test" } },
      },
    });

    await harness.start();

    // Send initial webhook
    const webhookRes = await fetch(`http://127.0.0.1:${harness.gatewayPort}/webhooks/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "test-multi-replay",
        event: "push",
        repo: "org/repo",
        sender: "dev",
      }),
    });
    expect(webhookRes.ok).toBe(true);
    const { receiptId } = await webhookRes.json();
    expect(receiptId).toBeDefined();

    // Wait for both initial runs
    await Promise.all([
      harness.waitForRunResult("replay-multi-1"),
      harness.waitForRunResult("replay-multi-2"),
    ]);

    // Replay
    const replayRes = await authedFetch(
      harness,
      "POST",
      `/api/webhooks/${receiptId}/replay`,
    );
    expect(replayRes.ok).toBe(true);

    const replayBody = await replayRes.json();
    expect(replayBody.ok).toBe(true);
    // Both agents should match the replay
    expect(replayBody.matched).toBeGreaterThanOrEqual(2);

    // Wait for both replay runs
    await Promise.all([
      harness.waitForRunResult("replay-multi-1"),
      harness.waitForRunResult("replay-multi-2"),
    ]);
  });
});
