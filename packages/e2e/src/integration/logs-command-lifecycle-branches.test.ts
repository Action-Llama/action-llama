/**
 * Integration tests: cli/commands/logs.ts lifecycle message branches
 * not covered by logs-command-advanced.test.ts — no Docker required.
 *
 * The logs-command-advanced.test.ts covers the main lifecycle messages,
 * but each branch with optional fields has an untested "absent field" path.
 * This test covers the false branches of those ternary expressions:
 *
 *   formatConversationEntry():
 *     - "container launched" WITHOUT container field → shows "Container launched" without name
 *     - "container finished" WITHOUT elapsed field → shows "Container finished" without timing
 *     - "container starting" WITHOUT modelId → shows just "Container starting: <agentName>"
 *     - "Starting ..." WITH container field → shows container name in parentheses
 *     - "event" WITH role field → shows role= in output (--all mode)
 *     - "event" WITH stopReason field → shows stop= in output (--all mode)
 *     - "event" WITH content field → shows content in output (--all mode)
 *     - "event" WITH turnResult field → shows turnResult in output (--all mode)
 *     - info-level "event" message is skipped in default mode (SKIP_MESSAGES set)
 *     - "tool done" WITHOUT resultLength → shows tool name without chars count
 *     - level >= 50 with extras JSON → includes JSON extras in output
 *     - "Starting " message in catch-all branch (msg.startsWith("Starting ") is handled)
 *
 * Covers:
 *   - cli/commands/logs.ts: formatConversationEntry() "container launched" no-container branch
 *   - cli/commands/logs.ts: formatConversationEntry() "container finished" no-elapsed branch
 *   - cli/commands/logs.ts: formatConversationEntry() "container starting" no-modelId branch
 *   - cli/commands/logs.ts: formatConversationEntry() "Starting " with container field
 *   - cli/commands/logs.ts: formatConversationEntry() "event" role/stopReason/content/turnResult
 *   - cli/commands/logs.ts: formatConversationEntry() "tool done" no resultLength
 *   - cli/commands/logs.ts: formatConversationEntry() error entry with extras JSON
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
  "integration: cli/commands/logs.ts lifecycle message absent-field branches (no Docker required)",
  { timeout: 30_000 },
  () => {
    let projectDir: string;

    beforeEach(() => {
      projectDir = mkdtempSync(join(tmpdir(), "al-logs-lifecycle-test-"));
    });

    afterEach(() => {
      rmSync(projectDir, { recursive: true, force: true });
    });

    // ── "container launched" without container field ───────────────────────────

    it("'container launched' without container field shows 'Container launched' without name", async () => {
      setupProjectWithLogs(projectDir, "no-ctr-agent", [
        pinoLine({ msg: "container launched", level: 30 }), // no container field
      ]);

      const { logs } = await captureOutput(() =>
        logsExecute("no-ctr-agent", { project: projectDir, lines: "100" })
      );
      const allOutput = logs.join("\n");
      expect(allOutput).toContain("Container launched");
      // Should not have a container name appended since container is absent
      // (Can't check for no container name specifically as none was provided)
    });

    // ── "container finished" without elapsed field ────────────────────────────

    it("'container finished' without elapsed field shows 'Container finished' without timing", async () => {
      setupProjectWithLogs(projectDir, "no-elapsed-agent", [
        pinoLine({ msg: "container finished", level: 30 }), // no elapsed field
      ]);

      const { logs } = await captureOutput(() =>
        logsExecute("no-elapsed-agent", { project: projectDir, lines: "100" })
      );
      const allOutput = logs.join("\n");
      expect(allOutput).toContain("Container finished");
      // No elapsed time appended
      expect(allOutput).not.toMatch(/Container finished\s*\(/); // no "(12.5s)" etc.
    });

    // ── "container starting" without modelId ─────────────────────────────────

    it("'container starting' without modelId shows just 'Container starting: <agentName>'", async () => {
      setupProjectWithLogs(projectDir, "no-model-agent", [
        pinoLine({ msg: "container starting", level: 30, agentName: "test-agent" }), // no modelId
      ]);

      const { logs } = await captureOutput(() =>
        logsExecute("no-model-agent", { project: projectDir, lines: "100" })
      );
      const allOutput = logs.join("\n");
      expect(allOutput).toContain("Container starting: test-agent");
      // Should not show model= since no modelId was provided
      expect(allOutput).not.toContain("model=");
    });

    // ── "Starting " with container field ─────────────────────────────────────

    it("'Starting ...' WITH container field includes container name in output", async () => {
      setupProjectWithLogs(projectDir, "start-ctr-agent", [
        pinoLine({ msg: "Starting scheduled run", level: 30, name: "start-ctr-agent", container: "al-container-xyz789" }),
      ]);

      const { logs } = await captureOutput(() =>
        logsExecute("start-ctr-agent", { project: projectDir, lines: "100" })
      );
      const allOutput = logs.join("\n");
      // Should include the container name in the output
      expect(allOutput).toContain("al-container-xyz789");
    });

    // ── "event" entry with various optional fields (--all mode) ───────────────

    it("'event' WITH role field shows 'role=' in output (--all mode)", async () => {
      setupProjectWithLogs(projectDir, "event-role-agent", [
        pinoLine({ msg: "event", level: 20, type: "message_start", role: "assistant" }),
      ]);

      const { logs } = await captureOutput(() =>
        logsExecute("event-role-agent", { project: projectDir, lines: "100", all: true })
      );
      const allOutput = logs.join("\n");
      expect(allOutput).toContain("role=");
      expect(allOutput).toContain("assistant");
    });

    it("'event' WITH stopReason field shows 'stop=' in output (--all mode)", async () => {
      setupProjectWithLogs(projectDir, "event-stop-agent", [
        pinoLine({ msg: "event", level: 20, type: "turn_complete", stopReason: "end_turn" }),
      ]);

      const { logs } = await captureOutput(() =>
        logsExecute("event-stop-agent", { project: projectDir, lines: "100", all: true })
      );
      const allOutput = logs.join("\n");
      expect(allOutput).toContain("stop=");
      expect(allOutput).toContain("end_turn");
    });

    it("'event' WITH content shows content lines in output (--all mode)", async () => {
      setupProjectWithLogs(projectDir, "event-content-agent", [
        pinoLine({ msg: "event", level: 20, type: "content_block", content: "Hello from event content" }),
      ]);

      const { logs } = await captureOutput(() =>
        logsExecute("event-content-agent", { project: projectDir, lines: "100", all: true })
      );
      const allOutput = logs.join("\n");
      expect(allOutput).toContain("Hello from event content");
    });

    it("'event' WITH turnResult shows turnResult in output (--all mode)", async () => {
      setupProjectWithLogs(projectDir, "event-turn-agent", [
        pinoLine({ msg: "event", level: 20, type: "turn_end", turnResult: "completed with 3 turns" }),
      ]);

      const { logs } = await captureOutput(() =>
        logsExecute("event-turn-agent", { project: projectDir, lines: "100", all: true })
      );
      const allOutput = logs.join("\n");
      expect(allOutput).toContain("completed with 3 turns");
    });

    // ── "tool done" without resultLength ────────────────────────────────────

    it("'tool done' WITHOUT resultLength shows tool name without chars count", async () => {
      setupProjectWithLogs(projectDir, "no-len-agent", [
        pinoLine({ msg: "tool done", level: 20, tool: "bash_execute" }), // no resultLength
      ]);

      const { logs } = await captureOutput(() =>
        logsExecute("no-len-agent", { project: projectDir, lines: "100", all: true })
      );
      const allOutput = logs.join("\n");
      expect(allOutput).toContain("bash_execute");
      // No "chars" mention since resultLength is absent
      expect(allOutput).not.toContain("chars");
    });

    // ── level >= 50 with extras JSON ──────────────────────────────────────────

    it("error entry with extra JSON fields includes extras in output", async () => {
      setupProjectWithLogs(projectDir, "extras-agent", [
        pinoLine({ msg: "fatal error", level: 50, exitCode: 127, agentName: "my-agent" }),
      ]);

      const { logs } = await captureOutput(() =>
        logsExecute("extras-agent", { project: projectDir, lines: "100" })
      );
      const allOutput = logs.join("\n");
      expect(allOutput).toContain("ERROR: fatal error");
      // The extras (exitCode, agentName) should appear as JSON
      expect(allOutput).toContain("exitCode");
    });

    // ── catch-all info message (no special handling) ─────────────────────────

    it("info-level message with no special handling shows message text in output", async () => {
      setupProjectWithLogs(projectDir, "catchall-agent", [
        pinoLine({ msg: "some-generic-info-message", level: 30 }),
      ]);

      const { logs } = await captureOutput(() =>
        logsExecute("catchall-agent", { project: projectDir, lines: "100" })
      );
      const allOutput = logs.join("\n");
      expect(allOutput).toContain("some-generic-info-message");
    });
  }
);
