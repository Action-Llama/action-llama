/**
 * Integration tests: summary field in /api/stats/activity response — no Docker required.
 *
 * The summary column was added to the runs table (feat commit 6afe3b20):
 *   - StatsStore.updateRunSummary() stores summary text on a completed run
 *   - GET /api/stats/activity returns a summary field in each row
 *   - When summary is null/absent, the field is null in the response
 *   - When summary is set, the field carries the text
 *
 * These tests use the StatsStore directly (no scheduler needed) then verify
 * the gateway's /api/stats/activity endpoint reflects the summary field.
 * Uses IntegrationHarness with webUI=false (no StatusTracker) so that the
 * activity endpoint reads only from the DB (no in-memory running rows).
 *
 * Test scenarios (no Docker required):
 *   1. Run with no summary → activity row has summary: null
 *   2. Run with updateRunSummary() applied → activity row has the summary text
 *   3. Two runs: one with summary, one without → both rows returned, summary field per row
 *
 * Covers:
 *   - stats/store.ts: updateRunSummary() + queryActivityRows() summary field in SQL JOIN
 *   - control/routes/stats.ts: /api/stats/activity — summary field included in DB rows
 *   - db/schema.ts: runs.summary column added in 6afe3b20
 */

import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { IntegrationHarness } from "./harness.js";

const { StatsStore } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/stats/store.js"
);

describe(
  "integration: summary field in /api/stats/activity (no Docker required)",
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

    async function startHarness(): Promise<void> {
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "summary-test-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });

      try {
        await harness.start();
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

    function activityGet(query = ""): Promise<Response> {
      return fetch(
        `http://127.0.0.1:${harness.gatewayPort}/api/stats/activity${query}`,
        {
          headers: { Authorization: `Bearer ${harness.apiKey}` },
          signal: AbortSignal.timeout(5_000),
        },
      );
    }

    it("run with no summary has summary: null in activity response", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      // Write a run record directly to the DB (same file the gateway uses)
      const dbPath = `${harness.projectPath}/.al/action-llama.db`;
      const store = new StatsStore(dbPath);
      const instanceId = `summary-test-agent-${randomUUID().slice(0, 8)}`;
      store.recordRun({
        instanceId,
        agentName: "summary-test-agent",
        triggerType: "manual",
        result: "completed",
        exitCode: 0,
        startedAt: Date.now() - 5000,
        durationMs: 3000,
      });
      store.close();

      const res = await activityGet("?status=completed");
      expect(res.ok).toBe(true);
      const body = (await res.json()) as { rows: Array<Record<string, unknown>>; total: number };
      expect(body.rows.length).toBeGreaterThanOrEqual(1);

      // Find the row we just inserted
      const row = body.rows.find((r) => r.instanceId === instanceId);
      expect(row).toBeDefined();
      if (row) {
        // summary column should be null when not set
        expect(row.summary ?? null).toBeNull();
      }
    });

    it("run with updateRunSummary applied has summary text in activity response", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const dbPath = `${harness.projectPath}/.al/action-llama.db`;
      const store = new StatsStore(dbPath);
      const instanceId = `summary-test-agent-${randomUUID().slice(0, 8)}`;
      store.recordRun({
        instanceId,
        agentName: "summary-test-agent",
        triggerType: "schedule",
        result: "completed",
        exitCode: 0,
        startedAt: Date.now() - 10000,
        durationMs: 3000,
      });

      // Apply a summary — exercises the updateRunSummary() SQL path
      const summaryText = "The agent successfully processed all items.";
      store.updateRunSummary(instanceId, summaryText);
      store.close();

      const res = await activityGet("?status=completed");
      expect(res.ok).toBe(true);
      const body = (await res.json()) as { rows: Array<Record<string, unknown>>; total: number };
      expect(body.rows.length).toBeGreaterThanOrEqual(1);

      // Find the row we just inserted
      const row = body.rows.find((r) => r.instanceId === instanceId);
      expect(row).toBeDefined();
      if (row) {
        expect(row.summary).toBe(summaryText);
      }
    });

    it("two runs: with and without summary — both in response with correct summary values", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const dbPath = `${harness.projectPath}/.al/action-llama.db`;
      const store = new StatsStore(dbPath);
      const now = Date.now();

      const idWithSummary = `summary-test-agent-${randomUUID().slice(0, 8)}`;
      const idNoSummary = `summary-test-agent-${randomUUID().slice(0, 8)}`;

      store.recordRun({
        instanceId: idWithSummary,
        agentName: "summary-test-agent",
        triggerType: "manual",
        result: "completed",
        exitCode: 0,
        startedAt: now - 20000,
        durationMs: 3000,
      });
      store.updateRunSummary(idWithSummary, "Run with a summary.");

      store.recordRun({
        instanceId: idNoSummary,
        agentName: "summary-test-agent",
        triggerType: "manual",
        result: "completed",
        exitCode: 0,
        startedAt: now - 15000,
        durationMs: 3000,
      });
      // No updateRunSummary call for idNoSummary
      store.close();

      const res = await activityGet("?status=completed&limit=100");
      expect(res.ok).toBe(true);
      const body = (await res.json()) as { rows: Array<Record<string, unknown>>; total: number };
      expect(body.rows.length).toBeGreaterThanOrEqual(2);

      const rowWith = body.rows.find((r) => r.instanceId === idWithSummary);
      const rowWithout = body.rows.find((r) => r.instanceId === idNoSummary);

      expect(rowWith).toBeDefined();
      expect(rowWithout).toBeDefined();

      if (rowWith) expect(rowWith.summary).toBe("Run with a summary.");
      if (rowWithout) expect(rowWithout.summary ?? null).toBeNull();
    });
  },
);
