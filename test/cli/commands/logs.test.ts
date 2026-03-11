import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";

import { execute } from "../../../src/cli/commands/logs.js";

function makePinoLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    level: 30,
    time: Date.now(),
    msg: "test message",
    name: "dev",
    pid: 1,
    hostname: "localhost",
    ...overrides,
  });
}

describe("logs command", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-logs-"));
    mkdirSync(resolve(tmpDir, ".al", "logs"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Raw mode (--raw) ─────────────────────────────────────────────────────

  describe("raw mode (--raw)", () => {
    it("reads and displays last N log entries", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      const lines = Array.from({ length: 20 }, (_, i) =>
        makePinoLine({ msg: `entry ${i}`, time: Date.now() + i * 1000 })
      );
      writeFileSync(logFile, lines.join("\n") + "\n");

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));

      await execute("dev", { project: tmpDir, lines: "5", raw: true });

      console.log = origLog;

      expect(output).toHaveLength(5);
      expect(output[0]).toContain("entry 15");
      expect(output[4]).toContain("entry 19");
    });

    it("skips malformed JSON lines", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      const content = [
        makePinoLine({ msg: "good line 1" }),
        "this is not json {{{",
        "",
        makePinoLine({ msg: "good line 2" }),
      ].join("\n") + "\n";
      writeFileSync(logFile, content);

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));

      await execute("dev", { project: tmpDir, lines: "50", raw: true });

      console.log = origLog;

      expect(output).toHaveLength(2);
      expect(output[0]).toContain("good line 1");
      expect(output[1]).toContain("good line 2");
    });

    it("applies ANSI colors based on log level", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      const content = [
        makePinoLine({ level: 30, msg: "info msg" }),
        makePinoLine({ level: 40, msg: "warn msg" }),
        makePinoLine({ level: 50, msg: "error msg" }),
      ].join("\n") + "\n";
      writeFileSync(logFile, content);

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));

      await execute("dev", { project: tmpDir, lines: "50", raw: true });

      console.log = origLog;

      // Green for info
      expect(output[0]).toContain("\x1b[32m");
      // Yellow for warn
      expect(output[1]).toContain("\x1b[33m");
      // Red for error
      expect(output[2]).toContain("\x1b[31m");
    });

    it("includes extra fields in output", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      writeFileSync(logFile, makePinoLine({ msg: "with extras", cmd: "al foo" }) + "\n");

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));

      await execute("dev", { project: tmpDir, lines: "50", raw: true });

      console.log = origLog;

      expect(output[0]).toContain("al foo");
    });
  });

  // ── Conversation mode (default) ──────────────────────────────────────────

  describe("conversation mode (default)", () => {
    it("shows assistant text in bold white", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      writeFileSync(logFile, makePinoLine({
        msg: "assistant",
        text: "I'll check the open issues now.",
      }) + "\n");

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));

      await execute("dev", { project: tmpDir, lines: "50" });

      console.log = origLog;

      expect(output).toHaveLength(1);
      // Bold white
      expect(output[0]).toContain("\x1b[1m");
      expect(output[0]).toContain("I'll check the open issues now.");
    });

    it("shows multi-line assistant text indented", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      writeFileSync(logFile, makePinoLine({
        msg: "assistant",
        text: "Line one\nLine two\nLine three",
      }) + "\n");

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));

      await execute("dev", { project: tmpDir, lines: "50" });

      console.log = origLog;

      expect(output).toHaveLength(1);
      expect(output[0]).toContain("Line one");
      expect(output[0]).toContain("Line two");
      expect(output[0]).toContain("Line three");
    });

    it("shows bash commands with $ prefix in cyan", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      writeFileSync(logFile, makePinoLine({
        msg: "bash",
        cmd: "gh issue list --repo acme/app",
      }) + "\n");

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));

      await execute("dev", { project: tmpDir, lines: "50" });

      console.log = origLog;

      expect(output).toHaveLength(1);
      // Cyan
      expect(output[0]).toContain("\x1b[36m");
      expect(output[0]).toContain("$ gh issue list --repo acme/app");
    });

    it("shows tool starts with arrow in blue", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      writeFileSync(logFile, makePinoLine({
        level: 20, // debug
        msg: "tool start",
        tool: "write_file",
      }) + "\n");

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));

      await execute("dev", { project: tmpDir, lines: "50" });

      console.log = origLog;

      expect(output).toHaveLength(1);
      // Blue
      expect(output[0]).toContain("\x1b[34m");
      expect(output[0]).toContain("▸ write_file");
    });

    it("shows tool errors in red with details", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      writeFileSync(logFile, makePinoLine({
        level: 50,
        msg: "tool error",
        tool: "bash",
        cmd: "git push origin main",
        result: "permission denied",
      }) + "\n");

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));

      await execute("dev", { project: tmpDir, lines: "50" });

      console.log = origLog;

      expect(output).toHaveLength(1);
      // Red
      expect(output[0]).toContain("\x1b[31m");
      expect(output[0]).toContain("✗ bash failed");
      expect(output[0]).toContain("git push origin main");
      expect(output[0]).toContain("permission denied");
    });

    it("shows run completed in green", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      writeFileSync(logFile, makePinoLine({
        msg: "run completed",
        outputLength: 5000,
      }) + "\n");

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));

      await execute("dev", { project: tmpDir, lines: "50" });

      console.log = origLog;

      expect(output).toHaveLength(1);
      // Green + bold
      expect(output[0]).toContain("\x1b[32m");
      expect(output[0]).toContain("Run completed");
    });

    it("shows run header separator on run start", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      writeFileSync(logFile, makePinoLine({
        msg: "Starting my-agent run (schedule)",
        container: "al-my-agent-a1b2c3d4",
      }) + "\n");

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));

      await execute("dev", { project: tmpDir, lines: "50" });

      console.log = origLog;

      // Header + the actual entry
      expect(output).toHaveLength(2);
      expect(output[0]).toContain("──");
      expect(output[0]).toContain("dev");
      // The entry itself shows the container
      expect(output[1]).toContain("Starting my-agent run");
      expect(output[1]).toContain("al-my-agent-a1b2c3d4");
    });

    it("skips 'tool done' and 'event' messages", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      const content = [
        makePinoLine({ msg: "bash", cmd: "echo hi" }),
        makePinoLine({ level: 20, msg: "tool done", tool: "bash", resultLength: 10 }),
        makePinoLine({ level: 20, msg: "event", type: "turn_end" }),
        makePinoLine({ msg: "run completed", outputLength: 100 }),
      ].join("\n") + "\n";
      writeFileSync(logFile, content);

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));

      await execute("dev", { project: tmpDir, lines: "50" });

      console.log = origLog;

      // Only bash + run completed (tool done and event are skipped)
      expect(output).toHaveLength(2);
      expect(output[0]).toContain("$ echo hi");
      expect(output[1]).toContain("Run completed");
    });

    it("shows a full conversation flow", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      const t = Date.now();
      const content = [
        makePinoLine({ msg: "Starting my-agent run", time: t, container: "al-my-agent-abc12345" }),
        makePinoLine({ msg: "assistant", time: t + 1000, text: "I'll check the issues." }),
        makePinoLine({ msg: "bash", time: t + 2000, cmd: "gh issue list" }),
        makePinoLine({ level: 20, msg: "tool done", time: t + 3000, tool: "bash", resultLength: 500 }),
        makePinoLine({ level: 20, msg: "tool start", time: t + 4000, tool: "write_file" }),
        makePinoLine({ level: 20, msg: "tool done", time: t + 5000, tool: "write_file", resultLength: 100 }),
        makePinoLine({ msg: "assistant", time: t + 6000, text: "Done! Created the report." }),
        makePinoLine({ msg: "run completed", time: t + 7000, outputLength: 200 }),
      ].join("\n") + "\n";
      writeFileSync(logFile, content);

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));

      await execute("dev", { project: tmpDir, lines: "50" });

      console.log = origLog;

      // Header + Starting + assistant + bash + tool start + assistant + run completed
      // (tool done lines are skipped)
      expect(output).toHaveLength(7);
      expect(output[0]).toContain("──"); // header
      expect(output[1]).toContain("Starting my-agent run");
      expect(output[1]).toContain("al-my-agent-abc12345");
      expect(output[2]).toContain("I'll check the issues.");
      expect(output[3]).toContain("$ gh issue list");
      expect(output[4]).toContain("▸ write_file");
      expect(output[5]).toContain("Done! Created the report.");
      expect(output[6]).toContain("Run completed");
    });
  });

  // ── Shared behavior ──────────────────────────────────────────────────────

  it("reads a specific date's log file", async () => {
    const logFile = resolve(tmpDir, ".al", "logs", "dev-2025-01-15.log");
    writeFileSync(logFile, makePinoLine({ msg: "bash", cmd: "echo old" }) + "\n");

    const output: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => output.push(args.join(" "));

    await execute("dev", { project: tmpDir, lines: "50", date: "2025-01-15" });

    console.log = origLog;

    expect(output).toHaveLength(1);
    expect(output[0]).toContain("echo old");
  });

  it("finds most recent log when today has no file", async () => {
    const logFile = resolve(tmpDir, ".al", "logs", "dev-2025-06-01.log");
    writeFileSync(logFile, makePinoLine({ msg: "bash", cmd: "echo recent" }) + "\n");

    const output: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => output.push(args.join(" "));

    await execute("dev", { project: tmpDir, lines: "50" });

    console.log = origLog;

    expect(output).toHaveLength(1);
    expect(output[0]).toContain("echo recent");
  });

  it("exits with error for missing agent", async () => {
    const origExit = process.exit;
    const origError = console.error;
    let exitCode: number | undefined;
    let errorOutput = "";

    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error("EXIT");
    }) as any;
    console.error = (...args: any[]) => { errorOutput = args.join(" "); };

    try {
      await execute("nonexistent", { project: tmpDir, lines: "50" });
    } catch (e: any) {
      // Expected "EXIT" thrown from process.exit mock
    }

    process.exit = origExit;
    console.error = origError;

    expect(exitCode).toBe(1);
    expect(errorOutput).toContain("nonexistent");
  });

  it("follows cloud logs when --follow is used", { timeout: 15_000 }, async () => {
    const configContent = `
[cloud]
provider = "ecs"
awsRegion = "us-east-1"
ecsCluster = "test-cluster"
ecrRepository = "test.dkr.ecr.us-east-1.amazonaws.com/test"
executionRoleArn = "arn:aws:iam::123456789:role/test-exec"
taskRoleArn = "arn:aws:iam::123456789:role/test-task"
subnets = ["subnet-123"]
`;
    writeFileSync(resolve(tmpDir, "config.toml"), configContent);

    const output: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => output.push(args.join(" "));

    // execute() will hang on the infinite await in follow mode after
    // fetchLogs + followLogs start. Race against a short timeout — we
    // only need to verify the initial output message was printed.
    const ac = new AbortController();
    const timeout = new Promise<void>((resolve) => setTimeout(() => {
      ac.abort();
      resolve();
    }, 3000));

    try {
      await Promise.race([
        execute("dev", {
          project: tmpDir,
          lines: "10",
          follow: true,
          cloud: true
        }),
        timeout,
      ]);
    } catch (e: any) {
      // Expected - may fail when trying to contact AWS
    }

    console.log = origLog;

    expect(output.some(line => line.includes("Following logs for dev"))).toBe(true);
  });

  it("fetches static cloud logs when --follow is not used", { timeout: 15_000 }, async () => {
    const configContent = `
[cloud]
provider = "ecs"
awsRegion = "us-east-1"
ecsCluster = "test-cluster"
ecrRepository = "test.dkr.ecr.us-east-1.amazonaws.com/test"
executionRoleArn = "arn:aws:iam::123456789:role/test-exec"
taskRoleArn = "arn:aws:iam::123456789:role/test-task"
subnets = ["subnet-123"]
`;
    writeFileSync(resolve(tmpDir, "config.toml"), configContent);

    const output: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => output.push(args.join(" "));

    try {
      await execute("dev", {
        project: tmpDir,
        lines: "10",
        cloud: true
      });
    } catch (e: any) {
      // Expected - will fail when trying to contact AWS
    }

    console.log = origLog;

    expect(output.some(line => line.includes("Fetching cloud logs for dev"))).toBe(true);
  });
});
