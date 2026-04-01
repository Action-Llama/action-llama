/**
 * Integration test: POST /api/logs/agents/:name/:instanceId/summarize
 *
 * The log summarization endpoint reads agent run logs and calls an LLM to
 * produce a short natural-language summary. It is registered by
 * registerLogSummaryRoutes() in control/routes/log-summary.ts.
 *
 * Test scenarios (without a real LLM — fake API keys are used):
 *   1. Invalid agent name → 400 (safety regex blocks traversal)
 *   2. Invalid instance ID → 400
 *   3. Agent exists, has no log file yet → 200 with "No log entries found"
 *   4. Agent ran, known instanceId, logs exist → LLM call fails with fake
 *      key → 500 with { error: "Failed to generate summary: ..." }
 *   5. Agent ran, unknown instanceId → no matching log entries →
 *      200 with "No log entries found"
 *
 * Covers: control/routes/log-summary.ts — all major branches except LLM
 * success (which requires a live model API key).
 */

import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)(
  "integration: log summary API",
  { timeout: 300_000 },
  () => {
    let harness: IntegrationHarness;

    afterEach(async () => {
      if (harness) await harness.shutdown();
    });

    /** Call the summarize endpoint with Bearer auth. */
    function summarize(
      h: IntegrationHarness,
      agentName: string,
      instanceId: string,
      query?: Record<string, string>,
    ): Promise<Response> {
      const params = query ? "?" + new URLSearchParams(query).toString() : "";
      return fetch(
        `http://127.0.0.1:${h.gatewayPort}/api/logs/agents/${agentName}/${instanceId}/summarize${params}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${h.apiKey}` },
        },
      );
    }

    it("returns 400 for invalid agent name (path traversal chars)", async () => {
      harness = await IntegrationHarness.create({
        agents: [
          { name: "summary-name-agent", schedule: "0 0 31 2 *", testScript: "#!/bin/sh\nexit 0\n" },
        ],
      });
      await harness.start();

      const res = await summarize(harness, "../etc/passwd", "some-instance");
      expect(res.status).toBe(400);

      const body = (await res.json()) as { error: string };
      expect(body.error).toBeTruthy();
    });

    it("returns 400 for invalid instance ID", async () => {
      harness = await IntegrationHarness.create({
        agents: [
          { name: "summary-id-agent", schedule: "0 0 31 2 *", testScript: "#!/bin/sh\nexit 0\n" },
        ],
      });
      await harness.start();

      // Instance ID with invalid chars (contains space — SAFE_AGENT_NAME only allows [a-z0-9-])
      const res = await summarize(harness, "summary-id-agent", "bad instance!");
      expect(res.status).toBe(400);

      const body = (await res.json()) as { error: string };
      expect(body.error).toBeTruthy();
    });

    it("returns 200 with 'No log entries found' when agent has no log file yet", async () => {
      harness = await IntegrationHarness.create({
        agents: [
          { name: "summary-nolog-agent", schedule: "0 0 31 2 *", testScript: "#!/bin/sh\nexit 0\n" },
        ],
      });
      await harness.start();

      // Don't trigger any runs — no log file should exist yet.
      // The endpoint reads from <projectPath>/.al/logs/<name>-<date>.log.
      const res = await summarize(harness, "summary-nolog-agent", "some-instance-id");
      expect(res.status).toBe(200);

      const body = (await res.json()) as { summary: string; cached: boolean };
      expect(body.summary).toMatch(/no log entries found/i);
    });

    it("returns 500 with error when LLM call fails (fake API key)", async () => {
      // The harness uses a fake API key ("sk-test-fake-key"), so the real Anthropic
      // API will reject it. The endpoint should catch this and return 500.
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "summary-llm-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\necho 'summary-llm-agent: completed'\nexit 0\n",
          },
        ],
      });
      await harness.start();

      // Trigger a run so that log file is created
      const runEndPromise = harness.events.waitFor(
        "run:end",
        (e) => e.agentName === "summary-llm-agent",
        60_000,
      );
      await harness.triggerAgent("summary-llm-agent");
      const runEndEvent = await runEndPromise;
      const instanceId = runEndEvent.instanceId;

      // Wait a bit for log flush
      await new Promise((r) => setTimeout(r, 500));

      // Now call summarize — log file exists, entries exist, but LLM fails (fake key)
      const res = await summarize(harness, "summary-llm-agent", instanceId);

      // Should be 500 because the fake API key is rejected by the LLM provider
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/failed to generate summary/i);
    });

    it("returns 200 with 'No log entries found' for unknown instanceId even when log file exists", async () => {
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "summary-unknown-inst-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\necho 'completed'\nexit 0\n",
          },
        ],
      });
      await harness.start();

      // Run the agent so a log file is created
      await harness.triggerAgent("summary-unknown-inst-agent");
      await harness.waitForRunResult("summary-unknown-inst-agent");

      // Wait for log flush
      await new Promise((r) => setTimeout(r, 500));

      // Request summary for an instanceId that doesn't exist in the log file
      const res = await summarize(
        harness,
        "summary-unknown-inst-agent",
        "nonexistent-instance-xyz",
      );
      expect(res.status).toBe(200);

      const body = (await res.json()) as { summary: string; cached: boolean };
      expect(body.summary).toMatch(/no log entries found/i);
    });
  },
);
