/**
 * Integration test: verify grep, lines, and cursor parameters on the
 * scheduler logs endpoint.
 *
 * The existing logs-grep.test.ts only covers the AGENT logs endpoint
 * (GET /api/logs/agents/:name). The SCHEDULER logs endpoint
 * (GET /api/logs/scheduler) supports the same parameters but is not
 * yet tested with them:
 *
 *   ?grep=<regex>   — filter scheduler log entries by regex pattern
 *   ?lines=<N>      — limit the number of entries returned
 *   ?cursor=<tok>   — forward-pagination cursor
 *
 * Both agent and scheduler log endpoints share the same underlying
 * route handler (registerLogRoutes in control/routes/logs.ts), so
 * exercising the scheduler variant achieves additional coverage of
 * the shared parsing / filtering paths.
 *
 * Covers: control/routes/logs.ts
 *   - GET /api/logs/scheduler ?grep regex filtering
 *   - GET /api/logs/scheduler invalid ?grep returns 400
 *   - GET /api/logs/scheduler ?lines limits result count
 *   - GET /api/logs/scheduler ?lines default value (no ?lines param)
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)(
  "integration: scheduler logs grep and lines parameters",
  { timeout: 300_000 },
  () => {
    let harness: IntegrationHarness;

    afterEach(async () => {
      if (harness) await harness.shutdown();
    });

    function logsAPI(h: IntegrationHarness, path: string): Promise<Response> {
      return fetch(`http://127.0.0.1:${h.gatewayPort}${path}`, {
        headers: { Authorization: `Bearer ${h.apiKey}` },
      });
    }

    it("?grep on scheduler logs filters entries by regex pattern", async () => {
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "sched-grep-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\necho 'sched-grep-agent: done'\nexit 0\n",
          },
        ],
      });

      await harness.start();

      // Trigger agent to generate scheduler log entries
      await harness.triggerAgent("sched-grep-agent");
      await harness.waitForRunResult("sched-grep-agent", 120_000);

      await new Promise((r) => setTimeout(r, 500));

      // Grep for a pattern likely to appear in scheduler logs (scheduler always logs "Starting")
      const matchRes = await logsAPI(harness, "/api/logs/scheduler?grep=Starting");
      expect(matchRes.status).toBe(200);
      const matchBody = await matchRes.json() as { entries: any[]; cursor: string | null };
      expect(Array.isArray(matchBody.entries)).toBe(true);
      expect(matchBody).toHaveProperty("cursor");

      // Grep for a pattern that will never match
      const noMatchRes = await logsAPI(
        harness,
        "/api/logs/scheduler?grep=NONEXISTENT_UNIQUE_SCHEDULER_PATTERN_XYZ987654",
      );
      expect(noMatchRes.status).toBe(200);
      const noMatchBody = await noMatchRes.json() as { entries: any[] };
      expect(Array.isArray(noMatchBody.entries)).toBe(true);
      expect(noMatchBody.entries).toHaveLength(0);
    });

    it("?grep with invalid regex on scheduler logs returns 400", async () => {
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "sched-grep-invalid",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\necho 'ran'\nexit 0\n",
          },
        ],
      });

      await harness.start();

      await harness.triggerAgent("sched-grep-invalid");
      await harness.waitForRunResult("sched-grep-invalid", 120_000);

      await new Promise((r) => setTimeout(r, 500));

      // Submit an invalid regex — the opening bracket is not closed
      const res = await logsAPI(
        harness,
        "/api/logs/scheduler?grep=%5B+invalid+regex",
      );
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toBeTruthy();
      expect(body.error.toLowerCase()).toContain("grep");
    });

    it("?lines on scheduler logs limits the result count", async () => {
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "sched-lines-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\necho 'ran'\nexit 0\n",
          },
        ],
      });

      await harness.start();

      // Run agent twice to ensure there are several log entries
      for (let i = 0; i < 2; i++) {
        await harness.triggerAgent("sched-lines-agent");
        await harness.waitForRunResult("sched-lines-agent", 120_000);
      }
      await new Promise((r) => setTimeout(r, 500));

      // Query with lines=2 — result must have at most 2 entries
      const res = await logsAPI(harness, "/api/logs/scheduler?lines=2");
      expect(res.status).toBe(200);
      const body = await res.json() as { entries: any[]; hasMore: boolean; cursor: string | null };

      expect(Array.isArray(body.entries)).toBe(true);
      expect(body.entries.length).toBeLessThanOrEqual(2);
      expect(typeof body.hasMore).toBe("boolean");
      // cursor should be present for forward pagination
      expect(body).toHaveProperty("cursor");
    });

    it("scheduler logs endpoint returns valid response shape with no extra params", async () => {
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "sched-shape-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\necho 'ran'\nexit 0\n",
          },
        ],
      });

      await harness.start();

      await harness.triggerAgent("sched-shape-agent");
      await harness.waitForRunResult("sched-shape-agent", 120_000);

      await new Promise((r) => setTimeout(r, 500));

      const res = await logsAPI(harness, "/api/logs/scheduler");
      expect(res.status).toBe(200);

      const body = await res.json() as {
        entries: any[];
        cursor: string | null;
        hasMore: boolean;
      };

      // All three fields must be present
      expect(body).toHaveProperty("entries");
      expect(body).toHaveProperty("cursor");
      expect(body).toHaveProperty("hasMore");

      expect(Array.isArray(body.entries)).toBe(true);
      // Scheduler should have logged something during startup
      expect(body.entries.length).toBeGreaterThan(0);

      // Each entry must be a valid log object
      for (const entry of body.entries) {
        expect(entry).toHaveProperty("level");
        expect(entry).toHaveProperty("time");
        expect(entry).toHaveProperty("msg");
      }
    });
  },
);
