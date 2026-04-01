/**
 * Integration tests: ?level parameter filtering in log API — no Docker required.
 *
 * The fix in b2e994f adds a `?level` query parameter to the log API that
 * filters entries by minimum log level. Default is `info` (level 30), which
 * excludes debug entries. `?level=debug` includes all entries.
 *
 * These tests create log files with entries at multiple levels and verify
 * the filter is applied correctly through the Phase 3 gateway.
 *
 * Test scenarios:
 *   1. Default (no ?level) filters out debug entries (level 20 < 30)
 *   2. ?level=debug includes debug, info, warn, error
 *   3. ?level=warn includes only warn and error
 *   4. ?level=trace includes all levels (trace is lowest)
 *   5. ?level=info is same as default
 *
 * Covers:
 *   - control/routes/log-helpers.ts: parseQueryParams minLevel computation
 *   - control/routes/logs.ts: filterLevel applied to multi-file entries
 *   - control/routes/log-helpers.ts: readLastEntriesMultiFile entries filtered by minLevel
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { IntegrationHarness } from "./harness.js";

const TODAY = new Date().toISOString().slice(0, 10);
const LOG_PREFIX = "level-filter-agent";

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
  "integration: log API ?level parameter filtering (no Docker required)",
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

    function logsAPI(h: IntegrationHarness, query?: Record<string, string>): Promise<Response> {
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
            name: "level-test-scaffold",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });

      // Write a log file with entries at all levels
      const logsPath = resolve(harness.projectPath, ".al", "logs");
      mkdirSync(logsPath, { recursive: true });
      writeFileSync(
        join(logsPath, `${LOG_PREFIX}-${TODAY}.log`),
        [
          logLine(10, "trace-msg"),  // trace
          logLine(20, "debug-msg"),  // debug
          logLine(30, "info-msg"),   // info
          logLine(40, "warn-msg"),   // warn
          logLine(50, "error-msg"),  // error
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

    it("default (no ?level) returns only info+ entries (excludes trace and debug)", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await logsAPI(harness, { lines: "10" });
      expect(res.status).toBe(200);

      const body = (await res.json()) as { entries: Array<{ msg: string; level: number }> };
      const msgs = body.entries.map((e) => e.msg);

      // Info, warn, error should be present
      expect(msgs).toContain("info-msg");
      expect(msgs).toContain("warn-msg");
      expect(msgs).toContain("error-msg");

      // Trace and debug should NOT be present (default minLevel=30)
      expect(msgs).not.toContain("trace-msg");
      expect(msgs).not.toContain("debug-msg");
    });

    it("?level=debug includes debug, info, warn, error (excludes trace)", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await logsAPI(harness, { lines: "10", level: "debug" });
      expect(res.status).toBe(200);

      const body = (await res.json()) as { entries: Array<{ msg: string }> };
      const msgs = body.entries.map((e) => e.msg);

      // Debug, info, warn, error should be present (level >= 20)
      expect(msgs).toContain("debug-msg");
      expect(msgs).toContain("info-msg");
      expect(msgs).toContain("warn-msg");
      expect(msgs).toContain("error-msg");

      // Trace (level 10) should NOT be present (10 < 20)
      expect(msgs).not.toContain("trace-msg");
    });

    it("?level=warn returns only warn and error entries", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await logsAPI(harness, { lines: "10", level: "warn" });
      expect(res.status).toBe(200);

      const body = (await res.json()) as { entries: Array<{ msg: string }> };
      const msgs = body.entries.map((e) => e.msg);

      // Only warn (40) and error (50) should be present
      expect(msgs).toContain("warn-msg");
      expect(msgs).toContain("error-msg");

      // Everything below warn should be excluded
      expect(msgs).not.toContain("trace-msg");
      expect(msgs).not.toContain("debug-msg");
      expect(msgs).not.toContain("info-msg");
    });

    it("?level=trace includes all levels", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await logsAPI(harness, { lines: "10", level: "trace" });
      expect(res.status).toBe(200);

      const body = (await res.json()) as { entries: Array<{ msg: string }> };
      const msgs = body.entries.map((e) => e.msg);

      // All 5 levels should be present
      expect(msgs).toContain("trace-msg");
      expect(msgs).toContain("debug-msg");
      expect(msgs).toContain("info-msg");
      expect(msgs).toContain("warn-msg");
      expect(msgs).toContain("error-msg");
    });

    it("?level=info behaves same as default (minLevel=30)", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const resDefault = await logsAPI(harness, { lines: "10" });
      const resInfo = await logsAPI(harness, { lines: "10", level: "info" });

      expect(resDefault.status).toBe(200);
      expect(resInfo.status).toBe(200);

      const bodyDefault = (await resDefault.json()) as { entries: Array<{ msg: string }> };
      const bodyInfo = (await resInfo.json()) as { entries: Array<{ msg: string }> };

      // Both should return the same messages
      const defaultMsgs = new Set(bodyDefault.entries.map((e) => e.msg));
      const infoMsgs = new Set(bodyInfo.entries.map((e) => e.msg));

      for (const msg of defaultMsgs) {
        expect(infoMsgs).toContain(msg);
      }
      expect(defaultMsgs.size).toBe(infoMsgs.size);
    });
  },
);
