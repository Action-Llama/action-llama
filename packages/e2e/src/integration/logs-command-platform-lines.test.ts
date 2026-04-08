/**
 * Integration tests: cli/commands/logs.ts parseLine() PLATFORM_LINE_RE branch
 * — no Docker required.
 *
 * parseLine() skips Lambda/ECS platform lines matching:
 *   /^(START |END |REPORT |INIT_START |EXTENSION )/
 *
 * When a log file contains these platform-generated lines (e.g., from CloudWatch
 * or AWS Lambda execution environments), they should be silently filtered out
 * and not appear in the CLI output.
 *
 * Test scenarios:
 *   1. "START RequestId: ..." line → silently filtered (not in output)
 *   2. "END RequestId: ..." line → silently filtered
 *   3. "REPORT RequestId: ..." line → silently filtered
 *   4. "INIT_START ..." line → silently filtered
 *   5. "EXTENSION ..." line → silently filtered
 *   6. Mix of platform lines and normal entries → only normal entries shown
 *
 * Covers:
 *   - cli/commands/logs.ts: parseLine() PLATFORM_LINE_RE skip branch
 *     (START/END/REPORT/INIT_START/EXTENSION lines filtered from output)
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
function pinoLine(msg: string, level = 30): string {
  return JSON.stringify({ level, time: Date.now(), msg });
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
  "integration: cli/commands/logs.ts parseLine() PLATFORM_LINE_RE branch (no Docker required)",
  { timeout: 30_000 },
  () => {
    let projectDir: string;

    beforeEach(() => {
      projectDir = mkdtempSync(join(tmpdir(), "al-logs-platform-test-"));
    });

    afterEach(() => {
      rmSync(projectDir, { recursive: true, force: true });
    });

    it("START RequestId line is silently filtered from output", async () => {
      const lines = [
        pinoLine("before platform line"),
        "START RequestId: 12345-abc def-12345 Version: $LATEST",
        pinoLine("after platform line"),
      ];
      setupProjectWithLogs(projectDir, "start-line-agent", lines);

      const { logs } = await captureOutput(() =>
        logsExecute("start-line-agent", { project: projectDir, lines: "100" })
      );

      const output = logs.join("\n");
      expect(output).toContain("before platform line");
      expect(output).toContain("after platform line");
      expect(output).not.toContain("START RequestId");
    });

    it("END RequestId line is silently filtered from output", async () => {
      const lines = [
        pinoLine("normal log entry"),
        "END RequestId: 12345-abc",
      ];
      setupProjectWithLogs(projectDir, "end-line-agent", lines);

      const { logs } = await captureOutput(() =>
        logsExecute("end-line-agent", { project: projectDir, lines: "100" })
      );

      const output = logs.join("\n");
      expect(output).toContain("normal log entry");
      expect(output).not.toContain("END RequestId");
    });

    it("REPORT RequestId line is silently filtered from output", async () => {
      const lines = [
        "REPORT RequestId: abc-123 Duration: 100.50 ms Billed Duration: 101 ms",
        pinoLine("after report"),
      ];
      setupProjectWithLogs(projectDir, "report-line-agent", lines);

      const { logs } = await captureOutput(() =>
        logsExecute("report-line-agent", { project: projectDir, lines: "100" })
      );

      const output = logs.join("\n");
      expect(output).toContain("after report");
      expect(output).not.toContain("REPORT RequestId");
    });

    it("INIT_START line is silently filtered from output", async () => {
      const lines = [
        "INIT_START Runtime Version: nodejs:20.v30",
        pinoLine("agent started"),
      ];
      setupProjectWithLogs(projectDir, "init-start-agent", lines);

      const { logs } = await captureOutput(() =>
        logsExecute("init-start-agent", { project: projectDir, lines: "100" })
      );

      const output = logs.join("\n");
      expect(output).toContain("agent started");
      expect(output).not.toContain("INIT_START");
    });

    it("EXTENSION line is silently filtered from output", async () => {
      const lines = [
        "EXTENSION Name: AwsXrayDaemon State: Ready Events: [INVOKE, SHUTDOWN]",
        pinoLine("extension loaded"),
      ];
      setupProjectWithLogs(projectDir, "extension-line-agent", lines);

      const { logs } = await captureOutput(() =>
        logsExecute("extension-line-agent", { project: projectDir, lines: "100" })
      );

      const output = logs.join("\n");
      expect(output).toContain("extension loaded");
      expect(output).not.toContain("EXTENSION Name:");
    });

    it("mix of platform lines and normal entries → only normal entries shown", async () => {
      const lines = [
        "START RequestId: abc-123 Version: $LATEST",
        pinoLine("agent completed analysis"),
        "END RequestId: abc-123",
        "REPORT RequestId: abc-123 Duration: 5000 ms",
        pinoLine("summary: 3 issues found"),
      ];
      setupProjectWithLogs(projectDir, "mixed-platform-agent", lines);

      const { logs } = await captureOutput(() =>
        logsExecute("mixed-platform-agent", { project: projectDir, lines: "100" })
      );

      const output = logs.join("\n");
      expect(output).toContain("agent completed analysis");
      expect(output).toContain("summary: 3 issues found");
      expect(output).not.toContain("START RequestId");
      expect(output).not.toContain("END RequestId");
      expect(output).not.toContain("REPORT RequestId");
    });
  },
);
