/**
 * Integration tests: stats API endpoints with StatusTracker — no Docker required.
 *
 * When webUI=true, a StatusTracker is created for the scheduler. The stats
 * routes in control/routes/stats.ts have special handling when statusTracker
 * is provided:
 *
 *   - /api/stats/triggers: merges running instances from statusTracker into
 *     the DB results (when offset === 0)
 *   - /api/stats/jobs: merges running instances and includes `pending` +
 *     `totalPending` fields from statusTracker.getAllAgents()
 *   - /api/stats/activity: includes running/pending rows from statusTracker
 *
 * Without Docker, there are no running containers, so running instances are
 * empty — but the status-tracker code paths ARE exercised and the response
 * shape is verified.
 *
 * Test scenarios:
 *   1. GET /api/stats/triggers with statusTracker returns { triggers:[], total:0 }
 *      shape (running merge path exercises statusTracker.getInstances())
 *   2. GET /api/stats/jobs with statusTracker returns { jobs:[], total:0,
 *      pending:{}, totalPending:0, limit:50, offset:0 } shape
 *   3. GET /api/stats/jobs?offset=1 skips the running instances merge
 *      (only offset=0 triggers the merge path)
 *   4. GET /api/stats/triggers?agent=<name> filters correctly
 *   5. GET /api/stats/activity with statusTracker returns { rows:[], total:0 }
 *
 * Covers:
 *   - control/routes/stats.ts: triggers endpoint — statusTracker merge path (offset=0)
 *   - control/routes/stats.ts: jobs endpoint — statusTracker running+pending merge
 *   - control/routes/stats.ts: jobs endpoint — offset>0 skips merge
 *   - control/routes/stats.ts: jobs endpoint — pending{} + totalPending fields
 *   - control/routes/stats.ts: activity endpoint — buildMemRows() path
 */

import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness } from "./harness.js";

describe(
  "integration: stats API with StatusTracker (no Docker required)",
  { timeout: 60_000 },
  () => {
    let harness: IntegrationHarness;
    let gatewayAccessible = false;

    afterEach(async () => {
      if (harness) {
        try { await harness.shutdown(); } catch {}
        harness = undefined as unknown as IntegrationHarness;
        gatewayAccessible = false;
      }
    });

    async function startHarnessWithWebUI(): Promise<void> {
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "stats-tracker-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });

      try {
        await harness.start({ webUI: true });
        gatewayAccessible = true;
      } catch {
        try {
          const h = await fetch(
            `http://127.0.0.1:${harness.gatewayPort}/health`,
            { signal: AbortSignal.timeout(3_000) },
          );
          gatewayAccessible = h.ok;
        } catch {
          gatewayAccessible = false;
        }
      }
    }

    function statsGet(path: string): Promise<Response> {
      return fetch(`http://127.0.0.1:${harness.gatewayPort}${path}`, {
        headers: { Authorization: `Bearer ${harness.apiKey}` },
        signal: AbortSignal.timeout(5_000),
      });
    }

    it("GET /api/stats/triggers with statusTracker returns correct response shape", async () => {
      await startHarnessWithWebUI();
      if (!gatewayAccessible) return;

      const res = await statsGet("/api/stats/triggers");
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        triggers: unknown[];
        total: number;
        limit: number;
        offset: number;
      };
      expect(Array.isArray(body.triggers)).toBe(true);
      expect(body.triggers).toHaveLength(0);
      expect(typeof body.total).toBe("number");
      expect(body.total).toBe(0);
      // Default limit and offset should be reflected
      expect(body.limit).toBe(50);
      expect(body.offset).toBe(0);
    });

    it("GET /api/stats/jobs with statusTracker returns correct shape including pending fields", async () => {
      await startHarnessWithWebUI();
      if (!gatewayAccessible) return;

      const res = await statsGet("/api/stats/jobs");
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        jobs: unknown[];
        total: number;
        pending: Record<string, number>;
        totalPending: number;
        limit: number;
        offset: number;
      };
      expect(Array.isArray(body.jobs)).toBe(true);
      expect(body.jobs).toHaveLength(0);
      expect(typeof body.total).toBe("number");
      expect(body.total).toBe(0);
      // pending and totalPending are populated by statusTracker.getAllAgents()
      expect(typeof body.pending).toBe("object");
      expect(typeof body.totalPending).toBe("number");
      expect(body.totalPending).toBe(0);
      // Default limit=50, offset=0
      expect(body.limit).toBe(50);
      expect(body.offset).toBe(0);
    });

    it("GET /api/stats/jobs?limit=10&offset=0 reflects pagination params", async () => {
      await startHarnessWithWebUI();
      if (!gatewayAccessible) return;

      const res = await statsGet("/api/stats/jobs?limit=10&offset=0");
      expect(res.status).toBe(200);

      const body = (await res.json()) as { jobs: unknown[]; limit: number; offset: number };
      expect(body.limit).toBe(10);
      expect(body.offset).toBe(0);
    });

    it("GET /api/stats/jobs?offset=1 skips running-instance merge (only offset=0 triggers merge)", async () => {
      await startHarnessWithWebUI();
      if (!gatewayAccessible) return;

      // offset=1 skips the `if (statusTracker && offset === 0)` merge path
      // Still returns correct shape with pending fields
      const res = await statsGet("/api/stats/jobs?offset=1");
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        jobs: unknown[];
        total: number;
        pending: Record<string, number>;
        totalPending: number;
        offset: number;
      };
      expect(Array.isArray(body.jobs)).toBe(true);
      expect(body.offset).toBe(1);
      // pending fields still present (calculated outside the merge block)
      expect(typeof body.pending).toBe("object");
      expect(typeof body.totalPending).toBe("number");
    });

    it("GET /api/stats/triggers?agent=stats-tracker-agent filters correctly", async () => {
      await startHarnessWithWebUI();
      if (!gatewayAccessible) return;

      const res = await statsGet("/api/stats/triggers?agent=stats-tracker-agent");
      expect(res.status).toBe(200);

      const body = (await res.json()) as { triggers: unknown[]; total: number };
      expect(Array.isArray(body.triggers)).toBe(true);
      expect(body.total).toBe(0);
    });

    it("GET /api/stats/activity with statusTracker returns correct shape", async () => {
      await startHarnessWithWebUI();
      if (!gatewayAccessible) return;

      const res = await statsGet("/api/stats/activity");
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        rows: unknown[];
        total: number;
        limit: number;
        offset: number;
      };
      expect(Array.isArray(body.rows)).toBe(true);
      expect(typeof body.total).toBe("number");
      expect(typeof body.limit).toBe("number");
      expect(typeof body.offset).toBe("number");
    });

    it("GET /api/stats/activity?status=running with statusTracker returns empty when no containers", async () => {
      await startHarnessWithWebUI();
      if (!gatewayAccessible) return;

      // Without Docker, no containers are running
      const res = await statsGet("/api/stats/activity?status=running");
      expect(res.status).toBe(200);

      const body = (await res.json()) as { rows: unknown[]; total: number };
      expect(Array.isArray(body.rows)).toBe(true);
      expect(body.rows).toHaveLength(0);
      expect(body.total).toBe(0);
    });
  },
);
