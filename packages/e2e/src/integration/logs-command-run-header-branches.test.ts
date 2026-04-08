/**
 * Integration tests: cli/commands/logs.ts formatRunHeader() branches
 * — no Docker required.
 *
 * The existing logs-command-advanced.test.ts tests the separator header for
 * "Starting X run" with name/container but not with instance. This test
 * covers the remaining branches:
 *
 *   formatRunHeader():
 *     - "Starting ..." WITH entry.instance → instance ID appears in separator label
 *     - "Starting ..." WITHOUT entry.name → uses "agent" fallback as agent name
 *     - msg doesn't include " run" or " container run" → returns null (no separator)
 *
 * Covers:
 *   - cli/commands/logs.ts: formatRunHeader() entry.instance truthy branch
 *   - cli/commands/logs.ts: formatRunHeader() entry.name || "agent" fallback
 *   - cli/commands/logs.ts: formatRunHeader() msg.startsWith("Starting ") but no " run" → null
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const { execute: logsExecute } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cli/commands/logs.js"
);

/** Capture console.log output during a callback. */
async function captureOutput(fn: () => Promise<void>): Promise<{ logs: string[] }> {
  const logs: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...args: any[]) => logs.push(args.join(" "));
  console.error = (...args: any[]) => {};
  try {
    await fn();
  } finally {
    console.log = origLog;
    console.error = origError;
  }
  return { logs };
}

/** Get today's date in YYYY-MM-DD format. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Build a pino-format log line. */
function pinoLine(opts: { level?: number; msg: string; time?: number; [key: string]: unknown }): string {
  const { level = 30, msg, time = Date.now(), ...rest } = opts;
  return JSON.stringify({ level, time, msg, ...rest });
}

/** Set up a minimal project with a log file for an agent. */
function setupProjectWithLogs(projectDir: string, agentName: string, logLines: string[]): void {
  const logsDir = join(projectDir, ".al", "logs");
  mkdirSync(logsDir, { recursive: true });

  writeFileSync(
    join(projectDir, "config.toml"),
    '[models.sonnet]\nprovider = "anthropic"\nmodel = "claude-3-5-sonnet-20241022"\nauthType = "api_key"\n'
  );

  const logFile = join(logsDir, `${agentName}-${today()}.log`);
  writeFileSync(logFile, logLines.join("\n") + "\n");
}

describe(
  "integration: cli/commands/logs.ts formatRunHeader() branches (no Docker required)",
  { timeout: 30_000 },
  () => {
    let projectDir: string;

    beforeEach(() => {
      projectDir = mkdtempSync(join(tmpdir(), "al-logs-runhdr-test-"));
    });

    afterEach(() => {
      rmSync(projectDir, { recursive: true, force: true });
    });

    // ── formatRunHeader: entry.instance truthy branch ─────────────────────────

    it("run header WITH entry.instance shows instance ID in separator label", async () => {
      setupProjectWithLogs(projectDir, "inst-hdr-agent", [
        pinoLine({
          msg: "Starting manual run",
          level: 30,
          name: "inst-hdr-agent",
          instance: "inst-hdr-abc12345",
        }),
        pinoLine({ msg: "assistant", text: "Working.", level: 30 }),
      ]);

      const { logs } = await captureOutput(() =>
        logsExecute("inst-hdr-agent", { project: projectDir, lines: "100" })
      );
      const allOutput = logs.join("\n");
      // Should include the instance ID in the separator label
      expect(allOutput).toContain("inst-hdr-abc12345");
      // Should still have separator dashes
      expect(allOutput).toMatch(/─{2,}/);
    });

    // ── formatRunHeader: entry.name || "agent" fallback ───────────────────────

    it("run header WITHOUT entry.name uses 'agent' as fallback name in separator", async () => {
      setupProjectWithLogs(projectDir, "fallback-name-agent", [
        pinoLine({
          msg: "Starting scheduled run",
          level: 30,
          // No 'name' field — should fall back to "agent"
        }),
        pinoLine({ msg: "assistant", text: "Hello.", level: 30 }),
      ]);

      const { logs } = await captureOutput(() =>
        logsExecute("fallback-name-agent", { project: projectDir, lines: "100" })
      );
      const allOutput = logs.join("\n");
      // The fallback "agent" should appear in the separator label
      expect(allOutput).toContain("agent");
      expect(allOutput).toMatch(/─{2,}/);
    });

    // ── formatRunHeader: null return for "Starting" without " run" ─────────────

    it("'Starting something' WITHOUT 'run' does NOT trigger the separator", async () => {
      setupProjectWithLogs(projectDir, "no-run-agent", [
        pinoLine({
          msg: "Starting agent session",  // "Starting " prefix but no " run"
          level: 30,
          name: "no-run-agent",
        }),
        pinoLine({ msg: "assistant", text: "Processing.", level: 30 }),
      ]);

      const { logs } = await captureOutput(() =>
        logsExecute("no-run-agent", { project: projectDir, lines: "100" })
      );
      const allOutput = logs.join("\n");
      // Should NOT contain separator dashes (formatRunHeader returns null)
      expect(allOutput).not.toMatch(/^─{2,}/m);
    });
  }
);
