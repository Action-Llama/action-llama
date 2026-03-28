import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";

// This test file exercises the gateway-connected path in logs.ts.
// The mock is a vi.fn() so each test can control the response.
const mockGatewayFetch = vi.fn();

vi.mock("../../../src/cli/gateway-client.js", () => ({
  gatewayFetch: (...args: any[]) => mockGatewayFetch(...args),
}));

import { execute } from "../../../src/cli/commands/logs.js";

function makePinoEntry(overrides: Record<string, unknown> = {}) {
  return {
    level: 30,
    time: Date.now(),
    msg: "test message",
    name: "dev",
    pid: 1,
    hostname: "localhost",
    ...overrides,
  };
}

function makeGatewayResponse(entries: object[], cursor: string | null = null, hasMore = false) {
  return {
    ok: true,
    json: async () => ({ entries, cursor, hasMore }),
  };
}

describe("logs command — gateway path", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-logs-gw-"));
    mkdirSync(resolve(tmpDir, ".al", "logs"), { recursive: true });
    mockGatewayFetch.mockReset();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Non-follow mode ──────────────────────────────────────────────────────

  describe("non-follow mode", () => {
    it("fetches and displays entries from the gateway", async () => {
      const entries = [
        makePinoEntry({ msg: "bash", cmd: "gh issue list" }),
        makePinoEntry({ msg: "run completed" }),
      ];
      mockGatewayFetch.mockResolvedValueOnce(makeGatewayResponse(entries));

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "50" });
      console.log = origLog;

      expect(output.some((l) => l.includes("$ gh issue list"))).toBe(true);
      expect(output.some((l) => l.includes("Run completed"))).toBe(true);
    });

    it("shows 'No log entries found' when gateway returns empty entries", async () => {
      mockGatewayFetch.mockResolvedValueOnce(makeGatewayResponse([]));

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "50" });
      console.log = origLog;

      expect(output).toHaveLength(1);
      expect(output[0]).toContain('No log entries found for "dev"');
    });

    it("falls back to file reading when gateway returns non-ok status", async () => {
      // Gateway returns bad status → throws → falls back to file
      mockGatewayFetch.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });

      const date = new Date().toISOString().slice(0, 10);
      const logFile = resolve(tmpDir, ".al", "logs", `dev-${date}.log`);
      writeFileSync(logFile, JSON.stringify({
        level: 30, time: Date.now(), msg: "bash", cmd: "echo fallback", name: "dev", pid: 1, hostname: "h",
      }) + "\n");

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "50" });
      console.log = origLog;

      expect(output.some((l) => l.includes("echo fallback"))).toBe(true);
    });

    it("uses /api/logs/scheduler path for the scheduler agent", async () => {
      let calledPath = "";
      mockGatewayFetch.mockImplementation(async (opts: { path: string }) => {
        calledPath = opts.path;
        return { ok: true, json: async () => ({ entries: [], cursor: null, hasMore: false }) };
      });

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("scheduler", { project: tmpDir, lines: "10" });
      console.log = origLog;

      expect(calledPath).toContain("/api/logs/scheduler");
    });

    it("includes instance suffix in API path when --instance is provided", async () => {
      let calledPath = "";
      mockGatewayFetch.mockImplementation(async (opts: { path: string }) => {
        calledPath = opts.path;
        return { ok: true, json: async () => ({ entries: [], cursor: null, hasMore: false }) };
      });

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "10", instance: "a1b2c3d4" });
      console.log = origLog;

      expect(calledPath).toContain("/api/logs/agents/dev/a1b2c3d4");
    });

    it("includes run header for run-start entries from gateway", async () => {
      const entries = [
        makePinoEntry({ msg: "Starting dev run (schedule)", container: "al-dev-abc1", name: "dev" }),
        makePinoEntry({ msg: "assistant", text: "Working on it." }),
      ];
      mockGatewayFetch.mockResolvedValueOnce(makeGatewayResponse(entries));

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "50" });
      console.log = origLog;

      // Header + Starting + assistant
      expect(output.some((l) => l.includes("──"))).toBe(true);
      expect(output.some((l) => l.includes("Starting dev run"))).toBe(true);
      expect(output.some((l) => l.includes("Working on it."))).toBe(true);
    });

    it("works with raw mode from gateway", async () => {
      const entries = [
        makePinoEntry({ msg: "raw info message", level: 30 }),
      ];
      mockGatewayFetch.mockResolvedValueOnce(makeGatewayResponse(entries));

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "50", raw: true });
      console.log = origLog;

      expect(output).toHaveLength(1);
      expect(output[0]).toContain("raw info message");
    });

    it("works with --all mode from gateway (shows debug entries)", async () => {
      const entries = [
        makePinoEntry({ msg: "tool done", level: 20, tool: "bash" }),
        makePinoEntry({ msg: "run completed" }),
      ];
      mockGatewayFetch.mockResolvedValueOnce(makeGatewayResponse(entries));

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "50", all: true });
      console.log = origLog;

      // Both entries should appear in --all mode
      expect(output.some((l) => l.includes("tool done"))).toBe(true);
      expect(output.some((l) => l.includes("Run completed"))).toBe(true);
    });
  });
});
