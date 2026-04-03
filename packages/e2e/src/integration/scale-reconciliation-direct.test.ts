/**
 * Integration tests: scheduler/policies/scale-reconciliation.ts and
 * tui/plain-logger.ts — no Docker required.
 *
 * These modules are only exercised indirectly via Docker-gated tests
 * (scale-cap.test.ts, default-agent-scale.test.ts), so they get skipped
 * in Docker-free CI. This test file exercises them directly.
 *
 * enforceProjectScaleCap(agentConfigs, globalConfig, logger):
 *   Returns a new array of agent configs with `scale` fields adjusted to
 *   respect the project-wide `globalConfig.scale` cap.
 *
 * syncTrackerScales(actualScales, statusTracker, logger):
 *   Syncs the TUI status tracker when actual pool sizes differ from
 *   the registered scale (e.g. after cap enforcement).
 *
 * attachPlainLogger(statusTracker):
 *   Subscribes to statusTracker "update" events and logs state changes
 *   to stdout. Returns a { detach } handle to stop logging.
 *
 * Covers:
 *   - scale-reconciliation.ts: enforceProjectScaleCap — no cap (scale undefined) → identity
 *   - scale-reconciliation.ts: enforceProjectScaleCap — fits within cap → no throttle
 *   - scale-reconciliation.ts: enforceProjectScaleCap — exceeds cap → throttled
 *   - scale-reconciliation.ts: enforceProjectScaleCap — zero remaining → pinned to 1
 *   - scale-reconciliation.ts: enforceProjectScaleCap — does not mutate original configs
 *   - scale-reconciliation.ts: enforceProjectScaleCap — defaultAgentScale fallback
 *   - scale-reconciliation.ts: enforceProjectScaleCap — warns when total > cap
 *   - scale-reconciliation.ts: syncTrackerScales — no-op when statusTracker is undefined
 *   - scale-reconciliation.ts: syncTrackerScales — updates tracker when scale mismatch
 *   - scale-reconciliation.ts: syncTrackerScales — no-op when scales already match
 *   - tui/plain-logger.ts: attachPlainLogger — logs scheduler started on info update
 *   - tui/plain-logger.ts: attachPlainLogger — logs agent building state
 *   - tui/plain-logger.ts: attachPlainLogger — logs agent running state with reason
 *   - tui/plain-logger.ts: attachPlainLogger — logs agent idle/completed state
 *   - tui/plain-logger.ts: attachPlainLogger — logs agent error state
 *   - tui/plain-logger.ts: attachPlainLogger — logs base image build progress
 *   - tui/plain-logger.ts: attachPlainLogger — deduplicate: same state not logged twice
 *   - tui/plain-logger.ts: attachPlainLogger — detach() stops logging
 *   - tui/plain-logger.ts: attachPlainLogger — logs recent log lines from tracker
 *   - tui/plain-logger.ts: attachPlainLogger — includes projectName when set
 *   - tui/plain-logger.ts: attachPlainLogger — includes webhook URLs in scheduler started
 *   - tui/plain-logger.ts: attachPlainLogger — includes dashboard URL when set
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  StatusTracker,
} from "@action-llama/action-llama/internals/status-tracker";

const {
  enforceProjectScaleCap,
  syncTrackerScales,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/scheduler/policies/scale-reconciliation.js"
);

const {
  attachPlainLogger,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/tui/plain-logger.js"
);

// ── Helpers ───────────────────────────────────────────────────────────────

function makeAgent(name: string, scale?: number) {
  return {
    name,
    credentials: ["anthropic_key"],
    models: [],
    scale,
  } as any;
}

function makeLogger() {
  return {
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  };
}

function makeGlobalConfig(scale?: number, defaultAgentScale?: number) {
  return {
    models: {},
    scale,
    defaultAgentScale,
  } as any;
}

// ── enforceProjectScaleCap ─────────────────────────────────────────────────

describe("integration: enforceProjectScaleCap (no Docker required)", { timeout: 10_000 }, () => {
  it("returns identity when globalConfig.scale is undefined (no cap)", () => {
    const agents = [makeAgent("a", 3), makeAgent("b", 2)];
    const logger = makeLogger();
    const result = enforceProjectScaleCap(agents, makeGlobalConfig(undefined), logger);
    expect(result[0].scale).toBe(3);
    expect(result[1].scale).toBe(2);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("does not throttle when total requested scale fits within cap", () => {
    const agents = [makeAgent("a", 2), makeAgent("b", 2)];
    const logger = makeLogger();
    const result = enforceProjectScaleCap(agents, makeGlobalConfig(5), logger);
    expect(result[0].scale).toBe(2);
    expect(result[1].scale).toBe(2);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("throttles second agent when total exceeds cap", () => {
    // a wants 3, b wants 3, cap is 5
    // a gets 3, b gets 2 (remaining)
    const agents = [makeAgent("a", 3), makeAgent("b", 3)];
    const logger = makeLogger();
    const result = enforceProjectScaleCap(agents, makeGlobalConfig(5), logger);
    expect(result[0].scale).toBe(3);
    expect(result[1].scale).toBe(2);
    // Should warn about the throttling for b
    expect(logger.warn).toHaveBeenCalled();
  });

  it("pins to 1 when remaining capacity is zero", () => {
    // a wants 4, b wants 2, cap is 4
    // a gets 4, b has 0 remaining → pinned to 1
    const agents = [makeAgent("a", 4), makeAgent("b", 2)];
    const logger = makeLogger();
    const result = enforceProjectScaleCap(agents, makeGlobalConfig(4), logger);
    expect(result[0].scale).toBe(4);
    expect(result[1].scale).toBe(1); // Pinned to minimum
    expect(logger.warn).toHaveBeenCalled();
  });

  it("does not mutate the original agent config objects", () => {
    const agentA = makeAgent("a", 3);
    const agentB = makeAgent("b", 3);
    const agents = [agentA, agentB];
    const logger = makeLogger();
    enforceProjectScaleCap(agents, makeGlobalConfig(4), logger);
    // Original objects should be untouched
    expect(agentA.scale).toBe(3);
    expect(agentB.scale).toBe(3);
  });

  it("uses defaultAgentScale fallback when agent has no explicit scale", () => {
    // a has no explicit scale, defaultAgentScale=2, cap=3
    // a gets 2 (fits), b gets 1 (remaining < defaultAgentScale=2 → throttled)
    const agents = [makeAgent("a", undefined), makeAgent("b", undefined)];
    const logger = makeLogger();
    const result = enforceProjectScaleCap(agents, makeGlobalConfig(3, 2), logger);
    // a fits without throttle — scale stays undefined (not rewritten)
    expect(result[0].scale).toBeUndefined();
    // b gets throttled to 1 (remaining capacity)
    expect(result[1].scale).toBe(1);
  });

  it("warns when total requested scale (with defaultAgentScale) exceeds cap", () => {
    // 3 agents each requesting defaultAgentScale=2 → total=6, cap=4 → warn
    const agents = [makeAgent("a", undefined), makeAgent("b", undefined), makeAgent("c", undefined)];
    const logger = makeLogger();
    enforceProjectScaleCap(agents, makeGlobalConfig(4, 2), logger);
    // Should emit a warn about total exceeding cap
    expect(logger.warn).toHaveBeenCalled();
    const warnArgs = logger.warn.mock.calls[0];
    expect(warnArgs[0]).toMatchObject({
      totalRequested: 6,
      projectScale: 4,
    });
  });

  it("handles single agent that fits exactly", () => {
    const agents = [makeAgent("a", 3)];
    const logger = makeLogger();
    const result = enforceProjectScaleCap(agents, makeGlobalConfig(3), logger);
    expect(result[0].scale).toBe(3);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("handles multiple agents that all fit within cap", () => {
    const agents = [makeAgent("a", 1), makeAgent("b", 1), makeAgent("c", 1)];
    const logger = makeLogger();
    const result = enforceProjectScaleCap(agents, makeGlobalConfig(10), logger);
    expect(result[0].scale).toBe(1);
    expect(result[1].scale).toBe(1);
    expect(result[2].scale).toBe(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("returns empty array for empty agent list", () => {
    const logger = makeLogger();
    const result = enforceProjectScaleCap([], makeGlobalConfig(5), logger);
    expect(result).toEqual([]);
  });

  it("handles cap of exactly 1 with multiple agents", () => {
    // cap=1: first agent gets 1, all subsequent agents get pinned to 1 (minimum)
    const agents = [makeAgent("a", 2), makeAgent("b", 2)];
    const logger = makeLogger();
    const result = enforceProjectScaleCap(agents, makeGlobalConfig(1), logger);
    expect(result[0].scale).toBe(1);
    expect(result[1].scale).toBe(1); // Remaining=0, pinned to 1
  });
});

// ── syncTrackerScales ──────────────────────────────────────────────────────

describe("integration: syncTrackerScales (no Docker required)", { timeout: 10_000 }, () => {
  it("is a no-op when statusTracker is undefined", () => {
    const logger = makeLogger();
    // Should not throw
    expect(() => {
      syncTrackerScales({ "my-agent": 2 }, undefined, logger);
    }).not.toThrow();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("calls updateAgentScale when actual scale differs from registered scale", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("my-agent", 3); // registered with scale=3
    const logger = makeLogger();

    // Actual scale is 2 but tracker thinks it's 3
    syncTrackerScales({ "my-agent": 2 }, tracker, logger);

    expect(tracker.getAgentScale("my-agent")).toBe(2);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "my-agent", registeredScale: 3, actualScale: 2 }),
      expect.any(String)
    );
  });

  it("does not call updateAgentScale when scales already match", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("my-agent", 2); // registered with scale=2
    const logger = makeLogger();
    const updateSpy = vi.spyOn(tracker, "updateAgentScale");

    syncTrackerScales({ "my-agent": 2 }, tracker, logger);

    expect(updateSpy).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("syncs multiple agents in a single call", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("agent-a", 3); // registered with scale=3
    tracker.registerAgent("agent-b", 3); // registered with scale=3
    const logger = makeLogger();

    syncTrackerScales({ "agent-a": 1, "agent-b": 2 }, tracker, logger);

    expect(tracker.getAgentScale("agent-a")).toBe(1);
    expect(tracker.getAgentScale("agent-b")).toBe(2);
    expect(logger.info).toHaveBeenCalledTimes(2);
  });
});

// ── attachPlainLogger ──────────────────────────────────────────────────────

describe("integration: attachPlainLogger (tui/plain-logger.ts) (no Docker required)", { timeout: 10_000 }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a handle with a detach() method", () => {
    const tracker = new StatusTracker();
    const handle = attachPlainLogger(tracker);
    expect(typeof handle.detach).toBe("function");
    handle.detach();
  });

  it("logs scheduler started line when scheduler info is set", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const tracker = new StatusTracker();
    attachPlainLogger(tracker);

    tracker.setSchedulerInfo({
      mode: "local",
      runtime: "docker",
      gatewayPort: 8080,
      cronJobCount: 2,
      webhooksActive: false,
      webhookUrls: [],
      dashboardUrl: undefined,
      projectName: undefined,
    });
    tracker.emit("update");

    const messages = logSpy.mock.calls.map((c: any[]) => c[0]);
    expect(messages.some((m: string) => m.includes("scheduler started"))).toBe(true);
    expect(messages.some((m: string) => m.includes("mode=local"))).toBe(true);
    expect(messages.some((m: string) => m.includes("cron_jobs=2"))).toBe(true);
  });

  it("logs webhook URLs in scheduler started output", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const tracker = new StatusTracker();
    attachPlainLogger(tracker);

    tracker.setSchedulerInfo({
      mode: "local",
      runtime: "docker",
      gatewayPort: 8080,
      cronJobCount: 0,
      webhooksActive: true,
      webhookUrls: ["http://localhost:8080/webhooks/github"],
      dashboardUrl: undefined,
      projectName: undefined,
    });
    tracker.emit("update");

    const messages = logSpy.mock.calls.map((c: any[]) => c[0]);
    expect(messages.some((m: string) => m.includes("listening:"))).toBe(true);
    expect(messages.some((m: string) => m.includes("webhooks/github"))).toBe(true);
  });

  it("logs dashboard URL when set in scheduler info", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const tracker = new StatusTracker();
    attachPlainLogger(tracker);

    tracker.setSchedulerInfo({
      mode: "local",
      runtime: "docker",
      gatewayPort: 8080,
      cronJobCount: 0,
      webhooksActive: false,
      webhookUrls: [],
      dashboardUrl: "http://localhost:8080",
      projectName: undefined,
    });
    tracker.emit("update");

    const messages = logSpy.mock.calls.map((c: any[]) => c[0]);
    expect(messages.some((m: string) => m.includes("dashboard:"))).toBe(true);
    expect(messages.some((m: string) => m.includes("localhost:8080"))).toBe(true);
  });

  it("logs agent building state", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const tracker = new StatusTracker();
    attachPlainLogger(tracker);

    tracker.registerAgent("build-agent", 1); // Emits update
    tracker.startBuild("build-agent"); // Emits update: state→building

    const messages = logSpy.mock.calls.map((c: any[]) => c[0]);
    expect(messages.some((m: string) => m.includes("build-agent") && m.includes("building"))).toBe(true);
  });

  it("logs agent running state with run reason", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const tracker = new StatusTracker();
    attachPlainLogger(tracker);

    tracker.registerAgent("run-agent", 1);
    tracker.startBuild("run-agent");
    tracker.completeBuild("run-agent");
    tracker.startRun("run-agent", "manual"); // Emits update: state→running

    const messages = logSpy.mock.calls.map((c: any[]) => c[0]);
    expect(messages.some((m: string) => m.includes("run-agent") && m.includes("running"))).toBe(true);
  });

  it("logs agent error state", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const tracker = new StatusTracker();
    attachPlainLogger(tracker);

    tracker.registerAgent("err-agent", 1);
    tracker.startBuild("err-agent");
    tracker.completeBuild("err-agent");
    tracker.startRun("err-agent", "manual");
    // completeRun with error message sets state→error and lastError
    tracker.completeRun("err-agent", 100, "disk full");

    const messages = logSpy.mock.calls.map((c: any[]) => c[0]);
    expect(messages.some((m: string) => m.includes("err-agent") && m.includes("error"))).toBe(true);
    expect(messages.some((m: string) => m.includes("disk full"))).toBe(true);
  });

  it("logs base image build status when it changes", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const tracker = new StatusTracker();
    attachPlainLogger(tracker);

    tracker.setBaseImageStatus("Building base image...");
    tracker.emit("update");

    const messages = logSpy.mock.calls.map((c: any[]) => c[0]);
    expect(messages.some((m: string) => m.includes("base image"))).toBe(true);
    expect(messages.some((m: string) => m.includes("Building base image"))).toBe(true);
  });

  it("does not re-log the same agent state twice", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const tracker = new StatusTracker();
    attachPlainLogger(tracker);

    tracker.registerAgent("dedup-agent", 1);
    tracker.startBuild("dedup-agent"); // First state change: logged by internal emit("update")
    const countAfterFirst = logSpy.mock.calls.length;

    // Manually trigger another update without changing state
    // The plain-logger should deduplicate and not log again
    tracker.emit("update" as any);
    const countAfterSecond = logSpy.mock.calls.length;

    expect(countAfterSecond).toBe(countAfterFirst);
  });

  it("detach() stops logging on subsequent updates", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const tracker = new StatusTracker();
    const handle = attachPlainLogger(tracker);

    tracker.registerAgent("detach-agent", 1);
    tracker.startBuild("detach-agent"); // Logs "building"

    // Record which agent messages were logged before detach
    const messagesBefore = logSpy.mock.calls
      .map((c: any[]) => c[0])
      .filter((m: string) => m.includes("detach-agent"));
    expect(messagesBefore.some((m: string) => m.includes("building"))).toBe(true);

    handle.detach(); // Detach the logger
    const countAfterDetach = logSpy.mock.calls.length;

    // Change state after detach — should NOT produce new logs
    tracker.setAgentError("detach-agent", "some error after detach");
    const countAfterStateChange = logSpy.mock.calls.length;

    // No new messages after detach
    expect(countAfterStateChange).toBe(countAfterDetach);
  });

  it("logs recent log lines from the status tracker", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const tracker = new StatusTracker();
    attachPlainLogger(tracker);

    tracker.registerAgent("log-agent", 1);
    tracker.addLogLine("log-agent", "Hello from the agent!"); // Emits update

    const messages = logSpy.mock.calls.map((c: any[]) => c[0]);
    expect(messages.some((m: string) => m.includes("Hello from the agent!"))).toBe(true);
  });

  it("includes projectName prefix when scheduler info has projectName", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const tracker = new StatusTracker();
    attachPlainLogger(tracker);

    // Set scheduler info with projectName first, then register agent and change state
    tracker.setSchedulerInfo({
      mode: "local",
      runtime: "docker",
      gatewayPort: 8080,
      cronJobCount: 0,
      webhooksActive: false,
      webhookUrls: [],
      dashboardUrl: undefined,
      projectName: "my-project",
    });
    tracker.registerAgent("proj-agent", 1);
    tracker.startBuild("proj-agent"); // Logs "building" with [my-project] prefix

    const messages = logSpy.mock.calls.map((c: any[]) => c[0]);
    expect(messages.some((m: string) => m.includes("[my-project]") && m.includes("proj-agent"))).toBe(true);
  });

  it("logs idle/completed state with duration when lastRunAt is set", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const tracker = new StatusTracker();
    attachPlainLogger(tracker);

    tracker.registerAgent("idle-agent", 1);
    tracker.startBuild("idle-agent");
    tracker.completeBuild("idle-agent");
    tracker.startRun("idle-agent", "manual");
    // Complete the run with a duration — this sets lastRunAt
    tracker.completeRun("idle-agent", 5000); // 5 seconds duration

    const messages = logSpy.mock.calls.map((c: any[]) => c[0]);
    expect(messages.some((m: string) => m.includes("idle-agent") && m.includes("completed"))).toBe(true);
  });
});
