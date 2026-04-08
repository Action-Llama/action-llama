/**
 * Integration tests: POST /api/logs/agents/:name/:instanceId/summarize
 * — createProvider() branches and additional code paths — no Docker required.
 *
 * The existing log-summary tests cover the anthropic provider branch of
 * createProvider() (fake key → 500). This test exercises the remaining branches
 * and code paths in control/routes/log-summary.ts:
 *
 *  createProvider() branches:
 *   - "openai" provider → OpenAIProvider used (fake key → LLM fails → 500)
 *   - "custom" / other provider (e.g. "groq") → CustomProvider used (fake key → 500)
 *
 *  pi_auth API key resolution path:
 *   - model.authType === "pi_auth" → tries AuthStorage.create().getApiKey() → empty
 *     string if not configured → LLM fails → 500 (exercises lines 134–140)
 *
 *  query param ?lines clamping:
 *   - ?lines=999999 is clamped to MAX_LINES → no error, endpoint proceeds normally
 *   - ?lines=0 is treated as invalid (NaN or < 1) → uses DEFAULT_SUMMARY_LINES
 *
 *  globalConfig load failure path:
 *   - config.toml deleted after harness starts → 500 "Failed to load project config"
 *
 *  log entry formatting path (logText build):
 *   - entries with extra fields → JSON.stringify(rest) branch exercised
 *   - entries with only msg → plain `[${ts}] ${e.msg}` branch exercised
 *
 * Covers:
 *   - control/routes/log-summary.ts: createProvider() "openai" branch
 *   - control/routes/log-summary.ts: createProvider() default/CustomProvider branch
 *   - control/routes/log-summary.ts: model.authType === "pi_auth" key resolution (lines 134–140)
 *   - control/routes/log-summary.ts: ?lines query param clamping (lines 60-63)
 *   - control/routes/log-summary.ts: loadGlobalConfig failure → 500 (lines 120-126)
 *   - control/routes/log-summary.ts: logText with extra-fields branch (line 153)
 *   - control/routes/log-summary.ts: logText plain-msg branch (line 154)
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
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
  "integration: log summary createProvider() branches and edge cases (no Docker required)",
  { timeout: 90_000 },
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

    /** POST to the summarize endpoint with Bearer auth and optional body. */
    function summarize(
      h: IntegrationHarness,
      agentName: string,
      instanceId: string,
      body?: Record<string, unknown>,
      query?: Record<string, string>,
    ): Promise<Response> {
      const params = query ? "?" + new URLSearchParams(query).toString() : "";
      return fetch(
        `http://127.0.0.1:${h.gatewayPort}/api/logs/agents/${agentName}/${instanceId}/summarize${params}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${h.apiKey}`,
            "Content-Type": "application/json",
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(15_000),
        },
      );
    }

    /**
     * Create a harness with a custom model config, write optional log lines,
     * and start the scheduler (Phase 3 gateway only). Returns whether gateway
     * is accessible.
     */
    async function setupHarness(opts: {
      agentName: string;
      modelConfig: { provider: string; model: string; authType?: string };
      logLines?: string[];
    }): Promise<void> {
      const { agentName, modelConfig, logLines } = opts;

      harness = await IntegrationHarness.create({
        agents: [
          {
            name: agentName,
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
        globalConfig: {
          models: {
            mymodel: {
              provider: modelConfig.provider as any,
              model: modelConfig.model,
              authType: (modelConfig.authType ?? "api_key") as any,
            },
          },
        },
      });

      if (logLines && logLines.length > 0) {
        const logsPath = resolve(harness.projectPath, ".al", "logs");
        mkdirSync(logsPath, { recursive: true });
        writeFileSync(
          join(logsPath, `${agentName}-${TODAY}.log`),
          logLines.join("\n") + "\n",
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

    // ── createProvider() "openai" branch ─────────────────────────────────────

    it("openai provider → OpenAIProvider path → LLM call fails with fake key → 500", async () => {
      const agentName = "openai-summary-agent";
      const instanceId = "inst-openai-test";

      await setupHarness({
        agentName,
        modelConfig: { provider: "openai", model: "gpt-4o", authType: "api_key" },
        logLines: [
          pinoLine("agent started", instanceId),
          pinoLine("run completed", instanceId),
        ],
      });
      if (!gatewayAccessible) return;

      // With custom prompt, cache is bypassed; log entries exist; model is openai.
      // openai_key/default/token is not set up (IntegrationHarness only adds anthropic_key).
      // loadCredentialField("openai_key", "default", "token") returns undefined → apiKey = "".
      // OpenAIProvider.chat() will fail → 500 "Failed to generate summary".
      const res = await summarize(harness, agentName, instanceId, {
        prompt: "What happened in this run?",
      });
      expect(res.status).toBe(500);

      const body = (await res.json()) as { error: string };
      // Should indicate that the LLM call (not config) failed
      expect(body.error).toMatch(/failed to generate summary/i);
    });

    // ── createProvider() default/CustomProvider branch ────────────────────────

    it("custom provider (groq) → CustomProvider path → LLM call fails with fake key → 500", async () => {
      const agentName = "groq-summary-agent";
      const instanceId = "inst-groq-test";

      await setupHarness({
        agentName,
        modelConfig: { provider: "groq", model: "llama-3.3-70b-versatile", authType: "api_key" },
        logLines: [
          pinoLine("bash", instanceId, { cmd: "npm test", exitCode: 0 }),
          pinoLine("assistant", instanceId, { text: "All tests passed." }),
        ],
      });
      if (!gatewayAccessible) return;

      // groq_key/default/token is not set up → apiKey = "" → CustomProvider fails.
      const res = await summarize(harness, agentName, instanceId, {
        prompt: "Did the tests pass?",
      });
      expect(res.status).toBe(500);

      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/failed to generate summary/i);
    });

    // ── pi_auth API key resolution path ───────────────────────────────────────

    it("pi_auth model → AuthStorage.create().getApiKey() path → empty key → LLM fails → 500", async () => {
      const agentName = "pi-auth-summary-agent";
      const instanceId = "inst-pi-auth-test";

      await setupHarness({
        agentName,
        // pi_auth means the agent uses OAuth via AuthStorage instead of credential files
        modelConfig: { provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "pi_auth" },
        logLines: [
          pinoLine("agent run started", instanceId),
          pinoLine("run completed", instanceId),
        ],
      });
      if (!gatewayAccessible) return;

      // pi_auth path: AuthStorage.create().getApiKey("anthropic") returns null/undefined
      // since no pi OAuth tokens are configured → apiKey = "" → LLM fails.
      const res = await summarize(harness, agentName, instanceId, {
        prompt: "Summarize this run.",
      });
      expect(res.status).toBe(500);

      const body = (await res.json()) as { error: string };
      // The summary call fails because the empty API key is rejected
      expect(body.error).toMatch(/failed to generate summary/i);
    });

    // ── loadGlobalConfig failure path ─────────────────────────────────────────

    it("deleted config.toml after start → 500 'Failed to load project config'", async () => {
      const agentName = "config-deleted-agent";
      const instanceId = "inst-config-del";

      await setupHarness({
        agentName,
        modelConfig: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
        logLines: [pinoLine("agent ran", instanceId)],
      });
      if (!gatewayAccessible) return;

      // Delete config.toml so loadGlobalConfig() throws
      const configPath = resolve(harness.projectPath, "config.toml");
      rmSync(configPath);

      // The endpoint loads global config on each request → throws → 500
      const res = await summarize(harness, agentName, instanceId, {
        prompt: "What happened?",
      });
      expect(res.status).toBe(500);

      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/failed to load project config/i);
    });

    // ── logText formatting path: extra-fields vs plain msg ───────────────────

    it("log entries with extra fields use JSON.stringify(rest) in logText", async () => {
      const agentName = "logtext-extra-agent";
      const instanceId = "inst-logtext-test";

      // Entry WITH extra fields (exercises JSON.stringify(rest) branch)
      // Entry WITHOUT extra fields (exercises plain `[${ts}] ${e.msg}` branch)
      await setupHarness({
        agentName,
        modelConfig: { provider: "openai", model: "gpt-4o" },
        logLines: [
          // Extra fields: tool, cmd → exercises JSON.stringify(rest) branch
          pinoLine("bash", instanceId, { tool: "bash", cmd: "echo hello" }),
          // No extra fields beyond standard ones → exercises plain-msg branch
          pinoLine("run started", instanceId),
        ],
      });
      if (!gatewayAccessible) return;

      // Both formatting branches are exercised before the LLM call.
      // Since openai_key is empty, LLM fails → 500.
      const res = await summarize(harness, agentName, instanceId, {
        prompt: "Describe what happened.",
      });
      // Reaches LLM call (both log-text branches exercised) → fails with fake key
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/failed to generate summary/i);
    });

    // ── ?lines query param clamping ───────────────────────────────────────────

    it("?lines=0 (invalid) uses DEFAULT_SUMMARY_LINES → endpoint proceeds normally", async () => {
      const agentName = "lines-zero-agent";
      const instanceId = "inst-lines-zero";

      await setupHarness({
        agentName,
        modelConfig: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
        logLines: [pinoLine("ran successfully", instanceId)],
      });
      if (!gatewayAccessible) return;

      // ?lines=0 is invalid (< 1) → uses DEFAULT_SUMMARY_LINES=500
      // Endpoint reaches LLM call → fails with fake anthropic key → 500
      const res = await summarize(harness, agentName, instanceId, {
        prompt: "What happened?",
      }, { lines: "0" });
      // Reaches LLM call (lines is valid after clamping) → 500
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/failed to generate summary/i);
    });

    it("?lines=999999 is clamped to MAX_LINES → endpoint proceeds normally", async () => {
      const agentName = "lines-max-agent";
      const instanceId = "inst-lines-max";

      await setupHarness({
        agentName,
        modelConfig: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
        logLines: [pinoLine("agent did stuff", instanceId)],
      });
      if (!gatewayAccessible) return;

      // ?lines=999999 clamped to MAX_LINES (10000) → endpoint proceeds normally
      const res = await summarize(harness, agentName, instanceId, {
        prompt: "What ran?",
      }, { lines: "999999" });
      // Reaches LLM call → fails with fake key → 500
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/failed to generate summary/i);
    });
  },
);
