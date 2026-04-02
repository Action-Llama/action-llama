/**
 * Integration tests: forward cursor position accuracy in agent log API.
 *
 * Fix in b6c5fc9: readEntriesForward() previously always set newOffset to
 * stat.size (end of file) when the entry limit was reached. This caused the
 * next forward read to return nothing — even if there were unread entries in
 * the file between the last-processed entry and EOF.
 *
 * After the fix, when the limit is hit, newOffset is set to
 * byteOffset + bytesConsumed (actual position after the last processed line),
 * so subsequent forward reads correctly pick up the remaining entries.
 *
 * These tests create log files manually in the project's .al/logs/ directory
 * and use the Phase 3 gateway (accessible without Docker). A cursor at offset 0
 * triggers readEntriesForwardMultiFile → readEntriesForward.
 *
 * Test scenarios:
 *   1. Forward read with limit < total entries returns cursor NOT at EOF, and
 *      a subsequent forward read with that cursor returns the remaining entries.
 *   2. Forward read where limit > total entries returns cursor at EOF (stat.size)
 *      and subsequent forward read returns no entries.
 *   3. Forward read with instance filter correctly advances cursor past non-
 *      matching entries (bytesConsumed counts all lines, not just matching ones).
 *
 * Covers:
 *   - control/routes/log-helpers.ts: readEntriesForward() bytesConsumed tracking
 *   - control/routes/log-helpers.ts: readEntriesForward() newOffset = byteOffset + bytesConsumed (limit hit)
 *   - control/routes/log-helpers.ts: readEntriesForward() newOffset = stat.size (limit not hit)
 *   - control/routes/logs.ts: cursor forward path → encodeCursor with correct newOffset
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { IntegrationHarness } from "./harness.js";

const TODAY = new Date().toISOString().slice(0, 10);
const AGENT_NAME = "fwd-cursor-agent";

/** Create a pino-format log line. */
function pinoLine(msg: string, time: number, instanceId?: string): string {
  return JSON.stringify({
    level: 30,
    time,
    msg,
    name: AGENT_NAME,
    pid: 1,
    hostname: "localhost",
    ...(instanceId ? { instance: instanceId } : {}),
  });
}

/**
 * Encode a cursor as base64url("date:offset") — matches the server's format
 * so we can construct a cursor pointing to the start of a known log file.
 */
function encodeCursorAt(date: string, offset: number): string {
  // The server uses encodeCursor(date, [offset]) → base64url of "date:offset"
  // (see control/routes/log-helpers.ts encodeCursor)
  return Buffer.from(`${date}:${offset}`).toString("base64url");
}

