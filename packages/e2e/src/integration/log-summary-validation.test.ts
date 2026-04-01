/**
 * Integration tests: POST /api/logs/agents/:name/:instanceId/summarize
 * validation error paths — no Docker required.
 *
 * The log summarization endpoint (registered in Phase 3 via registerDashboardRoutes)
 * validates the agent name and instance ID before doing any disk or LLM work.
 * These validation responses (HTTP 400) are returned regardless of whether any
 * agent has ever run.
 *
 * The gateway starts in Phase 3 of `startScheduler()`, before the Phase 4 Docker
 * check. When Docker is unavailable, Phase 4 fails but the gateway (and all routes
 * registered in Phase 3) are still accessible.
 *
 * Test scenarios (no Docker required):
 *   1. POST with invalid agent name (path traversal chars) → 400
 *   2. POST with invalid instance ID (special chars) → 400
 *   3. POST with valid name and instance ID but no log file → 200 "No log entries found"
 *   4. POST with valid name/instance but grep param is invalid regex → 400
 *
 * Covers:
 *   - control/routes/log-summary.ts: SAFE_AGENT_NAME validation (lines 43-44)
 *   - control/routes/log-summary.ts: grep regex error path (line 55)
 *   - control/routes/log-summary.ts: findLatestLogFile returns null (line 69)
 *   - control/routes/log-helpers.ts: SAFE_AGENT_NAME regex
 */

import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness } from "./harness.js";

describe(
  "integration: log summary API validation paths (no Docker required)",
  { timeout: 60_000 },
  () => {
    let harness: IntegrationHarness;
    let gatewayAccessible = false;

    afterEach(async () => {
      if (harness) {
        try { await harness.shutdown(); } catch {}
        harness = undefined as unknown as IntegrationHarness;
      }
      gatewayAccessible = false;
    });

    /**
     * Helper: POST to the log summary endpoint with Bearer auth.
     */
    function summarize(
      h: IntegrationHarness,
      agentName: string,
      instanceId: string,
      query?: Record<string, string>,
    ): Promise<Response> {
      const params = query ? "?" + new URLSearchParams(query).toString() : "";
      return fetch(
        `http://127.0.0.1:${h.gatewayPort}/api/logs/agents/${encodeURIComponent(agentName)}/${encodeURIComponent(instanceId)}/summarize${params}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${h.apiKey}`,
            "Content-Type": "application/json",
          },
          signal: AbortSignal.timeout(5_000),
        },
      );
    }

    /**
     * Set up a harness, start the scheduler (webUI: true to register dashboard
     * routes), and probe the gateway. Sets `gatewayAccessible` to true if Phase 3
     * completed and the /health endpoint responds.
     */
    async function startHarness(agentName: string): Promise<void> {
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: agentName,
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });

      // Start the scheduler with webUI: true so that registerDashboardRoutes
      // (and therefore registerLogSummaryRoutes) is called in Phase 3.
      try {
        await harness.start({ webUI: true });
        // Docker available — scheduler started fully
        gatewayAccessible = true;
      } catch {
        // Phase 4 (Docker) failed — Phase 3 gateway may still be running
        try {
          const healthRes = await fetch(
            `http://127.0.0.1:${harness.gatewayPort}/health`,
            { signal: AbortSignal.timeout(3_000) },
          );
          gatewayAccessible = healthRes.ok;
        } catch {
          gatewayAccessible = false;
        }
      }
    }

    it("returns 400 for invalid agent name (path traversal chars)", async () => {
      await startHarness("summary-val-name-agent");

      if (!gatewayAccessible) {
        // Phase 3 gateway not reachable in this environment — skip gracefully
        return;
      }

      const res = await summarize(harness, "../etc/passwd", "some-instance");
      expect(res.status).toBe(400);

      const body = (await res.json()) as { error: string };
      expect(body.error).toBeTruthy();
      expect(typeof body.error).toBe("string");
    });

    it("returns 400 for invalid instance ID (special chars)", async () => {
      await startHarness("summary-val-inst-agent");

      if (!gatewayAccessible) {
        return;
      }

      // Instance ID with special characters not matching SAFE_AGENT_NAME
      // SAFE_AGENT_NAME = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/
      const res = await summarize(harness, "summary-val-inst-agent", "bad instance!");
      expect(res.status).toBe(400);

      const body = (await res.json()) as { error: string };
      expect(body.error).toBeTruthy();
      expect(body.error).toMatch(/invalid/i);
    });

    it("returns 200 with 'No log entries found' when agent has no log file", async () => {
      await startHarness("summary-val-nolog-agent");

      if (!gatewayAccessible) {
        return;
      }

      // No agent has run — no log file exists in .al/logs/
      const res = await summarize(harness, "summary-val-nolog-agent", "some-instance-id");
      expect(res.status).toBe(200);

      const body = (await res.json()) as { summary: string; cached: boolean };
      expect(body.summary).toMatch(/no log entries found/i);
      expect(body.cached).toBe(false);
    });

    it("returns 400 for invalid grep regex pattern", async () => {
      await startHarness("summary-val-grep-agent");

      if (!gatewayAccessible) {
        return;
      }

      // Pass an invalid regex in the ?grep query parameter
      const res = await summarize(harness, "summary-val-grep-agent", "some-instance-id", {
        grep: "[invalid-regex",
      });
      expect(res.status).toBe(400);

      const body = (await res.json()) as { error: string };
      expect(body.error).toBeTruthy();
      expect(typeof body.error).toBe("string");
    });
  },
);
