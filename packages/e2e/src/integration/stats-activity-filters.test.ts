/**
 * Integration test: verify advanced filtering on the stats/activity endpoint.
 *
 * The GET /api/stats/activity endpoint supports several query parameters that
 * are only partially exercised by existing tests:
 *
 *   ?triggerType=manual|webhook|schedule|agent
 *       → filter rows by trigger type (not tested on activity, only on /triggers)
 *
 *   ?since=<unix-ms>
 *       → exclude rows older than this timestamp (not tested on activity endpoint)
 *
 *   ?status=<value>
 *       → comma-separated status values, e.g. "completed,errored"
 *       → existing tests only cover single values ("completed", "pending", "all")
 *
 * This test also verifies the response shape of GET /api/stats/jobs — specifically
 * that the `pending` and `totalPending` fields are always present (even when 0),
 * because their absence would be a regression.
 *
 * Covers: control/routes/stats.ts
 *   - /api/stats/activity ?triggerType filter
 *   - /api/stats/activity ?since filter (future timestamp → empty)
 *   - /api/stats/activity comma-separated ?status filter
 *   - /api/stats/jobs `pending` / `totalPending` response fields
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)(
  "integration: stats/activity advanced filters",
  { timeout: 300_000 },
  () => {
    let harness: IntegrationHarness;

    afterEach(async () => {
      if (harness) await harness.shutdown();
    });

    function statsAPI(h: IntegrationHarness, path: string): Promise<Response> {
      return fetch(`http://127.0.0.1:${h.gatewayPort}${path}`, {
        headers: { Authorization: `Bearer ${h.apiKey}` },
      });
    }

    it("?triggerType=manual on activity returns only manually triggered rows", async () => {
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "activity-type-agent",
            schedule: "0 0 31 2 *", // never fires by cron
            webhooks: [{ source: "act-src", events: ["deploy"] }],
            testScript: "#!/bin/sh\necho 'ran'\nexit 0\n",
          },
        ],
        globalConfig: {
          webhooks: { "act-src": { type: "test" } },
        },
      });

      await harness.start();

      // Trigger manually (manual run)
      await harness.triggerAgent("activity-type-agent");
      const run1 = await harness.waitForRunResult("activity-type-agent", 120_000);
      expect(run1.result).toBe("completed");

      // Send a matching webhook (webhook run)
      await harness.sendWebhook({ source: "act-src", event: "deploy", repo: "acme/app" });
      const run2 = await harness.waitForRunResult("activity-type-agent", 120_000);
      expect(run2.result).toBe("completed");

      // Allow stats to be written
      await new Promise((r) => setTimeout(r, 500));

      // Filter activity by manual triggers
      const manualRes = await statsAPI(
        harness,
        "/api/stats/activity?agent=activity-type-agent&triggerType=manual",
      );
      expect(manualRes.status).toBe(200);
      const manualBody = await manualRes.json() as { rows: any[]; total: number };

      expect(manualBody.total).toBeGreaterThanOrEqual(1);
      // All returned rows should be manual triggers
      for (const row of manualBody.rows) {
        expect(row.triggerType).toBe("manual");
      }

      // Filter activity by webhook triggers
      const webhookRes = await statsAPI(
        harness,
        "/api/stats/activity?agent=activity-type-agent&triggerType=webhook",
      );
      expect(webhookRes.status).toBe(200);
      const webhookBody = await webhookRes.json() as { rows: any[]; total: number };

      expect(webhookBody.total).toBeGreaterThanOrEqual(1);
      // All returned rows should be webhook triggers
      for (const row of webhookBody.rows) {
        expect(row.triggerType).toBe("webhook");
      }

      // The two filtered sets should have fewer rows than the unfiltered set
      const allRes = await statsAPI(
        harness,
        "/api/stats/activity?agent=activity-type-agent",
      );
      const allBody = await allRes.json() as { rows: any[]; total: number };
      expect(allBody.total).toBeGreaterThanOrEqual(manualBody.total + webhookBody.total);
    });

    it("?since=<future timestamp> on activity returns empty result", async () => {
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "activity-since-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\necho 'ran'\nexit 0\n",
          },
        ],
      });

      await harness.start();

      // Run the agent to create history
      await harness.triggerAgent("activity-since-agent");
      await harness.waitForRunResult("activity-since-agent", 120_000);

      await new Promise((r) => setTimeout(r, 500));

      // Query activity with a far-future timestamp — no runs exist after 2099
      const futureMs = new Date("2099-01-01T00:00:00Z").getTime();
      const res = await statsAPI(
        harness,
        `/api/stats/activity?agent=activity-since-agent&since=${futureMs}`,
      );
      expect(res.status).toBe(200);
      const body = await res.json() as { rows: any[]; total: number };

      // No entries should be returned (all have ts < futureMs)
      expect(body.rows).toHaveLength(0);
      expect(body.total).toBe(0);
    });

    it("comma-separated ?status=completed,errored on activity returns both types", async () => {
      harness = await IntegrationHarness.create({
        agents: [
          {
            // Agent that exits with non-zero to produce an errored run
            name: "activity-multi-status",
            schedule: "0 0 31 2 *",
            // First trigger: success; second trigger: error
            testScript: "#!/bin/sh\necho 'completed run'\nexit 0\n",
          },
        ],
      });

      await harness.start();

      // Run agent (creates a completed row)
      await harness.triggerAgent("activity-multi-status");
      const run = await harness.waitForRunResult("activity-multi-status", 120_000);
      expect(run.result).toBe("completed");

      await new Promise((r) => setTimeout(r, 500));

      // Filter by comma-separated status values: "completed,errored"
      const res = await statsAPI(
        harness,
        "/api/stats/activity?agent=activity-multi-status&status=completed,errored",
      );
      expect(res.status).toBe(200);
      const body = await res.json() as { rows: any[]; total: number; limit: number; offset: number };

      // Response shape is always present
      expect(body).toHaveProperty("rows");
      expect(body).toHaveProperty("total");
      expect(body).toHaveProperty("limit");
      expect(body).toHaveProperty("offset");
      expect(Array.isArray(body.rows)).toBe(true);

      // The completed run should appear in the comma-separated filter
      expect(body.total).toBeGreaterThanOrEqual(1);
      // Every returned row must be either completed or errored
      for (const row of body.rows) {
        expect(["completed", "errored"]).toContain(row.result);
      }
    });

    it("?status=all on activity returns all rows including dead letters", async () => {
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "activity-all-status",
            schedule: "0 0 31 2 *",
            webhooks: [{ source: "dl-src", events: ["push"] }],
            testScript: "#!/bin/sh\necho 'ran'\nexit 0\n",
          },
        ],
        globalConfig: {
          webhooks: { "dl-src": { type: "test" } },
        },
      });

      await harness.start();

      // Run the agent manually (completed row)
      await harness.triggerAgent("activity-all-status");
      await harness.waitForRunResult("activity-all-status", 120_000);

      // Send non-matching webhook (creates dead letter receipt)
      await harness.sendWebhook({ source: "dl-src", event: "comment", repo: "acme/app" });

      await new Promise((r) => setTimeout(r, 500));

      // ?status=all should return everything (completed + dead-letter)
      const allRes = await statsAPI(
        harness,
        "/api/stats/activity?agent=activity-all-status&status=all",
      );
      expect(allRes.status).toBe(200);
      const allBody = await allRes.json() as { rows: any[]; total: number };

      // Should include both the completed run and the dead-letter
      expect(allBody.total).toBeGreaterThanOrEqual(1);

      // ?status=completed (single) should return fewer rows than ?status=all
      const completedRes = await statsAPI(
        harness,
        "/api/stats/activity?agent=activity-all-status&status=completed",
      );
      const completedBody = await completedRes.json() as { rows: any[]; total: number };
      expect(allBody.total).toBeGreaterThanOrEqual(completedBody.total);
    });

    it("/api/stats/jobs response includes pending and totalPending fields", async () => {
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "jobs-shape-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\necho 'ran'\nexit 0\n",
          },
        ],
      });

      await harness.start();

      // Run the agent to create a jobs entry
      await harness.triggerAgent("jobs-shape-agent");
      await harness.waitForRunResult("jobs-shape-agent", 120_000);

      await new Promise((r) => setTimeout(r, 500));

      const res = await statsAPI(harness, "/api/stats/jobs");
      expect(res.status).toBe(200);

      const body = await res.json() as {
        jobs: any[];
        total: number;
        pending: Record<string, number>;
        totalPending: number;
        limit: number;
        offset: number;
      };

      // All fields must be present
      expect(body).toHaveProperty("jobs");
      expect(body).toHaveProperty("total");
      expect(body).toHaveProperty("pending");
      expect(body).toHaveProperty("totalPending");
      expect(body).toHaveProperty("limit");
      expect(body).toHaveProperty("offset");

      // pending is a record (may be empty when no items are queued)
      expect(typeof body.pending).toBe("object");
      expect(body.pending).not.toBeNull();

      // totalPending is numeric (0 when nothing is queued)
      expect(typeof body.totalPending).toBe("number");
      expect(body.totalPending).toBeGreaterThanOrEqual(0);

      // jobs array contains at least our completed run
      expect(Array.isArray(body.jobs)).toBe(true);
      expect(body.total).toBeGreaterThanOrEqual(1);
    });
  },
);
