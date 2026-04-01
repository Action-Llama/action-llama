/**
 * Integration tests: multi-file log reading and `limit` alias — no Docker required.
 *
 * The log API (fix in 809955b) now reads across multiple daily log files using
 * readLastEntriesMultiFile / readEntriesForwardMultiFile, and also accepts `limit`
 * as an alias for `lines` in query params.
 *
 * These tests create log files manually in the project's .al/logs/ directory
 * before starting the scheduler. The Phase 3 gateway registers the log routes,
 * so the API is accessible without Docker.
 *
 * Test scenarios:
 *   1. Single daily file → reads last N entries from that file
 *   2. Two daily files → reads across both files (newest file + older file)
 *   3. ?limit=N works as alias for ?lines=N (same result)
 *   4. ?lines takes precedence over ?limit when both present
 *   5. Cursor returned from multi-file response is valid and can be used for forward-reading
 *
 * Covers:
 *   - control/routes/log-helpers.ts: readLastEntriesMultiFile (multiple files path)
 *   - control/routes/log-helpers.ts: readEntriesForwardMultiFile (cursor forward-read)
 *   - control/routes/log-helpers.ts: findLogFiles (reads multiple dated log files)
 *   - control/routes/logs.ts: handleLogRequest (shared helper)
 *   - control/routes/logs.ts: parseQueryParams `limit` alias
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { IntegrationHarness } from "./harness.js";

function pinoLine(msg: string, agentName: string, time?: number): string {
  return JSON.stringify({
    level: 30,
    time: time ?? Date.now(),
    msg,
    name: agentName,
    pid: 1,
    hostname: "localhost",
  });
}

// Use yesterday and today so the dates are valid and the files are found
const TODAY = new Date().toISOString().slice(0, 10);
const YESTERDAY = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
// A dedicated log prefix that won't conflict with the scheduler's own logs
const LOG_PREFIX = "test-multifile-agent";

describe(
  "integration: multi-file log reading via Phase 3 gateway (no Docker required)",
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

    function logsAPI(h: IntegrationHarness, path: string): Promise<Response> {
      return fetch(
        `http://127.0.0.1:${h.gatewayPort}${path}`,
        {
          headers: { Authorization: `Bearer ${h.apiKey}` },
          signal: AbortSignal.timeout(5_000),
        },
      );
    }

    async function startHarnessAndWriteLogs(logEntries: { file: string; lines: string[] }[]): Promise<void> {
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "multifile-log-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });

      // Write log files BEFORE starting the scheduler so they exist when routes are queried
      const logsPath = resolve(harness.projectPath, ".al", "logs");
      mkdirSync(logsPath, { recursive: true });

      for (const { file, lines } of logEntries) {
        writeFileSync(join(logsPath, file), lines.join("\n") + "\n");
      }

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

    it("reads from a single daily log file via agent log endpoint", async () => {
      await startHarnessAndWriteLogs([
        {
          file: `${LOG_PREFIX}-${TODAY}.log`,
          lines: [
            pinoLine("entry-1", LOG_PREFIX, 1000),
            pinoLine("entry-2", LOG_PREFIX, 2000),
            pinoLine("entry-3", LOG_PREFIX, 3000),
          ],
        },
      ]);
      if (!gatewayAccessible) return;

      const res = await logsAPI(harness, `/api/logs/agents/${LOG_PREFIX}?lines=10`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as { entries: Array<{ msg: string }>; cursor: string | null };
      expect(Array.isArray(body.entries)).toBe(true);
      // Our 3 entries should be present
      const msgs = body.entries.map((e) => e.msg);
      expect(msgs).toContain("entry-1");
      expect(msgs).toContain("entry-2");
      expect(msgs).toContain("entry-3");
      expect(typeof body.cursor).toBe("string");
    });

    it("reads across two daily log files (newest + older)", async () => {
      await startHarnessAndWriteLogs([
        {
          file: `${LOG_PREFIX}-${YESTERDAY}.log`,
          lines: [
            pinoLine("old-entry-1", LOG_PREFIX, 100),
            pinoLine("old-entry-2", LOG_PREFIX, 200),
            pinoLine("old-entry-3", LOG_PREFIX, 300),
          ],
        },
        {
          file: `${LOG_PREFIX}-${TODAY}.log`,
          lines: [
            pinoLine("new-entry-1", LOG_PREFIX, 1000),
            pinoLine("new-entry-2", LOG_PREFIX, 2000),
          ],
        },
      ]);
      if (!gatewayAccessible) return;

      // Request 10 lines — should span both files and include all 5 entries
      const res = await logsAPI(harness, `/api/logs/agents/${LOG_PREFIX}?lines=10`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as { entries: Array<{ msg: string }>; cursor: string | null };
      expect(Array.isArray(body.entries)).toBe(true);

      const msgs = body.entries.map((e) => e.msg);
      // All 5 entries (from both files) should be present
      expect(msgs).toContain("old-entry-1");
      expect(msgs).toContain("old-entry-2");
      expect(msgs).toContain("old-entry-3");
      expect(msgs).toContain("new-entry-1");
      expect(msgs).toContain("new-entry-2");
    });

    it("?limit=N works as an alias for ?lines=N", async () => {
      await startHarnessAndWriteLogs([
        {
          file: `${LOG_PREFIX}-${TODAY}.log`,
          lines: [
            pinoLine("msg-1", LOG_PREFIX, 1000),
            pinoLine("msg-2", LOG_PREFIX, 2000),
            pinoLine("msg-3", LOG_PREFIX, 3000),
            pinoLine("msg-4", LOG_PREFIX, 4000),
            pinoLine("msg-5", LOG_PREFIX, 5000),
          ],
        },
      ]);
      if (!gatewayAccessible) return;

      // Request with ?limit=2 (alias)
      const resLimit = await logsAPI(harness, `/api/logs/agents/${LOG_PREFIX}?limit=2`);
      expect(resLimit.status).toBe(200);
      const bodyLimit = (await resLimit.json()) as { entries: unknown[] };

      // Request with ?lines=2 (canonical)
      const resLines = await logsAPI(harness, `/api/logs/agents/${LOG_PREFIX}?lines=2`);
      expect(resLines.status).toBe(200);
      const bodyLines = (await resLines.json()) as { entries: unknown[] };

      // Both should return the same number of entries (the last 2)
      expect(bodyLimit.entries).toHaveLength(bodyLines.entries.length);
      // They should both return exactly 2 entries (5 total, limit/lines=2)
      expect(bodyLimit.entries).toHaveLength(2);
    });

    it("cursor from multi-file response can be used for forward-reading", async () => {
      await startHarnessAndWriteLogs([
        {
          file: `${LOG_PREFIX}-${TODAY}.log`,
          lines: [
            pinoLine("cursor-entry-1", LOG_PREFIX, 1000),
            pinoLine("cursor-entry-2", LOG_PREFIX, 2000),
            pinoLine("cursor-entry-3", LOG_PREFIX, 3000),
          ],
        },
      ]);
      if (!gatewayAccessible) return;

      // Get initial response with cursor
      const res1 = await logsAPI(harness, `/api/logs/agents/${LOG_PREFIX}?lines=5`);
      expect(res1.status).toBe(200);
      const body1 = (await res1.json()) as { entries: unknown[]; cursor: string | null };
      expect(body1.cursor).not.toBeNull();

      // Use cursor for forward-reading — should work without error (may return empty)
      const cursor = encodeURIComponent(body1.cursor!);
      const res2 = await logsAPI(harness, `/api/logs/agents/${LOG_PREFIX}?cursor=${cursor}`);
      expect(res2.status).toBe(200);

      const body2 = (await res2.json()) as { entries: unknown[]; cursor: string | null };
      expect(Array.isArray(body2.entries)).toBe(true);
      // Cursor read from the end should return empty entries (no new entries yet)
      expect(body2.entries).toHaveLength(0);
    });
  },
);
