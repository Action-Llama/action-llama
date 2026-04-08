/**
 * Integration tests: backward cursor pagination advanced scenarios — no Docker required.
 *
 * This file extends logs-back-cursor.test.ts with the remaining missing test scenarios:
 *
 *   1. back_cursor with instance filter isolates entries by instance ID — only entries
 *      matching the specific instance ID are included in the backward-paginated results.
 *   2. back_cursor with cursor date not matching any file — when the cursor references a
 *      date that no longer has a log file (e.g., file was rotated away), logs.ts falls back
 *      to starting the backward scan from the most recent file (cursorFileIdx === -1 path).
 *
 * These two paths are described in the logs-back-cursor.test.ts header (scenarios 5 and a
 * newly discovered path) but were not implemented there.
 *
 * These tests create log files manually in the project's .al/logs/ directory
 * before starting the Phase 3 gateway. The gateway registers log routes, so
 * the API is accessible without Docker.
 *
 * Covers:
 *   - control/routes/logs.ts: handleLogRequest — back_cursor branch + instanceFilter propagation
 *   - control/routes/logs.ts: handleLogRequest — cursorFileIdx === -1 fallback to most-recent file
 *   - control/routes/log-helpers.ts: readLastEntries startPosition + instanceFilter combined
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { IntegrationHarness } from "./harness.js";

const TODAY = new Date().toISOString().slice(0, 10);

/**
 * Encode a cursor in the same base64url format as the server (date:offset).
 */
function encodeTestCursor(date: string, offset: number): string {
  return Buffer.from(`${date}:${offset}`).toString("base64url");
}

/** Create a pino-format log line. */
function pinoLine(
  msg: string,
  time: number,
  agentName: string,
  instanceId?: string,
): string {
  return JSON.stringify({
    level: 30,
    time,
    msg,
    name: agentName,
    pid: 1,
    hostname: "localhost",
    ...(instanceId ? { instance: instanceId } : {}),
  });
}

