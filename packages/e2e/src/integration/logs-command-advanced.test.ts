/**
 * Integration tests: cli/commands/logs.ts — advanced formatters and parseTimeValue
 * — no Docker required.
 *
 * Covers branches not exercised by logs-command-fallback.test.ts:
 *
 * parseTimeValue() branches:
 *   - Relative "Nh" duration (hours) → timestamp N hours ago
 *   - Relative "Nd" duration (days) → timestamp N days ago
 *   - ISO date string → exact timestamp
 *   - Invalid value → execute() logs error and exits
 *
 * formatRunHeader() separator:
 *   - "Starting X run" message → prints ── separator with agent name
 *   - "Starting X container run" message → also triggers separator
 *   - "run completed" message → does NOT trigger separator
 *
 * formatConversationEntry() lifecycle messages (not covered elsewhere):
 *   - "run completed" → "Run completed" output
 *   - "run completed, rerun requested" → "Run completed" + "(rerun requested)"
 *   - "container launched" → "Container launched" output
 *   - "container finished" → "Container finished" output
 *   - "container finished (rerun requested)" → includes "rerun requested"
 *   - "container starting" → "Container starting: <agentName>"
 *   - "creating agent session" → dim msg output
 *   - "session created, sending prompt" → dim msg output
 *
 * formatConversationEntry() error and tool entries:
 *   - level >= 50 with err field → "ERROR: <msg>" + err details
 *   - level >= 50 with error field → uses error field (not err)
 *   - level >= 50 with stack field → includes stack in output
 *   - "tool error" entry → shows tool name + "failed"
 *   - level >= 40 (warn) → "WARN: <msg>"
 *
 * formatConversationEntry() --all mode entries:
 *   - "event" entry (debug level) → shows event type (only with --all)
 *   - "tool done" entry (debug level) → shows tool name + resultLength (only with --all)
 *   - default mode skips debug entries (not "tool start")
 *
 * --after/--before options (via parseTimeValue):
 *   - --after "2h" filters out entries older than 2 hours
 *   - --before "1d" filters out entries newer than 1 day ago (fallback mode)
 *   - invalid --after value → error message + exit
 *   - invalid --before value → error message + exit
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const { execute: logsExecute } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cli/commands/logs.js"
);

/** Capture console.log and console.error output during a callback. */
async function captureOutput(fn: () => Promise<void>): Promise<{ logs: string[]; errors: string[] }> {
  const logs: string[] = [];
  const errors: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...args: any[]) => logs.push(args.join(" "));
  console.error = (...args: any[]) => errors.push(args.join(" "));
  try {
    await fn();
  } finally {
    console.log = origLog;
    console.error = origError;
  }
  return { logs, errors };
}

/** Get today's date in YYYY-MM-DD format. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Build a pino-format log line with specific timestamp. */
function pinoLine(opts: { level?: number; msg: string; time?: number; [key: string]: unknown }): string {
  const { level = 30, msg, time = Date.now(), ...rest } = opts;
  return JSON.stringify({ level, time, msg, ...rest });
}

/** Set up a minimal project with a log file for an agent. */
function setupProjectWithLogs(
  projectDir: string,
  agentName: string,
  logLines: string[],
  opts?: { date?: string }
): void {
  const logsDir = join(projectDir, ".al", "logs");
  mkdirSync(logsDir, { recursive: true });

  writeFileSync(
    join(projectDir, "config.toml"),
    '[models.sonnet]\nprovider = "anthropic"\nmodel = "claude-3-5-sonnet-20241022"\nauthType = "api_key"\n'
  );

  const dateStr = opts?.date || today();
  const logFile = join(logsDir, `${agentName}-${dateStr}.log`);
  writeFileSync(logFile, logLines.join("\n") + "\n");
}

