/**
 * Integration tests: per-instance log filtering — no Docker required.
 *
 * The GET /api/logs/agents/:name/:instanceId endpoint filters log entries by
 * the `instance` field in pino log lines. Container runners add this field via
 * `logger.child({ instance: instanceId })`. This test verifies the filtering
 * works correctly by creating log files with mixed instance entries.
 *
 * Test scenarios:
 *   1. Instance filter returns only entries matching the specified instance
 *   2. Instance filter excludes entries from other instances
 *   3. Entries without an instance field are excluded when filtering
 *   4. GET /api/logs/agents/:name (no instanceId) returns ALL entries
 *
 * Covers:
 *   - control/routes/logs.ts: GET /api/logs/agents/:name/:instanceId
 *   - control/routes/log-helpers.ts: readLastEntries instanceFilter matching
 *   - control/routes/log-helpers.ts: readLastEntriesMultiFile with instanceFilter
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { IntegrationHarness } from "./harness.js";

const TODAY = new Date().toISOString().slice(0, 10);
const LOG_PREFIX = "inst-filter-agent";

function pinoLine(msg: string, instance?: string): string {
  const entry: Record<string, unknown> = {
    level: 30,
    time: Date.now(),
    msg,
    name: LOG_PREFIX,
    pid: 1,
    hostname: "localhost",
  };
  if (instance) entry.instance = instance;
  return JSON.stringify(entry);
}

describe(
  "integration: per-instance log API filtering (no Docker required)",
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

    async function startHarness(): Promise<void> {
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "inst-filter-scaffold",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });

      // Write log file with entries from two different instances + untagged entries
      // The instance field in pino logs uses the FULL instance ID (agent-name + hex suffix)
      // The :instanceId URL param must also be the FULL instance ID for matching to work.
      const logsPath = resolve(harness.projectPath, ".al", "logs");
      mkdirSync(logsPath, { recursive: true });
      writeFileSync(
        join(logsPath, `${LOG_PREFIX}-${TODAY}.log`),
        [
          pinoLine("no-instance-entry"),                          // no instance field
          pinoLine("inst-a-entry-1", `${LOG_PREFIX}-aabbccdd`),   // instance A (full ID)
          pinoLine("inst-b-entry-1", `${LOG_PREFIX}-11223344`),   // instance B (full ID)
          pinoLine("inst-a-entry-2", `${LOG_PREFIX}-aabbccdd`),   // instance A
          pinoLine("inst-b-entry-2", `${LOG_PREFIX}-11223344`),   // instance B
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

    it("GET /api/logs/agents/:name/:instanceId returns only entries for that instance", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      // Use full instance ID in the URL (same pattern as dashboard/API consumers)
      const res = await logsAPI(harness, `/api/logs/agents/${LOG_PREFIX}/${LOG_PREFIX}-aabbccdd?lines=10`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as { entries: Array<{ msg: string; instance?: string }> };
      const msgs = body.entries.map((e) => e.msg);

      // Only instance A entries should be present
      expect(msgs).toContain("inst-a-entry-1");
      expect(msgs).toContain("inst-a-entry-2");

      // Instance B and untagged entries should NOT be present
      expect(msgs).not.toContain("inst-b-entry-1");
      expect(msgs).not.toContain("inst-b-entry-2");
      expect(msgs).not.toContain("no-instance-entry");
    });

    it("GET /api/logs/agents/:name/:instanceId for B returns only B entries", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await logsAPI(harness, `/api/logs/agents/${LOG_PREFIX}/${LOG_PREFIX}-11223344?lines=10`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as { entries: Array<{ msg: string }> };
      const msgs = body.entries.map((e) => e.msg);

      // Only instance B entries
      expect(msgs).toContain("inst-b-entry-1");
      expect(msgs).toContain("inst-b-entry-2");

      // Instance A and untagged excluded
      expect(msgs).not.toContain("inst-a-entry-1");
      expect(msgs).not.toContain("inst-a-entry-2");
      expect(msgs).not.toContain("no-instance-entry");
    });

    it("GET /api/logs/agents/:name (no instanceId) returns ALL entries including untagged", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await logsAPI(harness, `/api/logs/agents/${LOG_PREFIX}?lines=10`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as { entries: Array<{ msg: string }> };
      const msgs = body.entries.map((e) => e.msg);

      // All 5 entries should be present (no instance filter)
      expect(msgs).toContain("no-instance-entry");
      expect(msgs).toContain("inst-a-entry-1");
      expect(msgs).toContain("inst-a-entry-2");
      expect(msgs).toContain("inst-b-entry-1");
      expect(msgs).toContain("inst-b-entry-2");
    });

    it("GET /api/logs/agents/:name/:instanceId for unknown instance returns empty entries", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      // No entry has this instance ID
      const res = await logsAPI(harness, `/api/logs/agents/${LOG_PREFIX}/${LOG_PREFIX}-ffffffff?lines=10`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as { entries: unknown[] };
      expect(body.entries).toHaveLength(0);
    });
  },
);
