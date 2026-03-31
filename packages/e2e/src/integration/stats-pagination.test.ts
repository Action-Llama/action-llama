/**
 * Integration test: verify pagination in the stats API.
 *
 * The GET /api/stats/agents/:name/runs endpoint supports pagination via
 * `page` and `limit` query parameters. This test verifies that:
 *   - The default page=1, limit=10 behavior works.
 *   - Custom page and limit parameters correctly paginate results.
 *   - The `total` field correctly reports the total count.
 *   - Page 2 returns subsequent results.
 *
 * Covers: control/routes/stats.ts pagination logic
 * (queryRunsByAgentPaginated + countRunsByAgent, previously not tested with
 * non-default page/limit parameters).
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: stats API pagination", { timeout: 300_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  function statsAPI(h: IntegrationHarness, path: string): Promise<Response> {
    return fetch(`http://127.0.0.1:${h.gatewayPort}${path}`, {
      headers: { Authorization: `Bearer ${h.apiKey}` },
    });
  }

  it("stats/agents/:name/runs supports page and limit pagination", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "pagination-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\necho 'pagination-agent ran'\nexit 0\n",
        },
      ],
    });

    await harness.start();

    // Run the agent 4 times to create multiple history entries.
    for (let i = 0; i < 4; i++) {
      await harness.triggerAgent("pagination-agent");
      await harness.waitForRunResult("pagination-agent", 120_000);
    }

    // Query page 1 with limit=2: should return 2 entries
    const page1Res = await statsAPI(
      harness,
      "/api/stats/agents/pagination-agent/runs?page=1&limit=2",
    );
    expect(page1Res.status).toBe(200);
    const page1Body = await page1Res.json() as {
      runs: unknown[];
      total: number;
      page: number;
      limit: number;
    };

    expect(page1Body.page).toBe(1);
    expect(page1Body.limit).toBe(2);
    expect(page1Body.total).toBeGreaterThanOrEqual(4);
    expect(page1Body.runs).toHaveLength(2);

    // Query page 2 with limit=2: should return next 2 entries
    const page2Res = await statsAPI(
      harness,
      "/api/stats/agents/pagination-agent/runs?page=2&limit=2",
    );
    expect(page2Res.status).toBe(200);
    const page2Body = await page2Res.json() as {
      runs: unknown[];
      total: number;
      page: number;
      limit: number;
    };

    expect(page2Body.page).toBe(2);
    expect(page2Body.limit).toBe(2);
    expect(page2Body.runs).toHaveLength(2);

    // Both pages should have the same total.
    expect(page2Body.total).toBe(page1Body.total);

    // The runs on page 1 and page 2 should be different entries.
    // Since runs are arrays of objects, compare by JSON string to check inequality.
    const page1Ids = JSON.stringify(page1Body.runs);
    const page2Ids = JSON.stringify(page2Body.runs);
    expect(page1Ids).not.toBe(page2Ids);
  });

  it("stats/agents/:name/runs uses default limit=10 when not specified", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "default-limit-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\necho 'ran'\nexit 0\n",
        },
      ],
    });

    await harness.start();

    // Run the agent twice.
    for (let i = 0; i < 2; i++) {
      await harness.triggerAgent("default-limit-agent");
      await harness.waitForRunResult("default-limit-agent", 120_000);
    }

    // Query without page/limit (defaults to page=1, limit=10).
    const res = await statsAPI(harness, "/api/stats/agents/default-limit-agent/runs");
    expect(res.status).toBe(200);
    const body = await res.json() as { runs: unknown[]; total: number; page: number; limit: number };

    expect(body.page).toBe(1);
    expect(body.limit).toBe(10);
    expect(body.total).toBeGreaterThanOrEqual(2);
    expect(body.runs.length).toBeLessThanOrEqual(10);
    expect(body.runs.length).toBeGreaterThanOrEqual(2);
  });

  it("stats/agents/:name/runs returns empty for unknown agent", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "paginator-base-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    await harness.start();
    await harness.triggerAgent("paginator-base-agent");
    await harness.waitForRunResult("paginator-base-agent", 120_000);

    // Query runs for a nonexistent agent.
    const res = await statsAPI(harness, "/api/stats/agents/nonexistent-agent-xyz/runs");
    expect(res.status).toBe(200);
    const body = await res.json() as { runs: unknown[]; total: number };
    expect(body.runs).toHaveLength(0);
    expect(body.total).toBe(0);
  });
});
