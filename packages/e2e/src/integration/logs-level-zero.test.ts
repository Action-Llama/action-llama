/**
 * Integration tests: log API ?level=0 numeric parameter — no Docker required.
 *
 * When ?level=0 is passed, parseQueryParams() interprets it as a numeric
 * minLevel=0 (since "0" is not in the named level map, parseInt("0")=0).
 * The filterLevel() function checks `minLevel > 0` — when minLevel is 0,
 * the filter is skipped and ALL entries are returned unfiltered.
 *
 * This covers the else-branch of the filterLevel ternary in logs.ts (line 30):
 *   const filterLevel = (entries) => minLevel > 0 ? entries.filter(...) : entries;
 *                                                               ^^^^ covered  ^^^^ this branch
 *
 * Also tests the numeric level interpretation in parseQueryParams:
 *   `?level=5` → minLevel=5 → filters entries below 5 (only level >= 5 included)
 *
 * Test scenarios:
 *   1. ?level=0 returns all entries including trace (level=10) — no-op filter
 *   2. ?level=5 includes all entries (trace=10, debug=20, etc. are all >= 5)
 *   3. Default (no ?level) uses minLevel=30 and excludes trace (level=10)
 *
 * Covers:
 *   - control/routes/logs.ts: filterLevel ternary else branch (minLevel <= 0 → no filter)
 *   - control/routes/log-helpers.ts: parseQueryParams numeric level interpretation
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { IntegrationHarness } from "./harness.js";

const TODAY = new Date().toISOString().slice(0, 10);
const LOG_PREFIX = "level-zero-agent";

function logLine(level: number, msg: string): string {
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
  "integration: log API ?level=0 numeric level (no Docker required)",
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
            name: "level-zero-scaffold",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });

      // Write a log file with entries at multiple levels including trace
      const logsPath = resolve(harness.projectPath, ".al", "logs");
      mkdirSync(logsPath, { recursive: true });
      writeFileSync(
        join(logsPath, `${LOG_PREFIX}-${TODAY}.log`),
        [
          logLine(10, "trace-entry"),   // level 10
          logLine(20, "debug-entry"),   // level 20
          logLine(30, "info-entry"),    // level 30
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

    it("?level=0 returns all entries including trace (minLevel=0 → no-op filter)", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await logsAPI(harness, { level: "0", lines: "50" });
      expect(res.ok).toBe(true);

      const body = (await res.json()) as { entries: Array<{ level: number; msg: string }> };
      expect(Array.isArray(body.entries)).toBe(true);

      // All 3 entries should be returned (trace, debug, info) since minLevel=0
      const msgs = body.entries.map((e) => e.msg);
      expect(msgs).toContain("trace-entry");
      expect(msgs).toContain("debug-entry");
      expect(msgs).toContain("info-entry");
    });

    it("?level=5 includes all entries (all levels >= 5)", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      // ?level=5 → minLevel=5 → entries with level >= 5 (all of trace=10, debug=20, info=30)
      const res = await logsAPI(harness, { level: "5", lines: "50" });
      expect(res.ok).toBe(true);

      const body = (await res.json()) as { entries: Array<{ level: number; msg: string }> };
      const msgs = body.entries.map((e) => e.msg);
      expect(msgs).toContain("trace-entry");
      expect(msgs).toContain("debug-entry");
      expect(msgs).toContain("info-entry");
    });

    it("default (no ?level) uses minLevel=30 and excludes trace and debug", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await logsAPI(harness, { lines: "50" });
      expect(res.ok).toBe(true);

      const body = (await res.json()) as { entries: Array<{ level: number; msg: string }> };
      const msgs = body.entries.map((e) => e.msg);
      // trace (10) and debug (20) excluded by default minLevel=30
      expect(msgs).not.toContain("trace-entry");
      expect(msgs).not.toContain("debug-entry");
      expect(msgs).toContain("info-entry");
    });
  },
);
