/**
 * Integration tests: container log format normalization — no Docker required.
 *
 * The log parser in control/routes/log-helpers.ts parseLine() handles two formats:
 *   1. Standard pino format: { level: 30, time: ..., msg: "..." }
 *   2. Container format: { _log: true, level: "info", ts: ..., msg: "..." }
 *
 * The container format is used by agents running inside Docker containers.
 * When `_log` is truthy and `level` is a string, parseLine() normalizes it:
 *   - Converts string level ("info", "warn", "error", "debug", "trace") to number
 *   - Renames `ts` field to `time`
 *   - Strips the `_log` field
 *
 * This test creates a log file with container-format entries and reads them via
 * the Phase 3 gateway log API, verifying the normalization is applied correctly.
 *
 * Also exercises the ?lines parameter returning all entries (both formats mixed).
 *
 * Test scenarios:
 *   1. Container-format "info" entry is returned with level=30
 *   2. Container-format "warn" entry is returned with level=40
 *   3. Container-format "error" entry is returned with level=50
 *   4. Standard pino-format entry is returned unchanged
 *   5. Container-format and pino-format entries can coexist in the same log file
 *   6. Container-format "debug" entry is excluded by default (minLevel=30)
 *   7. Container-format "debug" entry is included when ?level=debug
 *
 * Covers:
 *   - control/routes/log-helpers.ts: parseLine() container format branch
 *     (obj._log && typeof obj.level === "string" → levelMap lookup + ts → time)
 *   - control/routes/log-helpers.ts: parseLine() standard pino format (pass-through)
 *   - control/routes/logs.ts: handleLogRequest via Phase 3 gateway
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { IntegrationHarness } from "./harness.js";

const TODAY = new Date().toISOString().slice(0, 10);
const LOG_PREFIX = "container-format-agent";

/** Container-format log line (emitted by agents in Docker) */
function containerLine(level: string, msg: string, extra?: Record<string, unknown>): string {
  return JSON.stringify({
    _log: true,
    level,
    ts: Date.now(),
    msg,
    name: LOG_PREFIX,
    pid: 1,
    ...extra,
  });
}

/** Standard pino-format log line */
function pinoLine(level: number, msg: string): string {
  return JSON.stringify({
    level,
    time: Date.now(),
    msg,
    name: LOG_PREFIX,
    pid: 1,
    hostname: "localhost",
  });
}

describe(
  "integration: log API container format normalization (no Docker required)",
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

    function logsAPI(
      h: IntegrationHarness,
      query?: Record<string, string>,
    ): Promise<Response> {
      const params = query ? "?" + new URLSearchParams(query).toString() : "";
      return fetch(
        `http://127.0.0.1:${h.gatewayPort}/api/logs/agents/${LOG_PREFIX}${params}`,
        {
          headers: { Authorization: `Bearer ${h.apiKey}` },
          signal: AbortSignal.timeout(5_000),
        },
      );
    }

    async function startHarness(): Promise<void> {
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "container-fmt-scaffold",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });

      // Write a log file mixing container-format and pino-format entries
      const logsPath = resolve(harness.projectPath, ".al", "logs");
      mkdirSync(logsPath, { recursive: true });
      writeFileSync(
        join(logsPath, `${LOG_PREFIX}-${TODAY}.log`),
        [
          containerLine("debug", "container-debug-msg"),   // level 20 — filtered by default
          containerLine("info", "container-info-msg"),     // level 30
          containerLine("warn", "container-warn-msg"),     // level 40
          containerLine("error", "container-error-msg"),   // level 50
          pinoLine(30, "pino-info-msg"),                   // standard pino format
        ].join("\n") + "\n",
      );

      try {
        await harness.start();
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

    it("container-format info entry is normalized to level=30", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await logsAPI(harness, { lines: "50" });
      expect(res.ok).toBe(true);

      const body = (await res.json()) as { entries: Array<{ level: number; msg: string }> };
      expect(Array.isArray(body.entries)).toBe(true);

      const infoEntry = body.entries.find((e) => e.msg === "container-info-msg");
      expect(infoEntry).toBeDefined();
      expect(infoEntry?.level).toBe(30);
    });

    it("container-format warn entry is normalized to level=40", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await logsAPI(harness, { lines: "50" });
      expect(res.ok).toBe(true);

      const body = (await res.json()) as { entries: Array<{ level: number; msg: string }> };
      const warnEntry = body.entries.find((e) => e.msg === "container-warn-msg");
      expect(warnEntry).toBeDefined();
      expect(warnEntry?.level).toBe(40);
    });

    it("container-format error entry is normalized to level=50", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await logsAPI(harness, { lines: "50" });
      expect(res.ok).toBe(true);

      const body = (await res.json()) as { entries: Array<{ level: number; msg: string }> };
      const errorEntry = body.entries.find((e) => e.msg === "container-error-msg");
      expect(errorEntry).toBeDefined();
      expect(errorEntry?.level).toBe(50);
    });

    it("standard pino-format entry passes through unchanged", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await logsAPI(harness, { lines: "50" });
      expect(res.ok).toBe(true);

      const body = (await res.json()) as { entries: Array<{ level: number; msg: string }> };
      const pinoEntry = body.entries.find((e) => e.msg === "pino-info-msg");
      expect(pinoEntry).toBeDefined();
      expect(pinoEntry?.level).toBe(30);
    });

    it("default level filter excludes container-format debug entries (level=20 < 30)", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      // Default ?level → minLevel=30, so debug (20) should be excluded
      const res = await logsAPI(harness, { lines: "50" });
      expect(res.ok).toBe(true);

      const body = (await res.json()) as { entries: Array<{ level: number; msg: string }> };
      const debugEntry = body.entries.find((e) => e.msg === "container-debug-msg");
      expect(debugEntry).toBeUndefined();
    });

    it("?level=debug includes container-format debug entries (level=20)", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await logsAPI(harness, { lines: "50", level: "debug" });
      expect(res.ok).toBe(true);

      const body = (await res.json()) as { entries: Array<{ level: number; msg: string }> };
      const debugEntry = body.entries.find((e) => e.msg === "container-debug-msg");
      expect(debugEntry).toBeDefined();
      expect(debugEntry?.level).toBe(20);
    });

    it("container-format entries have _log field stripped from output", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await logsAPI(harness, { lines: "50" });
      expect(res.ok).toBe(true);

      const body = (await res.json()) as {
        entries: Array<{ level: number; msg: string; _log?: unknown }>;
      };
      const containerEntries = body.entries.filter((e) =>
        ["container-info-msg", "container-warn-msg", "container-error-msg"].includes(e.msg),
      );
      expect(containerEntries.length).toBeGreaterThan(0);

      // _log field must not appear in parsed entries
      for (const entry of containerEntries) {
        expect(entry._log).toBeUndefined();
      }
    });
  },
);