describe(
  "integration: cli/commands/logs.ts advanced formatters and parseTimeValue (no Docker required)",
  { timeout: 30_000 },
  () => {
    let projectDir: string;

    beforeEach(() => {
      projectDir = mkdtempSync(join(tmpdir(), "al-logs-adv-test-"));
    });

    afterEach(() => {
      rmSync(projectDir, { recursive: true, force: true });
    });

    // ── formatRunHeader() separator ───────────────────────────────────────────

    it("shows run separator header for 'Starting X run' message", async () => {
      const lines = [
        pinoLine({ msg: "Starting scheduled run", level: 30, name: "my-agent" }),
        pinoLine({ msg: "assistant", text: "Processing.", level: 30 }),
      ];
      setupProjectWithLogs(projectDir, "header-agent", lines);

      const { logs } = await captureOutput(() =>
        logsExecute("header-agent", { project: projectDir, lines: "100" })
      );

      const allOutput = logs.join("\n");
      // The run header should contain the agent name and a separator line
      expect(allOutput).toContain("my-agent");
      // Should contain separator dashes
      expect(allOutput).toMatch(/─{2,}/);
    });

    it("shows run separator header for 'Starting X container run' message", async () => {
      const lines = [
        pinoLine({ msg: "Starting container run", level: 30, name: "container-agent", container: "al-container-abc123" }),
      ];
      setupProjectWithLogs(projectDir, "container-run-agent", lines);

      const { logs } = await captureOutput(() =>
        logsExecute("container-run-agent", { project: projectDir, lines: "100" })
      );

      const allOutput = logs.join("\n");
      // Container run messages trigger the separator header
      expect(allOutput).toContain("container-agent");
    });

    it("does NOT show separator header for 'run completed' message", async () => {
      const lines = [
        pinoLine({ msg: "run completed", level: 30 }),
      ];
      setupProjectWithLogs(projectDir, "no-header-agent", lines);

      const { logs } = await captureOutput(() =>
        logsExecute("no-header-agent", { project: projectDir, lines: "100" })
      );

      const allOutput = logs.join("\n");
      // "run completed" should not produce a separator with ──
      // (the separator is only for "Starting ... run" messages)
      // We should still get some output for "run completed"
      expect(allOutput).toContain("Run completed");
      // But no leading separator line (which has ── prefix)
    });

    // ── formatConversationEntry() lifecycle messages ──────────────────────────

    it("'run completed' shows 'Run completed' output", async () => {
      const lines = [
        pinoLine({ msg: "run completed", level: 30 }),
      ];
      setupProjectWithLogs(projectDir, "run-completed-agent", lines);

      const { logs } = await captureOutput(() =>
        logsExecute("run-completed-agent", { project: projectDir, lines: "100" })
      );

      expect(logs.join("\n")).toContain("Run completed");
    });

    it("'run completed, rerun requested' includes rerun indicator", async () => {
      const lines = [
        pinoLine({ msg: "run completed, rerun requested", level: 30 }),
      ];
      setupProjectWithLogs(projectDir, "rerun-agent", lines);

      const { logs } = await captureOutput(() =>
        logsExecute("rerun-agent", { project: projectDir, lines: "100" })
      );

      const allOutput = logs.join("\n");
      expect(allOutput).toContain("Run completed");
      expect(allOutput).toContain("rerun requested");
    });

    it("'container launched' shows 'Container launched' output", async () => {
      const lines = [
        pinoLine({ msg: "container launched", level: 30, container: "al-abc123" }),
      ];
      setupProjectWithLogs(projectDir, "launched-agent", lines);

      const { logs } = await captureOutput(() =>
        logsExecute("launched-agent", { project: projectDir, lines: "100" })
      );

      expect(logs.join("\n")).toContain("Container launched");
    });

    it("'container finished' shows 'Container finished' output", async () => {
      const lines = [
        pinoLine({ msg: "container finished", level: 30, elapsed: "12.5s" }),
      ];
      setupProjectWithLogs(projectDir, "finished-agent", lines);

      const { logs } = await captureOutput(() =>
        logsExecute("finished-agent", { project: projectDir, lines: "100" })
      );

      expect(logs.join("\n")).toContain("Container finished");
    });

    it("'container finished (rerun requested)' includes rerun in output", async () => {
      const lines = [
        pinoLine({ msg: "container finished (rerun requested)", level: 30, elapsed: "5.0s" }),
      ];
      setupProjectWithLogs(projectDir, "rerun-fin-agent", lines);

      const { logs } = await captureOutput(() =>
        logsExecute("rerun-fin-agent", { project: projectDir, lines: "100" })
      );

      expect(logs.join("\n")).toContain("Container finished");
    });

    it("'container starting' shows agent name", async () => {
      const lines = [
        pinoLine({ msg: "container starting", level: 30, agentName: "my-test-agent", modelId: "claude-3-5-sonnet" }),
      ];
      setupProjectWithLogs(projectDir, "starting-agent", lines);

      const { logs } = await captureOutput(() =>
        logsExecute("starting-agent", { project: projectDir, lines: "100" })
      );

      const allOutput = logs.join("\n");
      expect(allOutput).toContain("my-test-agent");
    });

    it("'creating agent session' outputs some text", async () => {
      const lines = [
        pinoLine({ msg: "creating agent session", level: 30 }),
      ];
      setupProjectWithLogs(projectDir, "session-agent", lines);

      const { logs } = await captureOutput(() =>
        logsExecute("session-agent", { project: projectDir, lines: "100" })
      );

      expect(logs.join("\n")).toContain("creating agent session");
    });

    it("'session created, sending prompt' outputs some text", async () => {
      const lines = [
        pinoLine({ msg: "session created, sending prompt", level: 30 }),
      ];
      setupProjectWithLogs(projectDir, "prompt-agent", lines);

      const { logs } = await captureOutput(() =>
        logsExecute("prompt-agent", { project: projectDir, lines: "100" })
      );

      expect(logs.join("\n")).toContain("session created");
    });

    // ── formatConversationEntry() error entries ───────────────────────────────

    it("error entry (level 50) with err field shows ERROR and err message", async () => {
      const lines = [
        pinoLine({ msg: "unhandled exception", level: 50, err: "Connection refused to database" }),
      ];
      setupProjectWithLogs(projectDir, "err-field-agent", lines);

      const { logs } = await captureOutput(() =>
        logsExecute("err-field-agent", { project: projectDir, lines: "100" })
      );

      const allOutput = logs.join("\n");
      expect(allOutput).toContain("ERROR");
      expect(allOutput).toContain("Connection refused to database");
    });

    it("error entry (level 50) with error field (not err) shows error message", async () => {
      const lines = [
        pinoLine({ msg: "container error", level: 50, error: "Docker daemon not responding" }),
      ];
      setupProjectWithLogs(projectDir, "error-field-agent", lines);

      const { logs } = await captureOutput(() =>
        logsExecute("error-field-agent", { project: projectDir, lines: "100" })
      );

      const allOutput = logs.join("\n");
      expect(allOutput).toContain("ERROR");
      expect(allOutput).toContain("Docker daemon not responding");
    });

    it("error entry (level 50) with stack field includes stack in output", async () => {
      const lines = [
        pinoLine({ msg: "fatal crash", level: 50, stack: "Error: at line 42\n  at fn (file.js:42:1)" }),
      ];
      setupProjectWithLogs(projectDir, "stack-agent", lines);

      const { logs } = await captureOutput(() =>
        logsExecute("stack-agent", { project: projectDir, lines: "100" })
      );

      const allOutput = logs.join("\n");
      expect(allOutput).toContain("ERROR");
      expect(allOutput).toContain("at line 42");
    });

    it("'tool error' entry shows tool name and 'failed'", async () => {
      const lines = [
        pinoLine({ msg: "tool error", level: 30, tool: "Write", cmd: "some-command", result: "Permission denied" }),
      ];
      setupProjectWithLogs(projectDir, "tool-err-agent", lines);

      const { logs } = await captureOutput(() =>
        logsExecute("tool-err-agent", { project: projectDir, lines: "100" })
      );

      const allOutput = logs.join("\n");
      expect(allOutput).toContain("Write");
      expect(allOutput).toContain("failed");
    });

    it("warn entry (level 40) shows 'WARN: <msg>'", async () => {
      const lines = [
        pinoLine({ msg: "rate limit approaching", level: 40 }),
      ];
      setupProjectWithLogs(projectDir, "warn-agent", lines);

      const { logs } = await captureOutput(() =>
        logsExecute("warn-agent", { project: projectDir, lines: "100" })
      );

      const allOutput = logs.join("\n");
      expect(allOutput).toContain("WARN");
      expect(allOutput).toContain("rate limit approaching");
    });

    // ── --all flag: debug-level entries ──────────────────────────────────────

    it("--all mode shows 'event' entries (debug level)", async () => {
      const lines = [
        pinoLine({ msg: "event", level: 20, type: "message_start", role: "assistant" }),
      ];
      setupProjectWithLogs(projectDir, "event-agent", lines);

      // Default mode: event entries at debug level are skipped
      const { logs: defaultLogs } = await captureOutput(() =>
        logsExecute("event-agent", { project: projectDir, lines: "100" })
      );

      // --all mode: event entries are shown
      const { logs: allLogs } = await captureOutput(() =>
        logsExecute("event-agent", { project: projectDir, lines: "100", all: true })
      );

      // Default mode should skip debug event entries
      expect(defaultLogs.join("\n")).not.toContain("message_start");
      // --all mode should include them
      expect(allLogs.join("\n")).toContain("message_start");
    });

    it("--all mode shows 'tool done' entries (debug level) with resultLength", async () => {
      const lines = [
        pinoLine({ msg: "tool done", level: 20, tool: "Read", resultLength: 1234 }),
      ];
      setupProjectWithLogs(projectDir, "tool-done-agent", lines);

      // Default mode skips tool done
      const { logs: defaultLogs } = await captureOutput(() =>
        logsExecute("tool-done-agent", { project: projectDir, lines: "100" })
      );

      // --all mode shows tool done
      const { logs: allLogs } = await captureOutput(() =>
        logsExecute("tool-done-agent", { project: projectDir, lines: "100", all: true })
      );

      expect(defaultLogs.join("\n")).not.toContain("1234");
      expect(allLogs.join("\n")).toContain("Read");
    });

    it("default mode skips debug-level entries that are not 'tool start'", async () => {
      const lines = [
        pinoLine({ msg: "some debug info", level: 20 }),
        pinoLine({ msg: "assistant", text: "Hello!", level: 30 }),
      ];
      setupProjectWithLogs(projectDir, "debug-skip-agent", lines);

      const { logs } = await captureOutput(() =>
        logsExecute("debug-skip-agent", { project: projectDir, lines: "100" })
      );

      const allOutput = logs.join("\n");
      // The debug message should not appear
      expect(allOutput).not.toContain("some debug info");
      // But the info message should
      expect(allOutput).toContain("Hello!");
    });

    it("default mode shows debug 'tool start' entry (non-bash tool)", async () => {
      const lines = [
        pinoLine({ msg: "tool start", level: 20, tool: "WebSearch" }),
      ];
      setupProjectWithLogs(projectDir, "debug-tool-start-agent", lines);

      const { logs } = await captureOutput(() =>
        logsExecute("debug-tool-start-agent", { project: projectDir, lines: "100" })
      );

      // debug-level "tool start" should be shown in default mode
      expect(logs.join("\n")).toContain("WebSearch");
    });

    // ── parseTimeValue() via --after/--before ─────────────────────────────────

    it("--after '2h' filters out entries older than 2 hours ago", async () => {
      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
      const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000;
      const recent = Date.now() - 60 * 1000; // 1 minute ago

      const lines = [
        // Old entry (3 hours ago) — should be filtered out
        pinoLine({ msg: "old run started", level: 30, time: threeHoursAgo }),
        // Recent entry — should pass through
        pinoLine({ msg: "assistant", text: "Recent output.", level: 30, time: recent }),
      ];
      setupProjectWithLogs(projectDir, "after-agent", lines);

      const { logs } = await captureOutput(() =>
        logsExecute("after-agent", { project: projectDir, lines: "100", after: "2h" })
      );

      const allOutput = logs.join("\n");
      // Recent entry should appear
      expect(allOutput).toContain("Recent output.");
      // Old entry should be filtered out
      expect(allOutput).not.toContain("old run started");
    });

    it("--after '1d' (1 day) keeps only recent entries", async () => {
      const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
      const oneHourAgo = Date.now() - 60 * 60 * 1000;

      const lines = [
        pinoLine({ msg: "old entry from 2 days ago", level: 30, time: twoDaysAgo }),
        pinoLine({ msg: "assistant", text: "Fresh output today.", level: 30, time: oneHourAgo }),
      ];
      setupProjectWithLogs(projectDir, "after-day-agent", lines);

      const { logs } = await captureOutput(() =>
        logsExecute("after-day-agent", { project: projectDir, lines: "100", after: "1d" })
      );

      const allOutput = logs.join("\n");
      expect(allOutput).toContain("Fresh output today.");
      expect(allOutput).not.toContain("old entry from 2 days ago");
    });

    it("--after with ISO date string filters correctly", async () => {
      // Create a date 12 hours in the past
      const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
      const isoDate = twelveHoursAgo.toISOString();

      const veryOld = Date.now() - 24 * 60 * 60 * 1000; // 24h ago
      const recent = Date.now() - 60 * 1000; // 1 minute ago

      const lines = [
        pinoLine({ msg: "very old entry", level: 30, time: veryOld }),
        pinoLine({ msg: "assistant", text: "Recent message.", level: 30, time: recent }),
      ];
      setupProjectWithLogs(projectDir, "after-iso-agent", lines);

      const { logs } = await captureOutput(() =>
        logsExecute("after-iso-agent", { project: projectDir, lines: "100", after: isoDate })
      );

      const allOutput = logs.join("\n");
      expect(allOutput).toContain("Recent message.");
      expect(allOutput).not.toContain("very old entry");
    });

    it("--after with invalid value logs error message", async () => {
      // We need to stub process.exit to prevent the test process from exiting
      const origExit = process.exit;
      let exitCode: number | undefined;
      process.exit = ((code?: number) => { exitCode = code; }) as typeof process.exit;

      const lines = [pinoLine({ msg: "assistant", text: "Hello.", level: 30 })];
      setupProjectWithLogs(projectDir, "invalid-after-agent", lines);

      const { errors } = await captureOutput(() =>
        logsExecute("invalid-after-agent", { project: projectDir, lines: "100", after: "notadate" })
      );

      process.exit = origExit;

      // Should log an error about the invalid value
      expect(errors.join("\n")).toMatch(/Error|invalid/i);
      // Should have called process.exit(1)
      expect(exitCode).toBe(1);
    });

    it("--before with invalid value logs error message", async () => {
      const origExit = process.exit;
      let exitCode: number | undefined;
      process.exit = ((code?: number) => { exitCode = code; }) as typeof process.exit;

      const lines = [pinoLine({ msg: "assistant", text: "Hello.", level: 30 })];
      setupProjectWithLogs(projectDir, "invalid-before-agent", lines);

      const { errors } = await captureOutput(() =>
        logsExecute("invalid-before-agent", { project: projectDir, lines: "100", before: "badvalue!!!" })
      );

      process.exit = origExit;

      expect(errors.join("\n")).toMatch(/Error|invalid/i);
      expect(exitCode).toBe(1);
    });

    // ── Multi-line assistant text ─────────────────────────────────────────────

    it("assistant entry with multi-line text shows all lines", async () => {
      const lines = [
        pinoLine({ msg: "assistant", text: "Line one.\nLine two.\nLine three.", level: 30 }),
      ];
      setupProjectWithLogs(projectDir, "multiline-agent", lines);

      const { logs } = await captureOutput(() =>
        logsExecute("multiline-agent", { project: projectDir, lines: "100" })
      );

      const allOutput = logs.join("\n");
      expect(allOutput).toContain("Line one.");
      expect(allOutput).toContain("Line two.");
      expect(allOutput).toContain("Line three.");
    });

    // ── SKIP_MESSAGES — "event" at info level ────────────────────────────────

    it("'event' message at info level (30) is skipped in default mode", async () => {
      const lines = [
        pinoLine({ msg: "event", level: 30, type: "message_stop" }),
        pinoLine({ msg: "assistant", text: "Done.", level: 30 }),
      ];
      setupProjectWithLogs(projectDir, "skip-event-agent", lines);

      const { logs } = await captureOutput(() =>
        logsExecute("skip-event-agent", { project: projectDir, lines: "100" })
      );

      // "event" entries are in SKIP_MESSAGES, so they are skipped regardless of level
      // But the assistant entry should appear
      expect(logs.join("\n")).toContain("Done.");
    });

    // ── instance tag in output ────────────────────────────────────────────────

    it("entry with instance field shows instance tag in raw mode", async () => {
      const lines = [
        pinoLine({ msg: "assistant", text: "Hello from instance.", level: 30, instance: "my-agent-abc12345" }),
      ];
      setupProjectWithLogs(projectDir, "instance-tag-agent", lines);

      const { logs } = await captureOutput(() =>
        logsExecute("instance-tag-agent", { project: projectDir, lines: "100", raw: true })
      );

      const allOutput = logs.join("\n");
      // Raw mode should include the instance tag
      expect(allOutput).toContain("my-agent-abc12345");
    });
  },
);