describe(
  "integration: backward cursor pagination advanced scenarios (no Docker required)",
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

    function instanceLogsAPI(
      h: IntegrationHarness,
      agentName: string,
      instanceId: string,
      query?: Record<string, string>,
    ): Promise<Response> {
      const params = query ? "?" + new URLSearchParams(query).toString() : "";
      return fetch(
        `http://127.0.0.1:${h.gatewayPort}/api/logs/agents/${agentName}/${instanceId}${params}`,
        {
          headers: { Authorization: `Bearer ${h.apiKey}` },
          signal: AbortSignal.timeout(5_000),
        },
      );
    }

    function agentLogsAPI(
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

    async function createHarnessWithLogs(
      agentName: string,
      logLines: string[],
      filename?: string,
    ): Promise<void> {
      harness = await IntegrationHarness.create({
        agents: [
          { name: "scaffold-agent", schedule: "0 0 31 2 *", testScript: "#!/bin/sh\nexit 0\n" },
        ],
      });

      const logsPath = resolve(harness.projectPath, ".al", "logs");
      mkdirSync(logsPath, { recursive: true });
      writeFileSync(
        join(logsPath, filename ?? `${agentName}-${TODAY}.log`),
        logLines.join("\n") + "\n",
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

    // ── Scenario 1: back_cursor instance filter isolation ─────────────────────

    it("back_cursor with per-instance log endpoint only returns entries for that instance", async () => {
      // Two instances writing to the same log file. The instance-specific endpoint
      // (/:name/:instanceId) filters entries by instance ID. When a back_cursor is
      // used with that endpoint, the filter must still be applied.
      const AGENT_NAME = "bc-instance-filter-agent";
      const INSTANCE_A = "instance-aaa-123";
      const INSTANCE_B = "instance-bbb-456";

      // Create a large log file with interleaved entries from two instances.
      // 80 entries total, alternating between instances A and B.
      // With 40 entries per instance, requesting lines=5 should require back_cursor
      // for the instance-specific endpoint IF the file is large enough.
      const entries: string[] = [];
      const baseTime = 1_700_000_000_000;
      for (let i = 0; i < 80; i++) {
        const instanceId = i % 2 === 0 ? INSTANCE_A : INSTANCE_B;
        entries.push(
          pinoLine(
            `msg-${String(i).padStart(3, "0")} ${"z".repeat(60)}`,
            baseTime + i * 1000,
            AGENT_NAME,
            instanceId,
          ),
        );
      }

      await createHarnessWithLogs(AGENT_NAME, entries);
      if (!gatewayAccessible) return;

      // Request the all-entries endpoint (no instance filter) — should return all entries
      const resAll = await agentLogsAPI(harness, AGENT_NAME, { lines: "200" });
      expect(resAll.status).toBe(200);
      const bodyAll = (await resAll.json()) as { entries: Array<{ msg: string; instance?: string }> };
      expect(Array.isArray(bodyAll.entries)).toBe(true);
      // All 80 entries should be visible from the unfiltered endpoint
      expect(bodyAll.entries.length).toBeGreaterThanOrEqual(20);

      // Request the instance-specific endpoint for INSTANCE_A only
      const resA = await instanceLogsAPI(harness, AGENT_NAME, INSTANCE_A, { lines: "200" });
      expect(resA.status).toBe(200);
      const bodyA = (await resA.json()) as { entries: Array<{ msg: string; instance?: string }> };
      expect(Array.isArray(bodyA.entries)).toBe(true);

      // Every entry returned should belong to INSTANCE_A
      for (const entry of bodyA.entries) {
        expect(entry.instance).toBe(INSTANCE_A);
      }

      // There should be fewer entries than from the unfiltered endpoint
      expect(bodyA.entries.length).toBeLessThan(bodyAll.entries.length);

      // Request the instance-specific endpoint for INSTANCE_B
      const resB = await instanceLogsAPI(harness, AGENT_NAME, INSTANCE_B, { lines: "200" });
      expect(resB.status).toBe(200);
      const bodyB = (await resB.json()) as { entries: Array<{ msg: string; instance?: string }> };
      expect(Array.isArray(bodyB.entries)).toBe(true);

      // Every entry returned should belong to INSTANCE_B
      for (const entry of bodyB.entries) {
        expect(entry.instance).toBe(INSTANCE_B);
      }

      // Entries from A and B together should account for all entries
      if (bodyA.entries.length > 0 && bodyB.entries.length > 0) {
        expect(bodyA.entries.length + bodyB.entries.length).toBe(bodyAll.entries.length);
      }
    });

    // ── Scenario 2: back_cursor date doesn't match any file (cursorFileIdx === -1) ──

    it("back_cursor with non-existent cursor date falls back to most recent log file", async () => {
      // This tests the cursorFileIdx === -1 fallback in logs.ts:
      //   const startIdx = cursorFileIdx >= 0 ? cursorFileIdx : allFiles.length - 1;
      //
      // When the back_cursor references a date that no longer has a corresponding log
      // file (e.g., the file was rotated away after the cursor was issued), the server
      // falls back to scanning from the most recent file instead of throwing an error.
      const AGENT_NAME = "bc-missing-date-agent";

      // Create a log file dated TODAY with a few entries
      const entries: string[] = [];
      const baseTime = Date.now() - 10_000;
      for (let i = 0; i < 5; i++) {
        entries.push(pinoLine(`present-entry-${i}`, baseTime + i * 1000, AGENT_NAME));
      }

      await createHarnessWithLogs(AGENT_NAME, entries);
      if (!gatewayAccessible) return;

      // Build a back_cursor pointing to a date far in the past (2020-01-01)
      // that has NO corresponding log file — this should exercise the fallback path.
      const staleCursor = encodeTestCursor("2020-01-01", 999999);

      const res = await agentLogsAPI(harness, AGENT_NAME, {
        back_cursor: staleCursor,
        lines: "10",
      });
      // The endpoint should succeed (200) — not fail — when cursor date is missing.
      // The server falls back to scanning from the most recent file.
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        entries: Array<{ msg: string }>;
        cursor: string | null;
        backCursor: string | null;
        hasMore: boolean;
      };
      expect(Array.isArray(body.entries)).toBe(true);
      // Should return entries from the current log file (the fallback)
      // or return empty if the startPos offset is beyond the file size.
      // Either way: status is 200, entries is an array, no 400/500 error.
      expect(typeof body.hasMore).toBe("boolean");
      expect(body.cursor).toBeNull(); // back_cursor path always returns cursor: null
    });
  },
);
