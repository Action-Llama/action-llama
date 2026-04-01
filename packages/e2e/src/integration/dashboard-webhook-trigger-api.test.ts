/**
 * Integration test: verify dashboard API enrichment for webhook-triggered runs.
 *
 * When an agent is triggered by a webhook, the stats store records a webhook
 * receipt. The dashboard API uses this to enrich:
 *   - GET /api/dashboard/agents/:name/instances/:id  — includes webhookReceipt
 *   - GET /api/dashboard/triggers/:instanceId        — includes webhook field with source/eventSummary
 *
 * Tests:
 *   1. Instance detail shows webhookReceipt when run was triggered by webhook.
 *   2. Trigger detail shows webhook field with source when run was webhook-triggered.
 *
 * Covers:
 *   - control/routes/dashboard-api.ts: webhook trigger enrichment (previously untested)
 *   - stats/store.ts: getWebhookReceipt called from dashboard API
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)(
  "integration: dashboard API for webhook-triggered runs",
  { timeout: 180_000 },
  () => {
    let harness: IntegrationHarness;

    afterEach(async () => {
      if (harness) await harness.shutdown();
    });

    function gatewayFetch(h: IntegrationHarness, path: string): Promise<Response> {
      return fetch(`http://127.0.0.1:${h.gatewayPort}${path}`, {
        headers: { Authorization: `Bearer ${h.apiKey}` },
      });
    }

    it("dashboard instance detail shows webhookReceipt for webhook-triggered run", async () => {
      // Configure an agent that responds to test webhooks. Send a webhook to trigger it,
      // then verify that the dashboard instance detail endpoint includes a webhookReceipt.
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "webhook-detail-agent",
            webhooks: [{ source: "wh-detail" }],
            testScript: "#!/bin/sh\necho 'webhook-detail-agent ran'\nexit 0\n",
          },
        ],
        globalConfig: {
          webhooks: { "wh-detail": { type: "test", allowUnsigned: true } },
        },
      });

      await harness.start({ webUI: true });

      // Send a webhook to trigger the agent
      const webhookRes = await harness.sendWebhook({
        source: "wh-detail",
        event: "test",
        sender: "test-sender",
        repo: "test/repo",
      });
      expect(webhookRes.ok).toBe(true);

      // Wait for the agent to complete
      const run = await harness.waitForRunResult("webhook-detail-agent", 120_000);
      expect(run.result).toBe("completed");

      // Find the run's instanceId from stats
      const runsRes = await gatewayFetch(harness, "/api/stats/agents/webhook-detail-agent/runs");
      expect(runsRes.ok).toBe(true);
      const runsBody = (await runsRes.json()) as { runs: Array<Record<string, unknown>>; total: number };
      expect(runsBody.total).toBeGreaterThanOrEqual(1);

      const agentRun = runsBody.runs[0]!;
      const instanceId = (agentRun.instanceId ?? agentRun.instance_id) as string | undefined;
      expect(instanceId).toBeDefined();
      if (!instanceId) return;

      // Fetch the dashboard instance detail
      const detailRes = await gatewayFetch(
        harness,
        `/api/dashboard/agents/webhook-detail-agent/instances/${instanceId}`,
      );
      expect(detailRes.ok).toBe(true);
      const detailBody = (await detailRes.json()) as {
        run: Record<string, unknown> | null;
        parentEdge: unknown;
        webhookReceipt?: { source: string; eventSummary?: string } | null;
      };

      expect(detailBody.run).not.toBeNull();

      // webhookReceipt should be present with source info
      expect(detailBody.webhookReceipt).toBeDefined();
      expect(detailBody.webhookReceipt).not.toBeNull();
      if (detailBody.webhookReceipt) {
        expect(detailBody.webhookReceipt.source).toBeTruthy();
      }

      // No parentEdge for a webhook-triggered run
      expect(detailBody.parentEdge).toBeUndefined();
    });

    it("dashboard triggers/:instanceId shows webhook field for webhook-triggered run", async () => {
      // GET /api/dashboard/triggers/:instanceId for a webhook-triggered run should
      // include a `webhook` field with receiptId, source, eventSummary, etc.
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "webhook-trigger-api-agent",
            webhooks: [{ source: "wh-trigger" }],
            testScript: "#!/bin/sh\necho 'webhook-trigger-api-agent ran'\nexit 0\n",
          },
        ],
        globalConfig: {
          webhooks: { "wh-trigger": { type: "test", allowUnsigned: true } },
        },
      });

      await harness.start({ webUI: true });

      // Trigger via webhook
      const webhookRes = await harness.sendWebhook({
        source: "wh-trigger",
        event: "push",
        sender: "deployer",
        repo: "test/repo",
      });
      expect(webhookRes.ok).toBe(true);

      // Wait for agent to complete
      const run = await harness.waitForRunResult("webhook-trigger-api-agent", 120_000);
      expect(run.result).toBe("completed");

      // Get instanceId
      const runsRes = await gatewayFetch(harness, "/api/stats/agents/webhook-trigger-api-agent/runs");
      expect(runsRes.ok).toBe(true);
      const runsBody = (await runsRes.json()) as { runs: Array<Record<string, unknown>>; total: number };
      expect(runsBody.total).toBeGreaterThanOrEqual(1);

      const agentRun = runsBody.runs[0]!;
      const instanceId = (agentRun.instanceId ?? agentRun.instance_id) as string | undefined;
      expect(instanceId).toBeDefined();
      if (!instanceId) return;

      // Fetch trigger details from the dashboard endpoint
      const triggerRes = await gatewayFetch(harness, `/api/dashboard/triggers/${instanceId}`);
      expect(triggerRes.ok).toBe(true);
      const triggerBody = (await triggerRes.json()) as {
        trigger: {
          instanceId: string;
          agentName: string;
          triggerType: string;
          webhook?: {
            receiptId: string;
            source: string;
            eventSummary: string | null;
            deliveryId: string | null;
            matchedAgents: number;
          };
        } | null;
      };

      expect(triggerBody.trigger).not.toBeNull();
      if (triggerBody.trigger) {
        expect(triggerBody.trigger.agentName).toBe("webhook-trigger-api-agent");
        expect(triggerBody.trigger.triggerType).toBe("webhook");

        // webhook enrichment should be present
        expect(triggerBody.trigger.webhook).toBeDefined();
        if (triggerBody.trigger.webhook) {
          expect(typeof triggerBody.trigger.webhook.receiptId).toBe("string");
          expect(triggerBody.trigger.webhook.source).toBeTruthy();
          expect(triggerBody.trigger.webhook.matchedAgents).toBeGreaterThanOrEqual(1);
        }
      }
    });
  },
);
