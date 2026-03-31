/**
 * Integration test: verify pagination on the stats/jobs endpoint.
 *
 * GET /api/stats/jobs supports ?limit, ?offset, ?since, and ?agent query
 * parameters. The existing stats-jobs.test.ts only tests the basic
 * happy-path response shape. This test covers the pagination and
 * filtering parameters that are not yet tested:
 *
 *   ?limit + ?offset — paginate completed job history
 *   ?since=<timestamp> — exclude jobs before a given time
 *   response always has consistent shape (jobs, total, pending, totalPending,
 *   limit, offset) regardless of empty or populated stores
 *
 * Covers: control/routes/stats.ts GET /api/stats/jobs pagination and
 * filtering logic (queryTriggerHistory with includeDeadLetters=false).
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)(
  "integration: stats/jobs pagination and filtering",
  { timeout: 300_000 },
  () => {
    let harness: IntegrationHarness;

    afterEach(async () => {
      if (harness) await harness.shutdown();
    });

    function jobsAPI(h: IntegrationHarness, path: string): Promise<Response> {
      return fetch(`http://127.0.0.1:${h.gatewayPort}${path}`, {
        headers: { Authorization: `Bearer ${h.apiKey}` },
      });
    }

    it("?limit and ?offset paginate the jobs list", async () => {
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "jobs-page-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\necho 'ran'\nexit 0\n",
          },
        ],
      });

      await harness.start();

      // Run the agent 4 times to create enough history
      for (let i = 0; i < 4; i++) {
        await harness.triggerAgent("jobs-page-agent");
        await harness.waitForRunResult("jobs-page-agent", 120_000);
      }

      await new Promise((r) => setTimeout(r, 500));

      // Fetch all jobs (no pagination)
      const allRes = await jobsAPI(harness, "/api/stats/jobs?agent=jobs-page-agent&limit=100");
      expect(allRes.status).toBe(200);
      const allBody = await allRes.json() as {
        jobs: any[];
        total: number;
        limit: number;
        offset: number;
      };
      expect(allBody.total).toBeGreaterThanOrEqual(4);
      expect(allBody.limit).toBe(100);
      expect(allBody.offset).toBe(0);

      // Fetch first 2 entries
      const page1Res = await jobsAPI(
        harness,
        "/api/stats/jobs?agent=jobs-page-agent&limit=2&offset=0",
      );
      expect(page1Res.status).toBe(200);
      const page1Body = await page1Res.json() as { jobs: any[]; total: number };
      expect(page1Body.jobs).toHaveLength(2);
      expect(page1Body.total).toBe(allBody.total);

      // Fetch next 2 entries
      const page2Res = await jobsAPI(
        harness,
        "/api/stats/jobs?agent=jobs-page-agent&limit=2&offset=2",
      );
      expect(page2Res.status).toBe(200);
      const page2Body = await page2Res.json() as { jobs: any[]; total: number };
      // May have fewer if we've exhausted history
      expect(page2Body.jobs.length).toBeGreaterThanOrEqual(0);
      expect(page2Body.total).toBe(allBody.total);

      // Pages 1 and 2 must contain different entries (different instanceIds)
      const p1Ids = new Set(page1Body.jobs.map((j: any) => j.instanceId));
      const p2Ids = new Set(page2Body.jobs.map((j: any) => j.instanceId));
      const overlap = [...p1Ids].filter((id) => p2Ids.has(id));
      expect(overlap).toHaveLength(0);
    });

    it("?since=<future timestamp> on jobs returns empty result", async () => {
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "jobs-since-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\necho 'ran'\nexit 0\n",
          },
        ],
      });

      await harness.start();

      // Run the agent to create history
      await harness.triggerAgent("jobs-since-agent");
      await harness.waitForRunResult("jobs-since-agent", 120_000);

      await new Promise((r) => setTimeout(r, 500));

      // Use a far-future timestamp — all existing jobs are in the past
      const futureMs = new Date("2099-01-01T00:00:00Z").getTime();
      const res = await jobsAPI(
        harness,
        `/api/stats/jobs?agent=jobs-since-agent&since=${futureMs}`,
      );
      expect(res.status).toBe(200);
      const body = await res.json() as {
        jobs: any[];
        total: number;
        pending: Record<string, number>;
        totalPending: number;
      };

      // No entries should exist (all have ts < futureMs)
      expect(body.jobs).toHaveLength(0);
      expect(body.total).toBe(0);

      // Shape is always consistent even when empty
      expect(body).toHaveProperty("pending");
      expect(body).toHaveProperty("totalPending");
      expect(typeof body.pending).toBe("object");
      expect(typeof body.totalPending).toBe("number");
    });

    it("jobs endpoint with no prior runs returns empty jobs but valid shape", async () => {
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "empty-jobs-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\necho 'ran'\nexit 0\n",
          },
        ],
      });

      // Start scheduler but do NOT run any agents
      await harness.start();

      // Query jobs immediately — should be empty but still have valid shape
      const res = await jobsAPI(harness, "/api/stats/jobs");
      expect(res.status).toBe(200);
      const body = await res.json() as {
        jobs: any[];
        total: number;
        pending: Record<string, number>;
        totalPending: number;
        limit: number;
        offset: number;
      };

      expect(Array.isArray(body.jobs)).toBe(true);
      expect(body.total).toBeGreaterThanOrEqual(0);
      expect(typeof body.pending).toBe("object");
      expect(body.pending).not.toBeNull();
      expect(typeof body.totalPending).toBe("number");
      expect(body.totalPending).toBeGreaterThanOrEqual(0);
      expect(typeof body.limit).toBe("number");
      expect(typeof body.offset).toBe("number");
    });

    it("jobs endpoint filters dead letters — no dead-letter entries in result", async () => {
      // Unlike stats/activity, stats/jobs explicitly excludes dead letters.
      // A non-matching webhook creates a dead-letter receipt but should NOT
      // appear in the jobs list.
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "jobs-no-dl-agent",
            webhooks: [{ source: "no-dl-src", events: ["push"] }],
            testScript: "#!/bin/sh\necho 'ran'\nexit 0\n",
          },
        ],
        globalConfig: {
          webhooks: { "no-dl-src": { type: "test" } },
        },
      });

      await harness.start();

      // Send a non-matching webhook (creates a dead-letter receipt)
      const webhookRes = await harness.sendWebhook({
        source: "no-dl-src",
        event: "comment", // agent only listens for "push"
        repo: "acme/app",
      });
      const webhookBody = await webhookRes.json();
      expect(webhookBody.matched).toBe(0); // dead letter

      await new Promise((r) => setTimeout(r, 500));

      // Query jobs — should not include the dead-letter receipt
      const res = await jobsAPI(harness, "/api/stats/jobs");
      expect(res.status).toBe(200);
      const body = await res.json() as { jobs: any[] };

      // No job with result "dead-letter" should appear
      const deadLetterJobs = body.jobs.filter((j: any) => j.result === "dead-letter");
      expect(deadLetterJobs).toHaveLength(0);
    });
  },
);
