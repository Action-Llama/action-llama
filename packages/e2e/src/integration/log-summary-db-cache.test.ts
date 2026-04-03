/**
 * Integration tests: log summary API — DB-persisted summary cache path.
 *
 * When POST /api/logs/agents/:name/:instanceId/summarize is called with no
 * custom parameters (no ?lines, ?after, ?before, ?grep, no body prompt):
 *   1. The endpoint first checks the in-memory summaryCache Map (cache hit → return immediately)
 *   2. If not in memory, it checks statsStore.queryRunByInstanceId(instanceId) for a DB-persisted
 *      summary (if run.summary is non-null, that is returned with cached: true)
 *   3. Only if neither cache has a result does it read log files and call the LLM
 *
 * This test covers path #2: the DB-persisted summary lookup.
 *
 * To reach this path:
 *   - A run record with a non-null summary must exist in the runs table
 *   - The in-memory summaryCache must NOT have it (fresh harness, first request)
 *   - No custom prompt (which would skip the cache check)
 *   - No ?lines/?after/?before/?grep query params (ditto)
 *
 * We use IntegrationHarness with webUI=true so that registerLogSummaryRoutes()
 * receives a statsStore. We write directly to the DB (via a secondary StatsStore
 * connection) before calling the endpoint.
 *
 * Test scenarios (no Docker required):
 *   1. Run with DB-persisted summary → POST returns { summary, cached: true }
 *   2. Run with null summary → DB cache miss; falls through to log files
 *      (returns "No log entries found" since no log file exists, cached: false)
 *   3. Unknown instanceId → queryRunByInstanceId() returns undefined → DB cache miss;
 *      falls through to log files → "No log entries found"
 *   4. Run with DB summary + custom prompt in body → cache skipped → log files read
 *      → "No log entries found" (log files absent), cached: false
 *
 * Covers:
 *   - control/routes/log-summary.ts: summaryCache miss → statsStore.queryRunByInstanceId (line 86)
 *   - control/routes/log-summary.ts: run.summary non-null → return cached: true (lines 87-90)
 *   - control/routes/log-summary.ts: run.summary null → DB cache miss → fall through (lines 86-91)
 *   - control/routes/log-summary.ts: customPrompt → skip cache check → fall through (line 74)
 */

import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { IntegrationHarness } from "./harness.js";

const { StatsStore } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/stats/store.js"
);

