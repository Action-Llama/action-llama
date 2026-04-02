/**
 * Integration tests: POST /api/logs/agents/:name/:instanceId/summarize
 * — custom prompt body parameter and no-models error path (no Docker required).
 *
 * The log summarization endpoint (log-summary.ts, added in ff37d00) was extended
 * to accept an optional `prompt` field in the POST body. When supplied:
 *   - In-memory cache and DB cache checks are bypassed (caching only works
 *     for the default prompt).
 *   - A single user message containing the logs + custom prompt is sent to the
 *     LLM, rather than the system + user message pair used for default summaries.
 *   - The response is always returned with `cached: false`.
 *
 * Also tested: the endpoint returns 500 with "No models configured" when the
 * project config.toml has an empty [models] table at request time. This path
 * (lines 120-130 in log-summary.ts) is reached only after log entries are found.
 *
 * Test scenarios (no Docker required):
 *   1. POST with { prompt: "custom question" } and no log file → 200 "No log entries
 *      found" (cached: false) — customPrompt does not change the no-log-file path.
 *   2. POST with { prompt: "   " } (whitespace only) → treated as no custom prompt
 *      (customPrompt = undefined after trim+falsy check); same "no log entries" result.
 *   3. POST with { prompt: "custom" } and log entries but config has no models →
 *      500 "No models configured in project config".
 *   4. POST with { prompt: "custom question" } and log entries with real model defined →
 *      500 "Failed to generate summary" (fake API key rejected); confirms custom prompt
 *      path reaches LLM call with cached: false absent from error response.
 *
 * Covers:
 *   - control/routes/log-summary.ts: customPrompt parsing from POST body (lines 49-57)
 *   - control/routes/log-summary.ts: cache bypass when customPrompt is set (line 74)
 *   - control/routes/log-summary.ts: no-models-configured 500 path (lines 120-130)
 *   - control/routes/log-summary.ts: LLM call with single user message (lines 155-161)
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { IntegrationHarness } from "./harness.js";

const TODAY = new Date().toISOString().slice(0, 10);

/** Create a minimal pino-format log line. */
function pinoLine(msg: string, instanceId: string, extraFields?: Record<string, unknown>): string {
  return JSON.stringify({
    level: 30,
    time: Date.now(),
    msg,
    name: "test-agent",
    pid: 1,
    hostname: "localhost",
    instance: instanceId,
    ...extraFields,
  });
}

describe(
  "integration: log summary custom prompt and no-models error path (no Docker required)",
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

    /** POST to the summarize endpoint with Bearer auth and optional JSON body. */
    function summarize(
      h: IntegrationHarness,
      agentName: string,
      instanceId: string,
      body?: Record<string, unknown>,
    ): Promise<Response> {
      return fetch(
        `http://127.0.0.1:${h.gatewayPort}/api/logs/agents/${agentName}/${instanceId}/summarize`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${h.apiKey}`,
            "Content-Type": "application/json",
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(10_000),
        },
      );
    }

    /**
     * Create a harness, optionally write log lines, then start the scheduler.
     * On Phase 4 failure (no Docker), probe /health to verify Phase 3 gateway is accessible.
     */
    async function setupHarness(opts: {
      agentName: string;
      logLines?: string[];
    }): Promise<void> {
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: opts.agentName,
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });

      if (opts.logLines && opts.logLines.length > 0) {
        const logsPath = resolve(harness.projectPath, ".al", "logs");
        mkdirSync(logsPath, { recursive: true });
        writeFileSync(
          join(logsPath, `${opts.agentName}-${TODAY}.log`),
          opts.logLines.join("\n") + "\n",
        );
      }

      try {
        await harness.start({ webUI: true });
        gatewayAccessible = true;
      } catch {
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

    it("custom prompt with no log file returns 200 'No log entries found' (cached: false)", async () => {
      await setupHarness({ agentName: "cust-prompt-nolog" });
      if (!gatewayAccessible) return;

      // No log file has been written — findLogFiles returns empty array.
      // Even with a custom prompt, the "no log file" path returns 200.
      const res = await summarize(harness, "cust-prompt-nolog", "some-instance-id", {
        prompt: "What did this agent do wrong?",
      });
      expect(res.status).toBe(200);

      const body = (await res.json()) as { summary: string; cached: boolean };
      expect(body.summary).toMatch(/no log entries found/i);
      // With customPrompt, cached should always be false (caching is bypassed)
      expect(body.cached).toBe(false);
    });

    it("whitespace-only prompt is treated as no custom prompt (customPrompt = undefined)", async () => {
      await setupHarness({ agentName: "cust-prompt-ws" });
      if (!gatewayAccessible) return;

      // A prompt consisting only of whitespace trims to "" → falsy → customPrompt = undefined.
      // Behavior should be identical to no-prompt case: no log file → "No log entries found".
      const res = await summarize(harness, "cust-prompt-ws", "some-instance-id", {
        prompt: "   \t\n  ",
      });
      expect(res.status).toBe(200);

      const body = (await res.json()) as { summary: string; cached: boolean };
      expect(body.summary).toMatch(/no log entries found/i);
    });

    it("returns 500 'No models configured' when config.toml has empty [models] table and logs exist", async () => {
      const agentName = "cust-prompt-nomodels";
      const instanceId = "test-instance-abc";

      // Write a real log entry so the endpoint proceeds past the "no entries" check.
      await setupHarness({
        agentName,
        logLines: [pinoLine("agent started", instanceId)],
      });
      if (!gatewayAccessible) return;

      // Overwrite config.toml with an empty [models] table.
      // loadGlobalConfig() is called on each request, so this change takes effect immediately.
      writeFileSync(
        resolve(harness.projectPath, "config.toml"),
        `[gateway]\nport = ${harness.gatewayPort}\n\n[models]\n`,
      );

      const res = await summarize(harness, agentName, instanceId, {
        prompt: "Summarize what happened.",
      });
      expect(res.status).toBe(500);

      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/no models configured/i);
    });

    it("custom prompt with log entries and a real model reaches LLM call → 500 (fake key)", async () => {
      const agentName = "cust-prompt-llfail";
      const instanceId = "inst-abc-123";

      // Write a log entry with extra fields (exercises the rich-log-formatting path
      // added in c5876cc — uses JSON.stringify(rest) instead of just e.msg).
      await setupHarness({
        agentName,
        logLines: [
          pinoLine("tool call: bash", instanceId, { tool: "bash", command: "ls -la" }),
          pinoLine("agent finished", instanceId),
        ],
      });
      if (!gatewayAccessible) return;

      // customPrompt is set → cache check is bypassed.
      // Log entries exist → model is resolved → LLM call happens.
      // Fake API key causes LLM call to fail → 500.
      const res = await summarize(harness, agentName, instanceId, {
        prompt: "Was there an error?",
      });
      // LLM call must fail with fake key (anthropic rejects "sk-test-fake-key")
      expect(res.status).toBe(500);

      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/failed to generate summary/i);
    });
  },
);
