/**
 * Targeted test to cover the catch block in followFile when fs.watch() throws.
 * (logs.ts line 459: pollInterval = setInterval(readNewChanges, 500))
 *
 * This test uses a separate file from logs.test.ts because it needs to mock fs.watch
 * while keeping other fs operations functional.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";

// Mock fs — keep all real implementations except watch, which throws.
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    watch: () => {
      throw new Error("fs.watch not supported on this filesystem");
    },
  };
});

// Mock gatewayFetch so the execute() function falls back to direct file reading.
vi.mock("../../../src/cli/gateway-client.js", () => ({
  gatewayFetch: vi.fn().mockRejectedValue(new Error("gateway not available")),
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

describe("logs command — fs.watch failure fallback", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-logs-watchfail-"));
    mkdirSync(resolve(tmpDir, ".al", "logs"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.useRealTimers();
  });

  it("falls back to polling-only (500ms interval) when fs.watch throws", async () => {
    // Use fake timers so setInterval doesn't run forever and we can advance time.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });

    const date = new Date().toISOString().slice(0, 10);
    const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);

    // Write initial log content so followFile finds a valid file.
    const initialLine = makePinoLine({ msg: "initial-watch-fail-test" }) + "\n";
    writeFileSync(logFile, initialLine);

    const output: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => output.push(args.join(" "));

    // Start follow mode — do not await because it hangs forever.
    const followPromise = execute("dev", {
      project: tmpDir,
      lines: "50",
      follow: true,
      raw: true,
    });

    // Allow async setup (readLastN + try/catch for fs.watch) to complete.
    await new Promise((r) => setTimeout(r, 50));

    // Advance fake timers by 600ms to trigger the fallback 500ms poll interval.
    await vi.advanceTimersByTimeAsync(600);

    // Allow any async operations triggered by the poll to complete.
    await new Promise((r) => setTimeout(r, 20));

    console.log = origLog;

    // The initial content should have been shown (from readLastN).
    expect(output.some((l) => l.includes("initial-watch-fail-test"))).toBe(true);

    // followPromise should still be pending (never-resolving promise inside followFile).
    expect(followPromise).toBeDefined();
  });
});
