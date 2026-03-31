/**
 * Integration test: verify pagination and filtering in the stats triggers endpoint.
 *
 * The GET /api/stats/triggers endpoint supports:
 *   - limit: max entries per page
 *   - offset: skip entries for pagination
 *   - since: Unix timestamp filter (only return entries after this time)
 *   - triggerType: filter by trigger type (manual, webhook, schedule, agent)
 *
 * Covers: control/routes/stats.ts — queryTriggerHistory / countTriggerHistory
 * with non-default offset and since parameters (previously untested).
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: stats triggers pagination and filtering", { timeout: 300_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  function statsAPI(h: IntegrationHarness, path: string): Promise<Response> {
    return fetch(`http://127.0.0.1:${h.gatewayPort}${path}`, {
      headers: { Authorization: `Bearer ${h.apiKey}` },
    });
  }

  it("offset parameter paginates trigger history", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "trigger-page-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\necho 'ran'\nexit 0\n",
        },
      ],
    });

    await harness.start();

    // Run the agent 4 times to create enough trigger history.
    for (let i = 0; i < 4; i++) {
      await harness.triggerAgent("trigger-page-agent");
      await harness.waitForRunResult("trigger-page-agent", 120_000);
    }

    // Get all triggers (limit=10, offset=0)
    const allRes = await statsAPI(harness, "/api/stats/triggers?agent=trigger-page-agent&limit=10");
    expect(allRes.status).toBe(200);
    const allBody = await allRes.json() as { triggers: unknown[]; total: number };
    expect(allBody.total).toBeGreaterThanOrEqual(4);

    // Get first 2 (offset=0, limit=2)
    const page1Res = await statsAPI(
      harness,
      "/api/stats/triggers?agent=trigger-page-agent&limit=2&offset=0",
    );
    const page1Body = await page1Res.json() as { triggers: unknown[]; total: number };
    expect(page1Body.triggers).toHaveLength(2);
    expect(page1Body.total).toBe(allBody.total);

    // Get next 2 (offset=2, limit=2)
    const page2Res = await statsAPI(
      harness,
      "/api/stats/triggers?agent=trigger-page-agent&limit=2&offset=2",
    );
    const page2Body = await page2Res.json() as { triggers: unknown[]; total: number };
    expect(page2Body.triggers).toHaveLength(2);

    // Total should be the same on both pages.
    expect(page2Body.total).toBe(page1Body.total);

    // The two pages should contain different entries.
    const page1Json = JSON.stringify(page1Body.triggers);
    const page2Json = JSON.stringify(page2Body.triggers);
    expect(page1Json).not.toBe(page2Json);
  });

  it("since parameter filters triggers to only recent entries", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "trigger-since-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\necho 'ran'\nexit 0\n",
        },
      ],
    });

    await harness.start();

    // Run the agent
    await harness.triggerAgent("trigger-since-agent");
    await harness.waitForRunResult("trigger-since-agent", 120_000);

    // Record the "before" time, then run again.
    const midpointMs = Date.now();
    const midpointSec = Math.floor(midpointMs / 1000);

    await new Promise((r) => setTimeout(r, 500));

    await harness.triggerAgent("trigger-since-agent");
    await harness.waitForRunResult("trigger-since-agent", 120_000);

    // Query ALL triggers for this agent (no since filter).
    const allRes = await statsAPI(
      harness,
      `/api/stats/triggers?agent=trigger-since-agent&limit=100`,
    );
    const allBody = await allRes.json() as { triggers: unknown[]; total: number };
    expect(allBody.total).toBeGreaterThanOrEqual(2);

    // Query with since=midpoint (should only return the 2nd run).
    const sinceRes = await statsAPI(
      harness,
      `/api/stats/triggers?agent=trigger-since-agent&limit=100&since=${midpointSec}`,
    );
    expect(sinceRes.status).toBe(200);
    const sinceBody = await sinceRes.json() as { triggers: unknown[]; total: number };

    // The "since" filtered result should have fewer entries than the total.
    expect(sinceBody.total).toBeLessThan(allBody.total);
    // But should still have at least 1 entry (the 2nd run happened after midpoint).
    expect(sinceBody.total).toBeGreaterThanOrEqual(1);
  });

  it("triggerType=manual filter returns only manually triggered runs", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "trigger-type-agent",
          schedule: "0 0 31 2 *",
          webhooks: [{ source: "type-src", events: ["push"] }],
          testScript: "#!/bin/sh\necho 'ran'\nexit 0\n",
        },
      ],
    });

    await harness.start();

    // Trigger manually
    await harness.triggerAgent("trigger-type-agent");
    const run1 = await harness.waitForRunResult("trigger-type-agent", 120_000);
    expect(run1.result).toBe("completed");

    // Trigger via webhook
    await harness.sendWebhook({ source: "type-src", event: "push", repo: "acme/app" });
    const run2 = await harness.waitForRunResult("trigger-type-agent", 120_000);
    expect(run2.result).toBe("completed");

    // Query only manual triggers
    const manualRes = await statsAPI(
      harness,
      "/api/stats/triggers?agent=trigger-type-agent&triggerType=manual&all=1",
    );
    expect(manualRes.status).toBe(200);
    const manualBody = await manualRes.json() as { triggers: any[]; total: number };
    expect(manualBody.total).toBeGreaterThanOrEqual(1);
    // All returned triggers should have type=manual
    for (const t of manualBody.triggers) {
      if (t.result !== "running") {
        expect(t.triggerType).toBe("manual");
      }
    }

    // Query only webhook triggers
    const webhookRes = await statsAPI(
      harness,
      "/api/stats/triggers?agent=trigger-type-agent&triggerType=webhook&all=1",
    );
    expect(webhookRes.status).toBe(200);
    const webhookBody = await webhookRes.json() as { triggers: any[]; total: number };
    expect(webhookBody.total).toBeGreaterThanOrEqual(1);
    // All returned triggers should have type=webhook
    for (const t of webhookBody.triggers) {
      if (t.result !== "running") {
        expect(t.triggerType).toBe("webhook");
      }
    }
  });
});
