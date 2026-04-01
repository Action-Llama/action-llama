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

    it("includes full instance ID in API path when full instance ID is passed as positional arg", async () => {
      let calledPath = "";
      mockGatewayFetch.mockImplementation(async (opts: { path: string }) => {
        calledPath = opts.path;
        return { ok: true, json: async () => ({ entries: [], cursor: null, hasMore: false }) };
      });

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      // Pass the full instance ID as the positional agent arg
      await execute("dev-a1b2c3d4", { project: tmpDir, lines: "10" });
      console.log = origLog;

      expect(calledPath).toContain("/api/logs/agents/dev/dev-a1b2c3d4");
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
      expect(output.some((l) => l.includes("✓ bash"))).toBe(true);
      expect(output.some((l) => l.includes("Run completed"))).toBe(true);
    });
  });

  // ── --after / --before passed as query params ────────────────────────────

  describe("--after / --before forwarded to gateway", () => {
    it("passes after as Unix timestamp query param", async () => {
      let calledPath = "";
      mockGatewayFetch.mockImplementation(async (opts: { path: string }) => {
        calledPath = opts.path;
        return { ok: true, json: async () => ({ entries: [], cursor: null, hasMore: false }) };
      });

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "50", after: "2h" });
      console.log = origLog;

      expect(calledPath).toContain("after=");
      // Verify it's a numeric Unix timestamp in the URL
      const match = calledPath.match(/after=(\d+)/);
      expect(match).not.toBeNull();
      const ts = parseInt(match![1], 10);
      // Should be roughly 2 hours ago (within 10 second tolerance)
      expect(ts).toBeGreaterThan(Date.now() - 2 * 3_600_000 - 10_000);
      expect(ts).toBeLessThan(Date.now() - 2 * 3_600_000 + 10_000);
    });

    it("passes before as Unix timestamp query param", async () => {
      let calledPath = "";
      mockGatewayFetch.mockImplementation(async (opts: { path: string }) => {
        calledPath = opts.path;
        return { ok: true, json: async () => ({ entries: [], cursor: null, hasMore: false }) };
      });

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "50", before: "2025-03-28T12:00:00Z" });
      console.log = origLog;

      expect(calledPath).toContain("before=");
      const match = calledPath.match(/before=(\d+)/);
      expect(match).not.toBeNull();
      expect(parseInt(match![1], 10)).toBe(new Date("2025-03-28T12:00:00Z").getTime());
    });
  });

  // ── --follow mode via gateway (lines 514-543 in logs.ts) ─────────────────

  describe("--follow mode via gateway", () => {
    let mockProcessOn: ReturnType<typeof vi.spyOn>;
    let mockProcessExit: ReturnType<typeof vi.spyOn>;
    let capturedSigintHandler: ((...args: any[]) => void) | undefined;

    beforeEach(() => {
      capturedSigintHandler = undefined;
      vi.useFakeTimers();

      // Capture the SIGINT listener without actually registering it on process,
      // so it doesn't leak across tests or interfere with Vitest's own signal handlers.
      mockProcessOn = vi.spyOn(process, "on").mockImplementation((event: any, listener: any) => {
        if (String(event) === "SIGINT") {
          capturedSigintHandler = listener;
        }
        return process;
      });

      // Prevent process.exit from terminating the test runner.
      mockProcessExit = vi.spyOn(process, "exit").mockImplementation((_code?: any) => {
        return undefined as never;
      });

      mockGatewayFetch.mockReset();
    });

    afterEach(() => {
      mockProcessOn.mockRestore();
      mockProcessExit.mockRestore();
      vi.useRealTimers();
    });

    it("fetches and displays initial entries in follow mode, then exits cleanly on SIGINT", async () => {
      const entries = [
        makePinoEntry({ msg: "bash", cmd: "git push origin main" }),
        makePinoEntry({ msg: "run completed" }),
      ];
      mockGatewayFetch.mockResolvedValueOnce(makeGatewayResponse(entries, "cursor-abc"));

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));

      // Start follow mode — do NOT await; it blocks forever on `await new Promise(() => {})`
      execute("dev", { project: tmpDir, lines: "50", follow: true });

      // Advance fake clock by 0ms — this flushes pending microtasks (dynamic import +
      // gatewayFetch + res.json()) without triggering the 1s poll interval.
      await vi.advanceTimersByTimeAsync(0);

      console.log = origLog;

      // Initial entries must have been displayed
      expect(output.some((l) => l.includes("git push origin main"))).toBe(true);
      expect(output.some((l) => l.includes("Run completed"))).toBe(true);

      // SIGINT handler must have been registered
      expect(capturedSigintHandler).toBeDefined();

      // Trigger SIGINT — should call clearInterval + process.exit(0)
      capturedSigintHandler!();
      expect(mockProcessExit).toHaveBeenCalledWith(0);
    });

    it("polls for new entries every second using the cursor from the previous response", async () => {
      const initialEntries = [makePinoEntry({ msg: "bash", cmd: "npm test" })];
      const pollEntries = [makePinoEntry({ msg: "bash", cmd: "npm run build" })];

      mockGatewayFetch
        .mockResolvedValueOnce(makeGatewayResponse(initialEntries, "cursor-1"))
        .mockResolvedValueOnce(makeGatewayResponse(pollEntries, "cursor-2"));

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));

      execute("dev", { project: tmpDir, lines: "50", follow: true });

      // Flush initial fetch microtasks (import + fetch + json)
      await vi.advanceTimersByTimeAsync(0);

      // Advance fake timers by 1 second to trigger the poll interval and flush poll microtasks
      await vi.advanceTimersByTimeAsync(1000);

      console.log = origLog;

      // Both initial and polled entries should appear
      expect(output.some((l) => l.includes("npm test"))).toBe(true);
      expect(output.some((l) => l.includes("npm run build"))).toBe(true);

      // Poll must have included the cursor from the initial response
      expect(mockGatewayFetch).toHaveBeenCalledTimes(2);
      const pollCallPath: string = mockGatewayFetch.mock.calls[1][0].path;
      expect(pollCallPath).toContain("cursor=cursor-1");

      capturedSigintHandler?.();
    });

    it("updates the cursor after each successful poll", async () => {
      const entries1 = [makePinoEntry({ msg: "bash", cmd: "step-1" })];
      const entries2 = [makePinoEntry({ msg: "bash", cmd: "step-2" })];
      const entries3 = [makePinoEntry({ msg: "bash", cmd: "step-3" })];

      mockGatewayFetch
        .mockResolvedValueOnce(makeGatewayResponse(entries1, "cur-1"))
        .mockResolvedValueOnce(makeGatewayResponse(entries2, "cur-2"))
        .mockResolvedValueOnce(makeGatewayResponse(entries3, "cur-3"));

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));

      execute("dev", { project: tmpDir, lines: "50", follow: true });
      await vi.advanceTimersByTimeAsync(0); // Flush initial fetch

      // First poll
      await vi.advanceTimersByTimeAsync(1000);

      // Second poll
      await vi.advanceTimersByTimeAsync(1000);

      console.log = origLog;

      expect(output.some((l) => l.includes("step-1"))).toBe(true);
      expect(output.some((l) => l.includes("step-2"))).toBe(true);
      expect(output.some((l) => l.includes("step-3"))).toBe(true);

      // Second poll must use cursor from first poll response
      const poll2Path: string = mockGatewayFetch.mock.calls[2][0].path;
      expect(poll2Path).toContain("cursor=cur-2");

      capturedSigintHandler?.();
    });

    it("silently retries on poll network failure without crashing", async () => {
      const initialEntries = [makePinoEntry({ msg: "bash", cmd: "echo start" })];

      mockGatewayFetch
        .mockResolvedValueOnce(makeGatewayResponse(initialEntries, "cursor-x"))
        .mockRejectedValueOnce(new Error("network error")); // poll fails

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));

      execute("dev", { project: tmpDir, lines: "50", follow: true });
      await vi.advanceTimersByTimeAsync(0); // Flush initial fetch

      // Advance to trigger poll (will fail silently in catch block)
      await vi.advanceTimersByTimeAsync(1000);

      console.log = origLog;

      // Initial entries should still appear; test must not throw
      expect(output.some((l) => l.includes("echo start"))).toBe(true);

      // Clean up
      capturedSigintHandler?.();
    });

    it("includes grep param in poll requests", async () => {
      const calledPaths: string[] = [];
      mockGatewayFetch.mockImplementation(async (opts: { path: string }) => {
        calledPaths.push(opts.path);
        return makeGatewayResponse([], "cursor-g");
      });

      execute("dev", { project: tmpDir, lines: "50", follow: true, grep: "deploy" });
      await vi.advanceTimersByTimeAsync(0); // Flush initial fetch

      await vi.advanceTimersByTimeAsync(1000); // Trigger poll

      // Both initial fetch and poll should include grep param
      expect(calledPaths[0]).toContain("grep=deploy");
      expect(calledPaths[1]).toContain("grep=deploy");

      capturedSigintHandler?.();
    });
  });

  // ── --grep forwarded to gateway + client-side filtering ──────────────────

  describe("--grep with gateway", () => {
    it("passes grep pattern as query param to gateway", async () => {
      let calledPath = "";
      mockGatewayFetch.mockImplementation(async (opts: { path: string }) => {
        calledPath = opts.path;
        return { ok: true, json: async () => ({ entries: [], cursor: null, hasMore: false }) };
      });

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "50", grep: "deploy" });
      console.log = origLog;

      expect(calledPath).toContain("grep=deploy");
    });

    it("applies client-side grep filtering on entries returned by gateway", async () => {
      const entries = [
        makePinoEntry({ msg: "bash", cmd: "deploy to prod" }),
        makePinoEntry({ msg: "bash", cmd: "echo hello" }),
        makePinoEntry({ msg: "bash", cmd: "deploy to staging" }),
      ];
      mockGatewayFetch.mockResolvedValueOnce(makeGatewayResponse(entries));

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "50", grep: "deploy" });
      console.log = origLog;

      expect(output).toHaveLength(2);
      expect(output.every((l) => l.includes("deploy"))).toBe(true);
    });

    it("shows 'No log entries found' when grep filters out all entries", async () => {
      const entries = [
        makePinoEntry({ msg: "bash", cmd: "echo hello" }),
      ];
      mockGatewayFetch.mockResolvedValueOnce(makeGatewayResponse(entries));

      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: any[]) => output.push(args.join(" "));
      await execute("dev", { project: tmpDir, lines: "50", grep: "deploy" });
      console.log = origLog;

      expect(output).toHaveLength(1);
      expect(output[0]).toContain("No log entries found");
    });
  });
});
