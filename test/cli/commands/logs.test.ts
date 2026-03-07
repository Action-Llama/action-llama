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

    await execute("dev", { project: tmpDir, lines: "5" });

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

    await execute("dev", { project: tmpDir, lines: "50" });

    console.log = origLog;

    expect(output).toHaveLength(2);
    expect(output[0]).toContain("good line 1");
    expect(output[1]).toContain("good line 2");
  });

  it("reads a specific date's log file", async () => {
    const logFile = resolve(tmpDir, ".al", "logs", "dev-2025-01-15.log");
    writeFileSync(logFile, makePinoLine({ msg: "old entry" }) + "\n");

    const output: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => output.push(args.join(" "));

    await execute("dev", { project: tmpDir, lines: "50", date: "2025-01-15" });

    console.log = origLog;

    expect(output).toHaveLength(1);
    expect(output[0]).toContain("old entry");
  });

  it("finds most recent log when today has no file", async () => {
    const logFile = resolve(tmpDir, ".al", "logs", "dev-2025-06-01.log");
    writeFileSync(logFile, makePinoLine({ msg: "recent entry" }) + "\n");

    // Remove today's file (don't create one)
    const output: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => output.push(args.join(" "));

    await execute("dev", { project: tmpDir, lines: "50" });

    console.log = origLog;

    expect(output).toHaveLength(1);
    expect(output[0]).toContain("recent entry");
  });

  it("exits with error for missing agent", async () => {
    const origExit = process.exit;
    const origError = console.error;
    let exitCode: number | undefined;
    let errorOutput = "";

    // process.exit mock must throw to prevent continued execution
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

    await execute("dev", { project: tmpDir, lines: "50" });

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

    await execute("dev", { project: tmpDir, lines: "50" });

    console.log = origLog;

    expect(output[0]).toContain("al foo");
  });

  it("follows cloud logs when --follow is used", async () => {
    // Create minimal config for cloud mode
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
      // This will fail because we don't have real AWS credentials
      // But we can verify it attempts to follow cloud logs
      await execute("dev", { 
        project: tmpDir, 
        lines: "10", 
        follow: true, 
        cloud: true 
      });
    } catch (e: any) {
      // Expected - will fail when trying to contact AWS
    }

    console.log = origLog;
    
    // Verify that it tried to look for running agents (our new cloud follow code)
    expect(output.some(line => line.includes("Looking for running dev agent"))).toBe(true);
  });

  it("fetches static cloud logs when --follow is not used", async () => {
    // Create minimal config for cloud mode
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
      // This will fail because we don't have real AWS credentials
      // But we can verify it attempts to fetch static logs (original behavior)
      await execute("dev", { 
        project: tmpDir, 
        lines: "10", 
        cloud: true 
      });
    } catch (e: any) {
      // Expected - will fail when trying to contact AWS
    }

    console.log = origLog;
    
    // Verify that it tried to fetch cloud logs (original behavior, not follow)
    expect(output.some(line => line.includes("Fetching cloud logs for dev"))).toBe(true);
  });
});
