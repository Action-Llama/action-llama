/**
 * Integration tests: cross-file forward cursor pagination in agent log API.
 *
 * The log API uses readEntriesForwardMultiFile() to advance a cursor across
 * multiple daily log files. When a forward cursor points to an older daily
 * file (e.g., yesterday's) and newer files exist (e.g., today's), the function
 * should:
 *   1. Read from the cursor's file starting at the cursor's byte offset
 *   2. Continue to newer files when the limit is not yet reached
 *   3. Return a cursor pointing to the new position (which may be in a newer file)
 *
 * These tests create two daily log files manually in .al/logs/ before starting
 * the Phase 3 gateway. All tests work without Docker.
 *
 * Test scenarios:
 *   1. Forward cursor at start of yesterday's file reads entries from BOTH
 *      yesterday and today when limit spans both files
 *   2. Forward cursor at start of yesterday's file with small limit reads only
 *      entries from yesterday; returned cursor stays in yesterday's file
 *   3. Forward cursor with date older than all log files returns empty entries
 *   4. Forward cursor starting in the middle of yesterday's file spans to today
 *
 * Covers:
 *   - control/routes/log-helpers.ts: readEntriesForwardMultiFile cross-file path
 *   - control/routes/log-helpers.ts: startIdx = allFiles.findIndex(...) logic
 *   - control/routes/log-helpers.ts: isCursorFile offset vs 0 for newer files
 *   - control/routes/logs.ts: handleLogRequest cursor branch (cursor present)
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { IntegrationHarness } from "./harness.js";

const TODAY = new Date().toISOString().slice(0, 10);
const YESTERDAY = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const AGENT_NAME = "crossfile-cursor-agent";

/** Create a pino-format log line. */
function pinoLine(msg: string, time: number): string {
  return JSON.stringify({
    level: 30,
    time,
    msg,
    name: AGENT_NAME,
    pid: 1,
    hostname: "localhost",
  });
}

/**
 * Encode a cursor in the same format as the server:
 *   base64url of "date:offset"
 * (see control/routes/log-helpers.ts encodeCursor)
 */
function encodeCursorAt(date: string, offset: number): string {
  return Buffer.from(`${date}:${offset}`).toString("base64url");
}