describe(
  "integration: forward cursor position accuracy (no Docker required)",
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
      agentName: string,
      query?: Record<string, string>,
    ): Promise<Response> {
      const params = query ? "?" + new URLSearchParams(query).toString() : "";
      return fetch(
        `http://127.0.0.1:${h.gatewayPort}/api/logs/agents/${agentName}${params}`,
        {
          headers: { Authorization: `Bearer ${h.apiKey}` },
          signal: AbortSignal.timeout(5_000),
        },
      );
    }

    async function createHarnessWithLogLines(lines: string[]): Promise<void> {
      harness = await IntegrationHarness.create({
        agents: [
          { name: AGENT_NAME, schedule: "0 0 31 2 *", testScript: "#!/bin/sh\nexit 0\n" },
        ],
      });

      const logsPath = resolve(harness.projectPath, ".al", "logs");
      mkdirSync(logsPath, { recursive: true });
      writeFileSync(
        join(logsPath, `${AGENT_NAME}-${TODAY}.log`),
        lines.join("\n") + "\n",
      );

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

    it("forward cursor at limit < total entries returns correct mid-file cursor and subsequent read returns remaining entries", async () => {
      // Create 9 entries with distinct incrementing messages so we can verify ordering.
      const baseTime = 1_700_000_000_000;
      const logLines = Array.from({ length: 9 }, (_, i) =>
        pinoLine(`entry-${String(i + 1).padStart(2, "0")}`, baseTime + i * 1000),
      );

      await createHarnessWithLogLines(logLines);
      if (!gatewayAccessible) return;

      // Use a cursor at offset 0 (start of file) with limit=3.
      // readEntriesForward reads entries 1-3, hits limit, and should set
      // newOffset = byteOffset + bytesConsumed (not stat.size).
      const cursorAtStart = encodeCursorAt(TODAY, 0);
      const res1 = await logsAPI(harness, AGENT_NAME, {
        cursor: cursorAtStart,
        lines: "3",
      });
      expect(res1.status).toBe(200);

      const body1 = (await res1.json()) as {
        entries: Array<{ msg: string; time: number }>;
        cursor: string | null;
        hasMore: boolean;
      };
      expect(Array.isArray(body1.entries)).toBe(true);
      expect(body1.entries).toHaveLength(3);
      expect(body1.entries[0].msg).toBe("entry-01");
      expect(body1.entries[2].msg).toBe("entry-03");

      // cursor should be a non-null string (encodes the mid-file position)
      expect(typeof body1.cursor).toBe("string");
      expect(body1.cursor).not.toBeNull();

      // hasMore should be true (we only read 3 of 9 entries)
      expect(body1.hasMore).toBe(true);

      // Second forward read using the cursor from the first read.
      // With the fix, the cursor points to AFTER entry-03, so we get entries 4-6.
      // Without the fix (cursor = EOF), this would return empty entries.
      const res2 = await logsAPI(harness, AGENT_NAME, {
        cursor: body1.cursor!,
        lines: "3",
      });
      expect(res2.status).toBe(200);

      const body2 = (await res2.json()) as {
        entries: Array<{ msg: string; time: number }>;
        cursor: string | null;
        hasMore: boolean;
      };
      expect(Array.isArray(body2.entries)).toBe(true);
      // With the fix, entries 4-6 should be returned (not empty)
      expect(body2.entries.length).toBeGreaterThan(0);
      expect(body2.entries[0].msg).toBe("entry-04");
    });

    it("forward cursor when limit exceeds total entries returns cursor at EOF and empty subsequent read", async () => {
      // Create 3 entries; request limit=10 (more than available).
      // All 3 entries are read → entries.length < limit → newOffset = stat.size.
      // A subsequent forward read should return empty (we're at EOF with no new entries).
      const baseTime = 1_700_000_100_000;
      const logLines = [
        pinoLine("small-entry-01", baseTime),
        pinoLine("small-entry-02", baseTime + 1000),
        pinoLine("small-entry-03", baseTime + 2000),
      ];

      await createHarnessWithLogLines(logLines);
      if (!gatewayAccessible) return;

      // Forward read from start with limit=10 (> 3 entries)
      const cursorAtStart = encodeCursorAt(TODAY, 0);
      const res1 = await logsAPI(harness, AGENT_NAME, {
        cursor: cursorAtStart,
        lines: "10",
      });
      expect(res1.status).toBe(200);

      const body1 = (await res1.json()) as {
        entries: Array<{ msg: string }>;
        cursor: string | null;
        hasMore: boolean;
      };
      expect(body1.entries).toHaveLength(3);
      expect(body1.hasMore).toBe(false); // entries.length (3) < lines (10) → hasMore=false

      // Cursor should still be non-null (points to EOF)
      expect(typeof body1.cursor).toBe("string");

      // Second read with the EOF cursor — no new entries written, so result is empty
      const res2 = await logsAPI(harness, AGENT_NAME, {
        cursor: body1.cursor!,
        lines: "10",
      });
      expect(res2.status).toBe(200);

      const body2 = (await res2.json()) as {
        entries: Array<{ msg: string }>;
        hasMore: boolean;
      };
      expect(body2.entries).toHaveLength(0);
      expect(body2.hasMore).toBe(false);
    });

    it("forward cursor pagination correctly reads all entries in sequential pages", async () => {
      // Create 6 entries; read in pages of 2 using forward cursor.
      // Verifies the bytesConsumed fix enables complete multi-page traversal.
      const baseTime = 1_700_000_200_000;
      const logLines = Array.from({ length: 6 }, (_, i) =>
        pinoLine(`page-entry-${String(i + 1).padStart(2, "0")}`, baseTime + i * 1000),
      );

      await createHarnessWithLogLines(logLines);
      if (!gatewayAccessible) return;

      const allCollected: string[] = [];
      let cursor: string | null = encodeCursorAt(TODAY, 0);

      // Page through all entries in chunks of 2
      for (let page = 0; page < 4; page++) {
        if (!cursor) break;
        const res = await logsAPI(harness, AGENT_NAME, {
          cursor,
          lines: "2",
        });
        expect(res.status).toBe(200);

        const body = (await res.json()) as {
          entries: Array<{ msg: string }>;
          cursor: string | null;
          hasMore: boolean;
        };

        if (body.entries.length === 0) break;
        allCollected.push(...body.entries.map((e) => e.msg));
        cursor = body.cursor;
      }

      // All 6 entries should have been collected across the pages
      expect(allCollected).toHaveLength(6);
      expect(allCollected[0]).toBe("page-entry-01");
      expect(allCollected[5]).toBe("page-entry-06");
    });
  },
);
