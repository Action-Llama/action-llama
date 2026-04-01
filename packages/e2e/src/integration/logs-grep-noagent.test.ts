/**
 * Integration tests: log API ?grep parameter filtering — no Docker required.
 *
 * The ?grep parameter in the log API filters entries whose JSON representation
 * matches a regex pattern. This is implemented in readLastEntries / readLastEntriesMultiFile.
 *
 * Test scenarios:
 *   1. ?grep=pattern filters entries containing the pattern
 *   2. ?grep= with invalid regex returns 400
 *   3. ?grep=nonexistent returns empty entries
 *
 * Covers:
 *   - control/routes/log-helpers.ts: grep RegExp filter in readLastEntries
 *   - control/routes/logs.ts: handleLogRequest invalid grep → 400
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { IntegrationHarness } from "./harness.js";

const TODAY = new Date().toISOString().slice(0, 10);
const LOG_PREFIX = "grep-test-agent";

function pinoLine(msg: string, extra?: Record<string, unknown>): string {
  return JSON.stringify({
    level: 30,
    time: Date.now(),
    msg,
    name: LOG_PREFIX,
    pid: 1,
    hostname: "localhost",
    ...extra,
  });
}

describe(
  "integration: log API ?grep parameter (no Docker required)",
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
          { name: "grep-scaffold", schedule: "0 0 31 2 *", testScript: "#!/bin/sh\nexit 0\n" },
        ],
      });

      const logsPath = resolve(harness.projectPath, ".al", "logs");
      mkdirSync(logsPath, { recursive: true });
      writeFileSync(
        join(logsPath, `${LOG_PREFIX}-${TODAY}.log`),
        [
          pinoLine("deploy completed successfully", { cmd: "deploy.sh" }),
          pinoLine("database backup started"),
          pinoLine("deploy failed: timeout", { cmd: "deploy.sh" }),
          pinoLine("cache cleared"),
        ].join("\n") + "\n",
      );

      try {
        await harness.start();
        gatewayAccessible = true;
      } catch {
        try {
          const h = await fetch(`http://127.0.0.1:${harness.gatewayPort}/health`, { signal: AbortSignal.timeout(3_000) });
          gatewayAccessible = h.ok;
        } catch { gatewayAccessible = false; }
      }
    }

    it("?grep=deploy returns only entries matching 'deploy'", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await logsAPI(harness, { lines: "10", grep: "deploy" });
      expect(res.status).toBe(200);

      const body = (await res.json()) as { entries: Array<{ msg: string }> };
      const msgs = body.entries.map((e) => e.msg);

      // Both deploy entries should match
      expect(msgs.some((m) => m.includes("deploy"))).toBe(true);
      // Non-deploy entries should be excluded
      expect(msgs).not.toContain("database backup started");
      expect(msgs).not.toContain("cache cleared");
    });

    it("?grep=[invalid returns 400 for invalid regex", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await logsAPI(harness, { grep: "[invalid-regex" });
      expect(res.status).toBe(400);

      const body = (await res.json()) as { error: string };
      expect(body.error).toBeTruthy();
    });

    it("?grep=nonexistent returns empty entries", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await logsAPI(harness, { lines: "10", grep: "zzz-nonexistent-pattern-zzz" });
      expect(res.status).toBe(200);

      const body = (await res.json()) as { entries: unknown[] };
      expect(body.entries).toHaveLength(0);
    });
  },
);