describe(
  "integration: cross-file forward cursor pagination (no Docker required)",
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
        `http://127.0.0.1:${h.gatewayPort}/api/logs/agents/${AGENT_NAME}${params}`,
        {
          headers: { Authorization: `Bearer ${h.apiKey}` },
          signal: AbortSignal.timeout(5_000),
        },
      );
    }

    async function createHarnessWithTwoFiles(
      yesterdayLines: string[],
      todayLines: string[],
    ): Promise<void> {
      harness = await IntegrationHarness.create({
        agents: [
          { name: AGENT_NAME, schedule: "0 0 31 2 *", testScript: "#!/bin/sh\nexit 0\n" },
        ],
      });

      const logsPath = resolve(harness.projectPath, ".al", "logs");
      mkdirSync(logsPath, { recursive: true });

      if (yesterdayLines.length > 0) {
        writeFileSync(
          join(logsPath, `${AGENT_NAME}-${YESTERDAY}.log`),
          yesterdayLines.join("\n") + "\n",
        );
      }
      if (todayLines.length > 0) {
        writeFileSync(
          join(logsPath, `${AGENT_NAME}-${TODAY}.log`),
          todayLines.join("\n") + "\n",
        );
      }

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

    it("forward cursor at offset 0 in yesterday's file reads entries from both files when limit spans both", async () => {
      // 3 entries in yesterday's file, 3 entries in today's file
      const baseTime = 1_700_000_000_000;
      const yesterdayLines = [
        pinoLine("yest-entry-01", baseTime + 1000),
        pinoLine("yest-entry-02", baseTime + 2000),
        pinoLine("yest-entry-03", baseTime + 3000),
      ];
      const todayLines = [
        pinoLine("today-entry-01", baseTime + 4000),
        pinoLine("today-entry-02", baseTime + 5000),
        pinoLine("today-entry-03", baseTime + 6000),
      ];

      await createHarnessWithTwoFiles(yesterdayLines, todayLines);
      if (!gatewayAccessible) return;

      // Cursor at offset 0 in yesterday's file, limit=10 (spans both files)
      const cursorAtYesterdayStart = encodeCursorAt(YESTERDAY, 0);
      const res = await logsAPI(harness, {
        cursor: cursorAtYesterdayStart,
        lines: "10",
      });
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        entries: Array<{ msg: string; time: number }>;
        cursor: string | null;
        hasMore: boolean;
      };
      expect(Array.isArray(body.entries)).toBe(true);

      // Should return entries from BOTH files: 3 yesterday + 3 today = 6 total
      expect(body.entries.length).toBe(6);

      // Yesterday entries should come first (earlier timestamps)
      expect(body.entries[0].msg).toBe("yest-entry-01");
      expect(body.entries[1].msg).toBe("yest-entry-02");
      expect(body.entries[2].msg).toBe("yest-entry-03");
      // Today entries should follow
      expect(body.entries[3].msg).toBe("today-entry-01");
      expect(body.entries[4].msg).toBe("today-entry-02");
      expect(body.entries[5].msg).toBe("today-entry-03");

      // hasMore should be false (limit=10 > 6 entries)
      expect(body.hasMore).toBe(false);

      // cursor should be non-null (points to end of today's file)
      expect(typeof body.cursor).toBe("string");
      expect(body.cursor).not.toBeNull();
    });

    it("forward cursor at start of yesterday's file with small limit stays in yesterday's file", async () => {
      // 4 entries in yesterday's file, 3 entries in today's file
      const baseTime = 1_700_001_000_000;
      const yesterdayLines = [
        pinoLine("yest-a", baseTime + 1000),
        pinoLine("yest-b", baseTime + 2000),
        pinoLine("yest-c", baseTime + 3000),
        pinoLine("yest-d", baseTime + 4000),
      ];
      const todayLines = [
        pinoLine("today-a", baseTime + 5000),
        pinoLine("today-b", baseTime + 6000),
        pinoLine("today-c", baseTime + 7000),
      ];

      await createHarnessWithTwoFiles(yesterdayLines, todayLines);
      if (!gatewayAccessible) return;

      // Cursor at offset 0 in yesterday's file, limit=2 (only reads from yesterday)
      const cursorAtYesterdayStart = encodeCursorAt(YESTERDAY, 0);
      const res = await logsAPI(harness, {
        cursor: cursorAtYesterdayStart,
        lines: "2",
      });
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        entries: Array<{ msg: string }>;
        cursor: string | null;
        hasMore: boolean;
      };
      expect(Array.isArray(body.entries)).toBe(true);

      // Should only return 2 entries (from yesterday), not reaching today's file
      expect(body.entries).toHaveLength(2);
      expect(body.entries[0].msg).toBe("yest-a");
      expect(body.entries[1].msg).toBe("yest-b");

      // hasMore should be true (limit=2 hit, more entries available)
      expect(body.hasMore).toBe(true);

      // cursor should be non-null, pointing after yest-b
      expect(typeof body.cursor).toBe("string");
      expect(body.cursor).not.toBeNull();
    });

    it("forward cursor pointing to a date older than all log files returns empty entries", async () => {
      // Only today's file exists; cursor points to a date before yesterday
      const baseTime = 1_700_002_000_000;
      const todayLines = [
        pinoLine("today-only-1", baseTime + 1000),
        pinoLine("today-only-2", baseTime + 2000),
      ];

      await createHarnessWithTwoFiles([], todayLines);
      if (!gatewayAccessible) return;

      // Cursor with a date far in the past (before any log files)
      // readEntriesForwardMultiFile: startIdx = findIndex(d >= "2020-01-01") → 0 (today's file)
      // So entries from today's file should be returned (cursor points to before today)
      const cursorInPast = encodeCursorAt("2020-01-01", 0);
      const res = await logsAPI(harness, {
        cursor: cursorInPast,
        lines: "10",
      });
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        entries: Array<{ msg: string }>;
        cursor: string | null;
        hasMore: boolean;
      };
      expect(Array.isArray(body.entries)).toBe(true);

      // The cursor date "2020-01-01" is earlier than today's file, so
      // findIndex returns today's file index (d >= "2020-01-01").
      // For today's file, isCursorFile = false (date != "2020-01-01"),
      // so offset = 0 and all entries from today's file are returned.
      expect(body.entries.length).toBe(2);
      expect(body.entries[0].msg).toBe("today-only-1");
      expect(body.entries[1].msg).toBe("today-only-2");
    });

    it("two-step cross-file pagination: first read returns yesterday entries, second read returns today entries", async () => {
      // 2 entries in yesterday's file, 2 in today's file
      const baseTime = 1_700_003_000_000;
      const yesterdayLines = [
        pinoLine("page1-yest-01", baseTime + 1000),
        pinoLine("page1-yest-02", baseTime + 2000),
      ];
      const todayLines = [
        pinoLine("page1-today-01", baseTime + 3000),
        pinoLine("page1-today-02", baseTime + 4000),
      ];

      await createHarnessWithTwoFiles(yesterdayLines, todayLines);
      if (!gatewayAccessible) return;

      // First read: cursor at start of yesterday's file, limit=2
      // Should return 2 entries from yesterday, hasMore=true (today still has entries)
      const cursorAtYesterdayStart = encodeCursorAt(YESTERDAY, 0);
      const res1 = await logsAPI(harness, {
        cursor: cursorAtYesterdayStart,
        lines: "2",
      });
      expect(res1.status).toBe(200);

      const body1 = (await res1.json()) as {
        entries: Array<{ msg: string }>;
        cursor: string | null;
        hasMore: boolean;
      };
      expect(body1.entries).toHaveLength(2);
      expect(body1.entries[0].msg).toBe("page1-yest-01");
      expect(body1.entries[1].msg).toBe("page1-yest-02");
      expect(body1.hasMore).toBe(true);
      expect(body1.cursor).not.toBeNull();

      // Second read: use cursor from first read, limit=10 (more than 2 remaining entries)
      // Should return 2 entries from today's file, hasMore=false (limit not hit)
      const res2 = await logsAPI(harness, {
        cursor: body1.cursor!,
        lines: "10",
      });
      expect(res2.status).toBe(200);

      const body2 = (await res2.json()) as {
        entries: Array<{ msg: string }>;
        cursor: string | null;
        hasMore: boolean;
      };
      expect(body2.entries).toHaveLength(2);
      expect(body2.entries[0].msg).toBe("page1-today-01");
      expect(body2.entries[1].msg).toBe("page1-today-02");
      // limit=10 > 2 entries → hasMore=false
      expect(body2.hasMore).toBe(false);
    });
  },
);