describe(
  "integration: log summary DB-persisted summary cache path (no Docker required)",
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

    /** Start harness with webUI=true so statsStore is passed to registerLogSummaryRoutes. */
    async function startHarness(): Promise<void> {
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "summary-cache-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });

      try {
        await harness.start({ webUI: true });
        gatewayAccessible = true;
      } catch {
        // Phase 4 (Docker) may fail — check if Phase 3 gateway is still accessible
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

    /**
     * POST to the log summary endpoint with Bearer auth.
     * Optional body for custom prompt, optional query params.
     */
    function summarize(
      agentName: string,
      instanceId: string,
      opts: { body?: Record<string, string>; query?: Record<string, string> } = {},
    ): Promise<Response> {
      const params = opts.query ? "?" + new URLSearchParams(opts.query).toString() : "";
      const headers: Record<string, string> = {
        Authorization: `Bearer ${harness.apiKey}`,
      };
      if (opts.body) {
        headers["Content-Type"] = "application/json";
      }
      return fetch(
        `http://127.0.0.1:${harness.gatewayPort}/api/logs/agents/${encodeURIComponent(agentName)}/${encodeURIComponent(instanceId)}/summarize${params}`,
        {
          method: "POST",
          headers,
          body: opts.body ? JSON.stringify(opts.body) : undefined,
          signal: AbortSignal.timeout(8_000),
        },
      );
    }

    it(
      "run with DB-persisted summary returns cached: true with summary text",
      async () => {
        await startHarness();
        if (!gatewayAccessible) return;

        const instanceId = `inst-${randomUUID().slice(0, 8)}`;
        const expectedSummary = "Agent fetched user data and wrote report successfully.";

        // Write a run record with a pre-set summary directly to the DB
        const dbPath = `${harness.projectPath}/.al/action-llama.db`;
        const store = new StatsStore(dbPath);
        try {
          store.recordRun({
            instanceId,
            agentName: "summary-cache-agent",
            triggerType: "manual",
            result: "completed",
            startedAt: Date.now() - 5000,
            durationMs: 4500,
          });
          store.updateRunSummary(instanceId, expectedSummary);
        } finally {
          store.close();
        }

        // Call summarize endpoint with no custom params — should hit DB cache
        const res = await summarize("summary-cache-agent", instanceId);
        expect(res.status).toBe(200);

        const body = await res.json() as { summary: string; cached: boolean };
        expect(body.summary).toBe(expectedSummary);
        expect(body.cached).toBe(true);
      },
    );

    it(
      "run with null summary → DB cache miss → falls through to log files → 'No log entries found'",
      async () => {
        await startHarness();
        if (!gatewayAccessible) return;

        const instanceId = `inst-${randomUUID().slice(0, 8)}`;

        // Write a run record WITHOUT a summary (summary field stays null)
        const dbPath = `${harness.projectPath}/.al/action-llama.db`;
        const store = new StatsStore(dbPath);
        try {
          store.recordRun({
            instanceId,
            agentName: "summary-cache-agent",
            triggerType: "manual",
            result: "completed",
            startedAt: Date.now() - 3000,
            durationMs: 2500,
          });
          // Do NOT call updateRunSummary — run.summary is null
        } finally {
          store.close();
        }

        // With null summary, DB cache misses; falls through to log files.
        // Since there are no log files for this agent, returns "No log entries found"
        const res = await summarize("summary-cache-agent", instanceId);
        expect(res.status).toBe(200);

        const body = await res.json() as { summary: string; cached: boolean };
        expect(body.summary).toContain("No log entries found");
        expect(body.cached).toBe(false);
      },
    );

    it(
      "unknown instanceId → queryRunByInstanceId returns undefined → 'No log entries found'",
      async () => {
        await startHarness();
        if (!gatewayAccessible) return;

        const unknownInstanceId = `inst-${randomUUID().slice(0, 8)}-unknown`;

        // No run record for this instanceId — queryRunByInstanceId returns undefined
        const res = await summarize("summary-cache-agent", unknownInstanceId);
        expect(res.status).toBe(200);

        const body = await res.json() as { summary: string; cached: boolean };
        expect(body.summary).toContain("No log entries found");
        expect(body.cached).toBe(false);
      },
    );

    it(
      "customPrompt bypasses DB cache check even when summary exists in DB",
      async () => {
        await startHarness();
        if (!gatewayAccessible) return;

        const instanceId = `inst-${randomUUID().slice(0, 8)}`;
        const storedSummary = "Cached summary that should NOT be returned.";

        // Write a run with a stored summary
        const dbPath = `${harness.projectPath}/.al/action-llama.db`;
        const store = new StatsStore(dbPath);
        try {
          store.recordRun({
            instanceId,
            agentName: "summary-cache-agent",
            triggerType: "manual",
            result: "completed",
            startedAt: Date.now() - 4000,
            durationMs: 3500,
          });
          store.updateRunSummary(instanceId, storedSummary);
        } finally {
          store.close();
        }

        // With a custom prompt, cache is bypassed — falls through to log files
        // Since no log files exist, returns "No log entries found"
        const res = await summarize("summary-cache-agent", instanceId, {
          body: { prompt: "What did the agent accomplish?" },
        });
        expect(res.status).toBe(200);

        const body = await res.json() as { summary: string; cached: boolean };
        // Should NOT return the cached summary — falls through to log file check
        expect(body.summary).not.toBe(storedSummary);
        expect(body.summary).toContain("No log entries found");
        expect(body.cached).toBe(false);
      },
    );
  },
);
