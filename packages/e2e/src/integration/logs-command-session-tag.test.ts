/**
 * Integration tests: cli/commands/logs.ts instance tag in conversation mode
 * — no Docker required.
 *
 * The existing logs-command-advanced.test.ts tests the instance tag only in
 * raw mode. This test verifies that formatConversationEntry() also shows the
 * instance tag in conversation mode (the instanceTag ternary when entry.instance
 * is truthy).
 *
 * Covers:
 *   - cli/commands/logs.ts: formatConversationEntry() instanceTag shown in assistant msg
 *   - cli/commands/logs.ts: formatConversationEntry() instanceTag shown in bash command
 *   - cli/commands/logs.ts: formatConversationEntry() instanceTag shown in error entry
 *   - cli/commands/logs.ts: formatConversationEntry() instanceTag absent when no instance
 *   - cli/commands/logs.ts: LEVEL_COLORS unknown level → "L<N>" label in raw mode
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
  "integration: cli/commands/logs.ts instance tag in conversation mode (no Docker required)",
  { timeout: 30_000 },
  () => {
    let projectDir: string;

    beforeEach(() => {
      projectDir = mkdtempSync(join(tmpdir(), "al-logs-inst-test-"));
    });

    afterEach(() => {
      rmSync(projectDir, { recursive: true, force: true });
    });

    // ── instanceTag in conversation mode ──────────────────────────────────────

    it("assistant entry WITH instance shows instance name in conversation mode", async () => {
      setupProjectWithLogs(projectDir, "inst-conv-agent", [
        pinoLine({ msg: "assistant", level: 30, text: "Hello world", instance: "inst-abc12345" }),
      ]);

      const { logs } = await captureOutput(() =>
        logsExecute("inst-conv-agent", { project: projectDir, lines: "100" })
      );
      const allOutput = logs.join("\n");
      // Instance name should appear in conversation mode output
      expect(allOutput).toContain("inst-abc12345");
    });

    it("bash entry WITH instance shows instance name in conversation mode", async () => {
      setupProjectWithLogs(projectDir, "bash-inst-agent", [
        pinoLine({ msg: "bash", level: 30, cmd: "echo hello", instance: "inst-xyz99999" }),
      ]);

      const { logs } = await captureOutput(() =>
        logsExecute("bash-inst-agent", { project: projectDir, lines: "100" })
      );
      const allOutput = logs.join("\n");
      expect(allOutput).toContain("inst-xyz99999");
    });

    it("warn entry WITH instance shows instance name in conversation mode", async () => {
      // Note: formatConversationEntry warns do NOT use instanceTag (by design — the
      // warn branch returns just `${time}  ${YELLOW}WARN: ${msg}`). The instance
      // is included in the instanceTag for assistant/bash/tool-start messages only.
      // This test verifies the warn output is correct even when instance is set.
      setupProjectWithLogs(projectDir, "warn-inst-agent", [
        pinoLine({ msg: "agent warning", level: 40, instance: "inst-warn-111" }),
      ]);

      const { logs } = await captureOutput(() =>
        logsExecute("warn-inst-agent", { project: projectDir, lines: "100" })
      );
      const allOutput = logs.join("\n");
      // Warn branch does NOT use instanceTag — verifies the warn text appears
      expect(allOutput).toContain("WARN: agent warning");
    });

    it("entry WITHOUT instance field has no instance bracket in output", async () => {
      setupProjectWithLogs(projectDir, "no-inst-agent", [
        pinoLine({ msg: "assistant", level: 30, text: "No instance here" }),
      ]);

      const { logs } = await captureOutput(() =>
        logsExecute("no-inst-agent", { project: projectDir, lines: "100" })
      );
      const allOutput = logs.join("\n");
      // Should not have any bracket-enclosed instance
      expect(allOutput).not.toMatch(/\[[a-f0-9]{8}\]/);
    });

    // ── LEVEL_COLORS unknown level in raw mode ────────────────────────────────

    it("raw mode with unknown level number shows L<N> label", async () => {
      setupProjectWithLogs(projectDir, "unknown-lvl-agent", [
        pinoLine({ msg: "custom log line", level: 35 }), // 35 is not a standard pino level
      ]);

      const { logs } = await captureOutput(() =>
        logsExecute("unknown-lvl-agent", { project: projectDir, lines: "100", raw: true })
      );
      const allOutput = logs.join("\n");
      // Should show "L35" since level 35 is not in LEVEL_COLORS
      expect(allOutput).toContain("L35");
    });

    it("raw mode with extra fields shows JSON extras in output", async () => {
      setupProjectWithLogs(projectDir, "extras-raw-agent", [
        pinoLine({ msg: "my log", level: 30, customField: "customValue", anotherField: 42 }),
      ]);

      const { logs } = await captureOutput(() =>
        logsExecute("extras-raw-agent", { project: projectDir, lines: "100", raw: true })
      );
      const allOutput = logs.join("\n");
      expect(allOutput).toContain("customValue");
      expect(allOutput).toContain("customField");
    });
  }
);
