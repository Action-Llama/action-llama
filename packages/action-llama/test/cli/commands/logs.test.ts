import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";

// Force file-reading fallback by making gatewayFetch reject
vi.mock("../../../src/cli/gateway-client.js", () => ({
  gatewayFetch: () => Promise.reject(new Error("no gateway")),
}));

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

  // ── --all mode ───────────────────────────────────────────────────────────

  describe("--all mode", () => {
    it("shows debug-level entries like tool done and event", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      const content = [
        makePinoLine({ msg: "bash", cmd: "echo hi" }),
        makePinoLine({ level: 20, msg: "tool done", tool: "bash", resultLength: 10 }),
        makePinoLine({ level: 20, msg: "event", type: "turn_end" }),
        makePinoLine({ msg: "run completed" }),
      ].join("\n") + "\n";
      writeFileSync(logFile, content);

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "50", all: true });
      console.log = origLog;

      // All 4 entries should appear in --all mode (tool done and event are shown too)
      expect(output.length).toBeGreaterThanOrEqual(4);
      expect(output.some((l) => l.includes("echo hi"))).toBe(true);
      expect(output.some((l) => l.includes("tool done"))).toBe(true);
      expect(output.some((l) => l.includes("event"))).toBe(true);
      expect(output.some((l) => l.includes("Run completed"))).toBe(true);
    });

    it("shows debug tool start entries in --all mode", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      writeFileSync(logFile, makePinoLine({ level: 20, msg: "tool start", tool: "bash" }) + "\n");

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "50", all: true });
      console.log = origLog;

      expect(output).toHaveLength(1);
      expect(output[0]).toContain("▸ bash");
    });
  });

  // ── Additional conversation message types ────────────────────────────────

  describe("additional conversation message types", () => {
    it("shows empty assistant message (no text) as nothing", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      writeFileSync(logFile, makePinoLine({ msg: "assistant", text: "" }) + "\n");

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "50" });
      console.log = origLog;

      // Empty text → formatConversationEntry returns null → no output
      expect(output).toHaveLength(0);
    });

    it("shows 'container launched' in dim text with container name", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      writeFileSync(logFile, makePinoLine({ msg: "container launched", container: "al-dev-a1b2c3d4" }) + "\n");

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "50" });
      console.log = origLog;

      expect(output).toHaveLength(1);
      expect(output[0]).toContain("Container launched");
      expect(output[0]).toContain("al-dev-a1b2c3d4");
    });

    it("shows 'container launched' without container name", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      writeFileSync(logFile, makePinoLine({ msg: "container launched" }) + "\n");

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "50" });
      console.log = origLog;

      expect(output).toHaveLength(1);
      expect(output[0]).toContain("Container launched");
    });

    it("shows 'container finished' with elapsed time", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      writeFileSync(logFile, makePinoLine({ msg: "container finished", elapsed: "42s" }) + "\n");

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "50" });
      console.log = origLog;

      expect(output).toHaveLength(1);
      expect(output[0]).toContain("Container finished");
      expect(output[0]).toContain("42s");
    });

    it("shows 'container finished (rerun requested)' variant", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      writeFileSync(logFile, makePinoLine({ msg: "container finished (rerun requested)" }) + "\n");

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "50" });
      console.log = origLog;

      expect(output).toHaveLength(1);
      expect(output[0]).toContain("Container finished");
    });

    it("shows 'container starting' with agent name and model", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      writeFileSync(logFile, makePinoLine({ msg: "container starting", agentName: "dev", modelId: "claude-sonnet-4" }) + "\n");

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "50" });
      console.log = origLog;

      expect(output).toHaveLength(1);
      expect(output[0]).toContain("Container starting: dev");
      expect(output[0]).toContain("claude-sonnet-4");
    });

    it("shows 'container starting' without model", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      writeFileSync(logFile, makePinoLine({ msg: "container starting", agentName: "dev" }) + "\n");

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "50" });
      console.log = origLog;

      expect(output).toHaveLength(1);
      expect(output[0]).toContain("Container starting: dev");
    });

    it("shows 'creating agent session' in dim text", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      writeFileSync(logFile, makePinoLine({ msg: "creating agent session" }) + "\n");

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "50" });
      console.log = origLog;

      expect(output).toHaveLength(1);
      expect(output[0]).toContain("creating agent session");
    });

    it("shows 'session created, sending prompt' in dim text", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      writeFileSync(logFile, makePinoLine({ msg: "session created, sending prompt" }) + "\n");

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "50" });
      console.log = origLog;

      expect(output).toHaveLength(1);
      expect(output[0]).toContain("session created, sending prompt");
    });

    it("shows 'run completed, rerun requested' with yellow suffix", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      writeFileSync(logFile, makePinoLine({ msg: "run completed, rerun requested" }) + "\n");

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "50" });
      console.log = origLog;

      expect(output).toHaveLength(1);
      expect(output[0]).toContain("Run completed");
      // Yellow color for rerun suffix
      expect(output[0]).toContain("\x1b[33m");
      expect(output[0]).toContain("rerun requested");
    });

    it("shows error entries with error field and stack trace", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      writeFileSync(logFile, makePinoLine({
        level: 50,
        msg: "unhandled error",
        error: "TypeError: Cannot read property",
        stack: "at foo (index.ts:10)",
      }) + "\n");

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "50" });
      console.log = origLog;

      expect(output).toHaveLength(1);
      expect(output[0]).toContain("ERROR: unhandled error");
      expect(output[0]).toContain("TypeError: Cannot read property");
      expect(output[0]).toContain("at foo (index.ts:10)");
    });

    it("shows WARN level messages in yellow", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      writeFileSync(logFile, makePinoLine({ level: 40, msg: "low disk space" }) + "\n");

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "50" });
      console.log = origLog;

      expect(output).toHaveLength(1);
      expect(output[0]).toContain("\x1b[33m");
      expect(output[0]).toContain("WARN: low disk space");
    });

    it("shows catch-all info messages in dim", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      writeFileSync(logFile, makePinoLine({ msg: "gateway started on port 8080" }) + "\n");

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "50" });
      console.log = origLog;

      expect(output).toHaveLength(1);
      expect(output[0]).toContain("gateway started on port 8080");
    });

    it("shows instance tag in entry output", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      writeFileSync(logFile, makePinoLine({ msg: "bash", cmd: "ls", instance: "dev-a1b2c3d4" }) + "\n");

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "50" });
      console.log = origLog;

      expect(output).toHaveLength(1);
      expect(output[0]).toContain("[dev-a1b2c3d4]");
    });

    it("shows tool error without cmd or result", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      writeFileSync(logFile, makePinoLine({ msg: "tool error", tool: "read_file", level: 50 }) + "\n");

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "50" });
      console.log = origLog;

      expect(output).toHaveLength(1);
      expect(output[0]).toContain("✗ read_file failed");
    });
  });

  // ── Container log format (parseLine) ────────────────────────────────────

  describe("container log format parsing", () => {
    it("parses container-format entries (_log: true, level as string)", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      const containerLine = JSON.stringify({
        _log: true,
        level: "info",
        msg: "bash",
        cmd: "docker ps",
        ts: Date.now(),
      });
      writeFileSync(logFile, containerLine + "\n");

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "50" });
      console.log = origLog;

      expect(output).toHaveLength(1);
      expect(output[0]).toContain("$ docker ps");
    });

    it("filters out Lambda/CloudWatch platform lines", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      const content = [
        "START RequestId: abc123",
        makePinoLine({ msg: "bash", cmd: "echo real" }),
        "END RequestId: abc123",
        "REPORT RequestId: abc123 Duration: 100ms",
        "INIT_START Runtime: nodejs18.x",
        "EXTENSION something",
      ].join("\n") + "\n";
      writeFileSync(logFile, content);

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "50" });
      console.log = origLog;

      // Only the real log line should appear
      expect(output).toHaveLength(1);
      expect(output[0]).toContain("$ echo real");
    });

    it("uses default level 30 for unknown container log levels", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      const containerLine = JSON.stringify({
        _log: true,
        level: "verbose", // not in LEVEL_NAME_TO_NUM
        msg: "some verbose message",
        ts: Date.now(),
      });
      writeFileSync(logFile, containerLine + "\n");

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "50" });
      console.log = origLog;

      expect(output).toHaveLength(1);
      expect(output[0]).toContain("some verbose message");
    });
  });

  // ── Instance filtering ────────────────────────────────────────────────────

  describe("instance filtering (--instance)", () => {
    it("filters to only entries matching the instance suffix", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      const content = [
        makePinoLine({ msg: "bash", cmd: "echo from instance 1", instance: "dev-aabbccdd" }),
        makePinoLine({ msg: "bash", cmd: "echo from instance 2", instance: "dev-11223344" }),
        makePinoLine({ msg: "bash", cmd: "echo no instance" }),
      ].join("\n") + "\n";
      writeFileSync(logFile, content);

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "50", instance: "aabbccdd" });
      console.log = origLog;

      expect(output).toHaveLength(1);
      expect(output[0]).toContain("echo from instance 1");
    });

    it("accepts full instance ID (with agent prefix)", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      const content = [
        makePinoLine({ msg: "bash", cmd: "echo target", instance: "dev-aabbccdd" }),
        makePinoLine({ msg: "bash", cmd: "echo other", instance: "dev-11223344" }),
      ].join("\n") + "\n";
      writeFileSync(logFile, content);

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      // Pass the full instance ID "dev-aabbccdd" (with agent prefix)
      await execute("dev", { project: tmpDir, lines: "50", instance: "dev-aabbccdd" });
      console.log = origLog;

      expect(output).toHaveLength(1);
      expect(output[0]).toContain("echo target");
    });
  });

  // ── Raw formatter edge cases ──────────────────────────────────────────────

  describe("raw formatter edge cases", () => {
    it("shows instance tag in raw mode", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      writeFileSync(logFile, makePinoLine({ msg: "my message", instance: "dev-a1b2c3d4" }) + "\n");

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "50", raw: true });
      console.log = origLog;

      expect(output).toHaveLength(1);
      expect(output[0]).toContain("[dev-a1b2c3d4]");
    });

    it("handles unknown log levels in raw mode", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      writeFileSync(logFile, makePinoLine({ level: 99, msg: "custom level message" }) + "\n");

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "50", raw: true });
      console.log = origLog;

      expect(output).toHaveLength(1);
      expect(output[0]).toContain("L99");
      expect(output[0]).toContain("custom level message");
    });
  });

  // ── Yesterday fallback ────────────────────────────────────────────────────

  it("falls back to yesterday log file when today's is missing", async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const logFile = resolve(tmpDir, ".al", "logs", `dev-${yesterday}.log`);
    writeFileSync(logFile, makePinoLine({ msg: "bash", cmd: "echo yesterday" }) + "\n");

    const output: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => output.push(args.join(" "));
    await execute("dev", { project: tmpDir, lines: "50" });
    console.log = origLog;

    expect(output).toHaveLength(1);
    expect(output[0]).toContain("echo yesterday");
  });

  // ── Additional uncovered paths ───────────────────────────────────────────

  describe("additional uncovered paths", () => {
    it("skips debug entries that are not 'tool start' and not in SKIP_MESSAGES", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      const content = [
        makePinoLine({ level: 20, msg: "some internal debug message" }), // debug, not tool start, not in SKIP_MESSAGES
        makePinoLine({ msg: "run completed" }),
      ].join("\n") + "\n";
      writeFileSync(logFile, content);

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "50" });
      console.log = origLog;

      // Debug entry should be skipped; only run completed should appear
      expect(output).toHaveLength(1);
      expect(output[0]).toContain("Run completed");
    });

    it("shows error entries with extra fields beyond error and stack", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      writeFileSync(logFile, makePinoLine({
        level: 50,
        msg: "container crashed",
        exitCode: 137,
        signal: "SIGKILL",
      }) + "\n");

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "50" });
      console.log = origLog;

      expect(output).toHaveLength(1);
      expect(output[0]).toContain("ERROR: container crashed");
      // Extra fields (exitCode, signal) should appear in the output
      expect(output[0]).toContain("exitCode");
    });

    it("returns null from findLogFile when logs directory does not exist at all", async () => {
      // Create a project dir WITHOUT creating the .al/logs subdirectory
      const noLogsDir = mkdtempSync(join(tmpdir(), "al-nodir-"));
      // .al/logs does NOT exist here

      const origExit = process.exit;
      const origError = console.error;
      let exitCode: number | undefined;
      let errorMsg = "";

      process.exit = ((code?: number) => {
        exitCode = code;
        throw new Error("EXIT");
      }) as any;
      console.error = (...args: any[]) => { errorMsg = args.join(" "); };

      try {
        await execute("dev", { project: noLogsDir, lines: "50" });
      } catch {
        // Expected EXIT thrown from process.exit mock
      } finally {
        process.exit = origExit;
        console.error = origError;
        rmSync(noLogsDir, { recursive: true, force: true });
      }

      expect(exitCode).toBe(1);
      expect(errorMsg).toContain("dev");
    });

    it("handles empty log file gracefully (returns no output)", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      writeFileSync(logFile, ""); // empty file — 0 bytes

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "50" });
      console.log = origLog;

      expect(output).toHaveLength(0);
    });

    it("shifts oldest entries out when run header pushes entries over n limit", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      const t = Date.now();
      // Write 5 assistant entries + 1 run-start + 1 assistant to exceed limit of 5
      const lines = [
        makePinoLine({ msg: "assistant", text: "msg 1", time: t }),
        makePinoLine({ msg: "assistant", text: "msg 2", time: t + 1000 }),
        makePinoLine({ msg: "assistant", text: "msg 3", time: t + 2000 }),
        makePinoLine({ msg: "assistant", text: "msg 4", time: t + 3000 }),
        makePinoLine({ msg: "assistant", text: "msg 5", time: t + 4000 }),
        // run-start entry generates both a header AND a formatted entry,
        // so when header is pushed entries.length exceeds n → shift
        makePinoLine({ msg: "Starting dev run (schedule)", time: t + 5000, name: "dev" }),
        makePinoLine({ msg: "assistant", text: "msg 7", time: t + 6000 }),
      ];
      writeFileSync(logFile, lines.join("\n") + "\n");

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "5" });
      console.log = origLog;

      // Should produce exactly 5 entries (overflow causes oldest to be dropped)
      expect(output).toHaveLength(5);
      // The last entry should be msg 7
      expect(output[output.length - 1]).toContain("msg 7");
    });
  });

  // ── --grep filtering ──────────────────────────────────────────────────────

  describe("--grep filtering (local file path)", () => {
    it("filters entries matching the grep pattern", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      const t = Date.now();
      const content = [
        makePinoLine({ msg: "bash", cmd: "deploy", time: t }),
        makePinoLine({ msg: "bash", cmd: "echo hello", time: t + 1000 }),
        makePinoLine({ msg: "bash", cmd: "deploy again", time: t + 2000 }),
        makePinoLine({ msg: "run completed", time: t + 3000 }),
      ].join("\n") + "\n";
      writeFileSync(logFile, content);

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "50", grep: "deploy" });
      console.log = origLog;

      // Only lines containing "deploy" in their JSON representation
      expect(output).toHaveLength(2);
      expect(output[0]).toContain("deploy");
      expect(output[1]).toContain("deploy");
    });

    it("grep searches the full JSON line (including non-msg fields)", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      const t = Date.now();
      const content = [
        makePinoLine({ msg: "bash", cmd: "docker ps", time: t }),
        makePinoLine({ msg: "bash", cmd: "ls -la", time: t + 1000 }),
      ].join("\n") + "\n";
      writeFileSync(logFile, content);

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      // Search for "docker" in the cmd field (not msg)
      await execute("dev", { project: tmpDir, lines: "50", grep: "docker" });
      console.log = origLog;

      expect(output).toHaveLength(1);
      expect(output[0]).toContain("docker ps");
    });

    it("exits with error on invalid grep pattern", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      writeFileSync(logFile, makePinoLine({ msg: "test" }) + "\n");

      const origExit = process.exit;
      const origError = console.error;
      let exitCode: number | undefined;
      let errorMsg = "";

      process.exit = ((code?: number) => { exitCode = code; throw new Error("EXIT"); }) as any;
      console.error = (...args: any[]) => { errorMsg = args.join(" "); };

      try {
        await execute("dev", { project: tmpDir, lines: "50", grep: "[invalid" });
      } catch {
        // expected EXIT thrown
      } finally {
        process.exit = origExit;
        console.error = origError;
      }

      expect(exitCode).toBe(1);
      expect(errorMsg).toContain("Invalid grep pattern");
    });
  });

  // ── --after / --before filtering ─────────────────────────────────────────

  describe("--after / --before filtering (local file path)", () => {
    it("filters entries with --after (relative duration)", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      // Create entries: 5 hours ago and 1 hour ago
      const now = Date.now();
      const content = [
        makePinoLine({ msg: "bash", cmd: "echo old", time: now - 5 * 3_600_000 }),
        makePinoLine({ msg: "bash", cmd: "echo recent", time: now - 1 * 3_600_000 }),
      ].join("\n") + "\n";
      writeFileSync(logFile, content);

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "50", after: "2h" });
      console.log = origLog;

      // Only the entry within the last 2 hours
      expect(output).toHaveLength(1);
      expect(output[0]).toContain("echo recent");
    });

    it("filters entries with --before (ISO date string)", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      const cutoff = new Date("2025-03-28T12:00:00Z").getTime();
      const content = [
        makePinoLine({ msg: "bash", cmd: "echo before cutoff", time: cutoff - 1000 }),
        makePinoLine({ msg: "bash", cmd: "echo after cutoff", time: cutoff + 1000 }),
      ].join("\n") + "\n";
      writeFileSync(logFile, content);

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "50", before: "2025-03-28T12:00:00Z" });
      console.log = origLog;

      expect(output).toHaveLength(1);
      expect(output[0]).toContain("echo before cutoff");
    });

    it("filters entries with both --after and --before", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      const base = new Date("2025-03-28T10:00:00Z").getTime();
      const content = [
        makePinoLine({ msg: "bash", cmd: "msg A", time: base }),           // 10:00 (excluded: not strictly after 10:00)
        makePinoLine({ msg: "bash", cmd: "msg B", time: base + 3_600_000 }), // 11:00 (included)
        makePinoLine({ msg: "bash", cmd: "msg C", time: base + 2 * 3_600_000 }), // 12:00 (included)
        makePinoLine({ msg: "bash", cmd: "msg D", time: base + 3 * 3_600_000 }), // 13:00 (excluded: not strictly before 13:00)
      ].join("\n") + "\n";
      writeFileSync(logFile, content);

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "50", after: "2025-03-28T10:00:00Z", before: "2025-03-28T13:00:00Z" });
      console.log = origLog;

      // Entries strictly after 10:00 and strictly before 13:00 → msg B and msg C
      expect(output).toHaveLength(2);
      expect(output[0]).toContain("msg B");
      expect(output[1]).toContain("msg C");
    });

    it("exits with error on invalid --after value", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      writeFileSync(logFile, makePinoLine({ msg: "test" }) + "\n");

      const origExit = process.exit;
      const origError = console.error;
      let exitCode: number | undefined;
      let errorMsg = "";

      process.exit = ((code?: number) => { exitCode = code; throw new Error("EXIT"); }) as any;
      console.error = (...args: any[]) => { errorMsg = args.join(" "); };

      try {
        await execute("dev", { project: tmpDir, lines: "50", after: "not-a-time" });
      } catch {
        // expected EXIT
      } finally {
        process.exit = origExit;
        console.error = origError;
      }

      expect(exitCode).toBe(1);
      expect(errorMsg).toContain("Invalid time value");
    });

    it("accepts ISO date string for --after", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      const cutoff = new Date("2025-03-28T12:00:00Z").getTime();
      const content = [
        makePinoLine({ msg: "bash", cmd: "echo before", time: cutoff - 1000 }),
        makePinoLine({ msg: "bash", cmd: "echo after", time: cutoff + 1000 }),
      ].join("\n") + "\n";
      writeFileSync(logFile, content);

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "50", after: "2025-03-28T12:00:00Z" });
      console.log = origLog;

      expect(output).toHaveLength(1);
      expect(output[0]).toContain("echo after");
    });

    it("accepts day-based relative duration for --after", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      const now = Date.now();
      const content = [
        makePinoLine({ msg: "bash", cmd: "echo too old", time: now - 10 * 86_400_000 }),
        makePinoLine({ msg: "bash", cmd: "echo recent", time: now - 1 * 86_400_000 }),
      ].join("\n") + "\n";
      writeFileSync(logFile, content);

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "50", after: "7d" });
      console.log = origLog;

      expect(output).toHaveLength(1);
      expect(output[0]).toContain("echo recent");
    });
  });

  // ── --grep combined with --after / --before ───────────────────────────────

  describe("--grep combined with --after / --before", () => {
    it("applies both time range and grep filter", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      const now = Date.now();
      const content = [
        makePinoLine({ msg: "bash", cmd: "echo error old", time: now - 5 * 3_600_000 }),
        makePinoLine({ msg: "bash", cmd: "echo hello recent", time: now - 1 * 3_600_000 }),
        makePinoLine({ msg: "bash", cmd: "echo error recent", time: now - 30 * 60_000 }),
      ].join("\n") + "\n";
      writeFileSync(logFile, content);

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "50", after: "2h", grep: "error" });
      console.log = origLog;

      // Only the "error recent" entry is both within 2h AND matches "error"
      expect(output).toHaveLength(1);
      expect(output[0]).toContain("echo error recent");
    });
  });

});
