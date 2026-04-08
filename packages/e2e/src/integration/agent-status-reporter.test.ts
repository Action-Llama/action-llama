/**
 * Integration tests: agents/status-reporter.ts and agents/bash-prefix.ts
 * — no Docker required.
 *
 * 1. AgentStatusReporter (agents/status-reporter.ts)
 *    A thin wrapper around StatusTracker. It delegates all calls to the
 *    optional StatusTracker, returning defaults when none is configured.
 *    Has ZERO existing test coverage.
 *
 *    Test scenarios:
 *      - All methods are no-ops when no StatusTracker provided
 *      - isAgentEnabled() returns true when no StatusTracker
 *      - Methods delegate to StatusTracker when provided (via mock)
 *      - isAgentEnabled() delegates to StatusTracker when provided
 *
 * 2. agents/bash-prefix.ts — BASH_COMMAND_PREFIX constant
 *    Has ZERO existing test coverage. The exported constant is straightforward
 *    to verify.
 *
 * Covers:
 *   - agents/status-reporter.ts: AgentStatusReporter all methods (null + delegate paths)
 *   - agents/bash-prefix.ts: BASH_COMMAND_PREFIX exported constant
 */

import { describe, it, expect } from "vitest";

const { AgentStatusReporter } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/agents/status-reporter.js"
);

const { BASH_COMMAND_PREFIX } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/agents/bash-prefix.js"
);

// ── AgentStatusReporter ───────────────────────────────────────────────────────

describe("integration: AgentStatusReporter (no Docker required)", () => {

  describe("without StatusTracker", () => {
    it("startRun() is a no-op", () => {
      const reporter = new AgentStatusReporter();
      expect(() => reporter.startRun("my-agent", "cron")).not.toThrow();
    });

    it("reportStatus() is a no-op", () => {
      const reporter = new AgentStatusReporter();
      expect(() => reporter.reportStatus("my-agent", "Running analysis")).not.toThrow();
    });

    it("reportError() is a no-op", () => {
      const reporter = new AgentStatusReporter();
      expect(() => reporter.reportError("my-agent", "Something failed")).not.toThrow();
    });

    it("addLogLine() is a no-op", () => {
      const reporter = new AgentStatusReporter();
      expect(() => reporter.addLogLine("my-agent", "log message")).not.toThrow();
    });

    it("endRun() is a no-op", () => {
      const reporter = new AgentStatusReporter();
      expect(() => reporter.endRun("my-agent", 1234)).not.toThrow();
    });

    it("isAgentEnabled() returns true when no StatusTracker", () => {
      const reporter = new AgentStatusReporter();
      expect(reporter.isAgentEnabled("any-agent")).toBe(true);
    });

    it("setNextRunAt() is a no-op", () => {
      const reporter = new AgentStatusReporter();
      expect(() => reporter.setNextRunAt("my-agent", new Date())).not.toThrow();
      expect(() => reporter.setNextRunAt("my-agent", null)).not.toThrow();
    });

    it("endRun() with error param is a no-op", () => {
      const reporter = new AgentStatusReporter();
      expect(() => reporter.endRun("my-agent", 500, "error message")).not.toThrow();
    });
  });

  describe("with mock StatusTracker", () => {
    function makeMockTracker() {
      const calls: Record<string, unknown[][]> = {
        startRun: [],
        setAgentStatusText: [],
        setAgentError: [],
        addLogLine: [],
        endRun: [],
        isAgentEnabled: [],
        setNextRunAt: [],
      };
      return {
        calls,
        startRun: (agent: string, reason?: string) => calls.startRun.push([agent, reason]),
        setAgentStatusText: (agent: string, text: string) => calls.setAgentStatusText.push([agent, text]),
        setAgentError: (agent: string, err: string) => calls.setAgentError.push([agent, err]),
        addLogLine: (agent: string, line: string) => calls.addLogLine.push([agent, line]),
        endRun: (agent: string, elapsed: number, error?: string) => calls.endRun.push([agent, elapsed, error]),
        isAgentEnabled: (_agent: string) => { calls.isAgentEnabled.push([_agent]); return true; },
        setNextRunAt: (agent: string, date: Date | null) => calls.setNextRunAt.push([agent, date]),
      };
    }

    it("startRun() delegates to statusTracker.startRun()", () => {
      const tracker = makeMockTracker();
      const reporter = new AgentStatusReporter(tracker as any);
      reporter.startRun("test-agent", "manual");
      expect(tracker.calls.startRun.length).toBe(1);
      expect(tracker.calls.startRun[0]).toEqual(["test-agent", "manual"]);
    });

    it("reportStatus() delegates to statusTracker.setAgentStatusText()", () => {
      const tracker = makeMockTracker();
      const reporter = new AgentStatusReporter(tracker as any);
      reporter.reportStatus("test-agent", "Processing data");
      expect(tracker.calls.setAgentStatusText.length).toBe(1);
      expect(tracker.calls.setAgentStatusText[0]).toEqual(["test-agent", "Processing data"]);
    });

    it("reportError() calls setAgentError and addLogLine with ERROR: prefix", () => {
      const tracker = makeMockTracker();
      const reporter = new AgentStatusReporter(tracker as any);
      reporter.reportError("test-agent", "connection failed");
      expect(tracker.calls.setAgentError[0]).toEqual(["test-agent", "connection failed"]);
      expect(tracker.calls.addLogLine[0]).toEqual(["test-agent", "ERROR: connection failed"]);
    });

    it("addLogLine() delegates to statusTracker.addLogLine()", () => {
      const tracker = makeMockTracker();
      const reporter = new AgentStatusReporter(tracker as any);
      reporter.addLogLine("test-agent", "step completed");
      expect(tracker.calls.addLogLine[0]).toEqual(["test-agent", "step completed"]);
    });

    it("endRun() delegates to statusTracker.endRun()", () => {
      const tracker = makeMockTracker();
      const reporter = new AgentStatusReporter(tracker as any);
      reporter.endRun("test-agent", 2500, "some error");
      expect(tracker.calls.endRun[0]).toEqual(["test-agent", 2500, "some error"]);
    });

    it("isAgentEnabled() delegates to statusTracker.isAgentEnabled()", () => {
      const tracker = makeMockTracker();
      const reporter = new AgentStatusReporter(tracker as any);
      reporter.isAgentEnabled("test-agent");
      expect(tracker.calls.isAgentEnabled[0]).toEqual(["test-agent"]);
    });

    it("setNextRunAt() delegates to statusTracker.setNextRunAt()", () => {
      const tracker = makeMockTracker();
      const reporter = new AgentStatusReporter(tracker as any);
      const date = new Date();
      reporter.setNextRunAt("test-agent", date);
      expect(tracker.calls.setNextRunAt[0]).toEqual(["test-agent", date]);
    });
  });
});

// ── BASH_COMMAND_PREFIX ───────────────────────────────────────────────────────

describe("integration: BASH_COMMAND_PREFIX (no Docker required)", () => {
  it("is a non-empty string", () => {
    expect(typeof BASH_COMMAND_PREFIX).toBe("string");
    expect(BASH_COMMAND_PREFIX.length).toBeGreaterThan(0);
  });

  it("sources the bash init script (starts with '. ')", () => {
    expect(BASH_COMMAND_PREFIX.startsWith(". ")).toBe(true);
  });

  it("references al-bash-init.sh", () => {
    expect(BASH_COMMAND_PREFIX).toContain("al-bash-init.sh");
  });
});
