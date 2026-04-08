/**
 * Integration tests: cli/commands/logs.ts formatConversationEntry() "event" and "tool done"
 * additional branches added in commit b2e994f7 — no Docker required.
 *
 * The "event" message branch (debug-level, visible with --all) was extended to include:
 *   - stopReason field: appends `stop=<reason>` to the event type line
 *   - content field (non-"[]"): adds content as an indented second line
 *   - content field = "[]": content suppressed (not displayed)
 *   - turnResult field: adds turnResult as an indented additional line
 *
 * The "tool done" message branch was also extended:
 *   - resultLength present: shown as "(N chars)" suffix in --all mode
 *   - resultLength absent: no suffix
 *
 * Test scenarios:
 *   1. "event" + stopReason → output includes "stop=<value>"
 *   2. "event" + content (non-"[]") → second line shows content text
 *   3. "event" + content = "[]" → no content line added
 *   4. "event" + turnResult → additional indented line with turnResult text
 *   5. "tool done" + resultLength in --all mode → "(N chars)" shown
 *   6. "tool done" without resultLength → no "(N chars)" shown
 *
 * Covers:
 *   - cli/commands/logs.ts: formatConversationEntry() "event" → stopReason branch
 *   - cli/commands/logs.ts: formatConversationEntry() "event" → content non-"[]" branch
 *   - cli/commands/logs.ts: formatConversationEntry() "event" → content = "[]" suppressed
 *   - cli/commands/logs.ts: formatConversationEntry() "event" → turnResult branch
 *   - cli/commands/logs.ts: formatConversationEntry() "tool done" → resultLength shown
 *   - cli/commands/logs.ts: formatConversationEntry() "tool done" → no resultLength suffix
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
  console.log = (...args: any[]) => logs.push(args.join(" "));
  try {
    await fn();
  } finally {
    console.log = origLog;
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
  "integration: cli/commands/logs.ts formatConversationEntry() event and tool done branches (no Docker required)",
  { timeout: 30_000 },
  () => {
    let projectDir: string;

    beforeEach(() => {
      projectDir = mkdtempSync(join(tmpdir(), "al-logs-event-fmt-test-"));
    });

    afterEach(() => {
      rmSync(projectDir, { recursive: true, force: true });
    });

    // ── "event" with stopReason ──────────────────────────────────────────────

    it('"event" entry with stopReason → shows stop=<value> in --all mode', async () => {
      const lines = [
        pinoLine({
          msg: "event",
          level: 20,
          type: "message_end",
          stopReason: "end_turn",
        }),
      ];
      setupProjectWithLogs(projectDir, "stopreason-agent", lines);

      const { logs } = await captureOutput(() =>
        logsExecute("stopreason-agent", { project: projectDir, lines: "100", all: true })
      );

      const output = logs.join("\n");
      expect(output).toContain("message_end");
      expect(output).toContain("stop=end_turn");
    });

    it('"event" entry without stopReason → no "stop=" in output', async () => {
      const lines = [
        pinoLine({
          msg: "event",
          level: 20,
          type: "message_start",
        }),
      ];
      setupProjectWithLogs(projectDir, "nostopreason-agent", lines);

      const { logs } = await captureOutput(() =>
        logsExecute("nostopreason-agent", { project: projectDir, lines: "100", all: true })
      );

      const output = logs.join("\n");
      expect(output).toContain("message_start");
      expect(output).not.toContain("stop=");
    });

    // ── "event" with content ──────────────────────────────────────────────────

    it('"event" entry with non-"[]" content → content shown as second line in --all mode', async () => {
      const lines = [
        pinoLine({
          msg: "event",
          level: 20,
          type: "message_start",
          content: '[{"type":"text","text":"Hello"}]',
        }),
      ];
      setupProjectWithLogs(projectDir, "content-agent", lines);

      const { logs } = await captureOutput(() =>
        logsExecute("content-agent", { project: projectDir, lines: "100", all: true })
      );

      const output = logs.join("\n");
      expect(output).toContain("message_start");
      // Content should appear in the output
      expect(output).toContain("Hello");
    });

    it('"event" entry with content = "[]" → content suppressed (not displayed)', async () => {
      const lines = [
        pinoLine({
          msg: "event",
          level: 20,
          type: "message_start",
          content: "[]",
        }),
      ];
      setupProjectWithLogs(projectDir, "empty-content-agent", lines);

      const { logs } = await captureOutput(() =>
        logsExecute("empty-content-agent", { project: projectDir, lines: "100", all: true })
      );

      const output = logs.join("\n");
      expect(output).toContain("message_start");
      // "[]" should not appear as a content line
      expect(output).not.toContain("[]");
    });

    // ── "event" with turnResult ──────────────────────────────────────────────

    it('"event" entry with turnResult → turnResult shown as additional line in --all mode', async () => {
      const lines = [
        pinoLine({
          msg: "event",
          level: 20,
          type: "turn_end",
          turnResult: '{"status":"completed","output":"done"}',
        }),
      ];
      setupProjectWithLogs(projectDir, "turnresult-agent", lines);

      const { logs } = await captureOutput(() =>
        logsExecute("turnresult-agent", { project: projectDir, lines: "100", all: true })
      );

      const output = logs.join("\n");
      expect(output).toContain("turn_end");
      // turnResult should appear in the output
      expect(output).toContain("completed");
    });

    // ── "tool done" resultLength ─────────────────────────────────────────────

    it('"tool done" with resultLength → shows "(N chars)" in --all mode', async () => {
      const lines = [
        pinoLine({
          msg: "tool done",
          level: 20,
          tool: "Read",
          resultLength: 4567,
        }),
      ];
      setupProjectWithLogs(projectDir, "resultlen-agent", lines);

      const { logs } = await captureOutput(() =>
        logsExecute("resultlen-agent", { project: projectDir, lines: "100", all: true })
      );

      const output = logs.join("\n");
      expect(output).toContain("Read");
      // resultLength should appear as "(4567 chars)"
      expect(output).toContain("4567");
    });

    it('"tool done" without resultLength → no "(N chars)" suffix in --all mode', async () => {
      const lines = [
        pinoLine({
          msg: "tool done",
          level: 20,
          tool: "Bash",
          // No resultLength field
        }),
      ];
      setupProjectWithLogs(projectDir, "noresultlen-agent", lines);

      const { logs } = await captureOutput(() =>
        logsExecute("noresultlen-agent", { project: projectDir, lines: "100", all: true })
      );

      const output = logs.join("\n");
      expect(output).toContain("Bash");
      // No "(N chars)" suffix
      expect(output).not.toContain("chars");
    });
  },
);
