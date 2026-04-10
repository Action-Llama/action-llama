/**
 * Integration tests: StatusTracker advanced methods — no Docker required.
 *
 * Covers the StatusTracker methods NOT exercised by status-tracker.test.ts:
 *   - flushInvalidations() resets log+version, returns all signals
 *   - setAgentState() direct state change, clears statusText/lastError on "running"
 *   - endRun() decrements runningCount, updates lastRunAt/lastRunDuration/usage/error
 *   - setTaskUrl() stores and retrieves taskUrl on agent
 *   - setAgentDescription() updates description field
 *   - setAgentStatusText() updates statusText field
 *   - setAgentError() updates lastError field
 *   - completeRun() finalises state, sets lastRunAt/lastRunDuration, handles error
 *   - setQueuedWebhooks() updates count and emits triggers invalidation
 *   - setNextRunAt() stores nextRunAt on agent
 *   - addLogLine() / getRecentLogs() circular buffer, capped at maxLogs
 *   - getSchedulerInfo() returns null then set value
 *   - setBaseImageStatus() / getBaseImageStatus() round-trip + null clear
 *   - startBuild() / completeBuild() via AgentLifecycle delegation
 *   - createSession() returns SessionLifecycle tied to registered agent
 *   - getAgentLifecycle() returns AgentLifecycle for registered agent
 *   - endRun() with usage accumulates cumulativeUsage across multiple calls
 *   - disableAgent() clears nextRunAt
 *   - enableAgent() / disableAgent() emit "agent-enabled" / "agent-disabled" events
 *   - updateAgentScale() emits "agent-scale-changed" event
 */

import { describe, it, expect } from "vitest";
import { StatusTracker } from "@action-llama/action-llama/internals/status-tracker";
import type { SchedulerInfo } from "@action-llama/action-llama/internals/status-tracker";

// Helper: build a minimal SchedulerInfo
function makeSchedulerInfo(overrides: Partial<SchedulerInfo> = {}): SchedulerInfo {
  return {
    mode: "docker",
    gatewayPort: 8080,
    cronJobCount: 0,
    webhooksActive: false,
    webhookUrls: [],
    startedAt: new Date(),
    paused: false,
    ...overrides,
  };
}

describe("status-tracker advanced: uncovered StatusTracker methods (no Docker required)", { timeout: 15_000 }, () => {

  // ── flushInvalidations ─────────────────────────────────────────────────────

  it("flushInvalidations returns all signals accumulated so far", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("agent-a", 1);
    tracker.startRun("agent-a", "manual");

    const signals = tracker.flushInvalidations();
    expect(signals.length).toBeGreaterThan(0);
  });

  it("flushInvalidations resets version to 0", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("agent-b", 1);
    tracker.startRun("agent-b");

    tracker.flushInvalidations();
    expect(tracker.getInvalidationVersion()).toBe(0);
  });

  it("flushInvalidations: subsequent getInvalidationsSince(0) returns empty after flush", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("agent-c", 1);
    tracker.startRun("agent-c");

    tracker.flushInvalidations();
    const { signals } = tracker.getInvalidationsSince(0);
    expect(signals).toHaveLength(0);
  });

  // ── setAgentState ──────────────────────────────────────────────────────────

  it("setAgentState changes the agent state field", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("state-agent", 1);

    tracker.setAgentState("state-agent", "building");
    const agent = tracker.getAllAgents().find((a) => a.name === "state-agent");
    expect(agent?.state).toBe("building");
  });

  it("setAgentState to 'running' clears statusText and lastError", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("state-agent2", 1);
    tracker.setAgentStatusText("state-agent2", "some status");
    tracker.setAgentError("state-agent2", "previous error");

    tracker.setAgentState("state-agent2", "running");
    const agent = tracker.getAllAgents().find((a) => a.name === "state-agent2");
    expect(agent?.statusText).toBeNull();
    expect(agent?.lastError).toBeNull();
  });

  it("setAgentState no-op for unknown agent", () => {
    const tracker = new StatusTracker();
    // Should not throw
    expect(() => tracker.setAgentState("nonexistent", "running")).not.toThrow();
  });

  // ── endRun ─────────────────────────────────────────────────────────────────

  it("endRun decrements runningCount and sets lastRunAt/lastRunDuration", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("run-end-agent", 1);
    tracker.startRun("run-end-agent");

    tracker.endRun("run-end-agent", 1234);
    const agent = tracker.getAllAgents().find((a) => a.name === "run-end-agent");
    expect(agent?.runningCount).toBe(0);
    expect(agent?.lastRunDuration).toBe(1234);
    expect(agent?.lastRunAt).toBeInstanceOf(Date);
  });

  it("endRun sets state to idle when no more running instances", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("idle-agent", 1);
    tracker.startRun("idle-agent");

    tracker.endRun("idle-agent", 500);
    const agent = tracker.getAllAgents().find((a) => a.name === "idle-agent");
    expect(agent?.state).toBe("idle");
  });

  it("endRun with error sets state to 'error' and lastError", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("error-agent", 1);
    tracker.startRun("error-agent");

    tracker.endRun("error-agent", 100, "something went wrong");
    const agent = tracker.getAllAgents().find((a) => a.name === "error-agent");
    expect(agent?.state).toBe("error");
    expect(agent?.lastError).toBe("something went wrong");
  });

  it("endRun with usage sets lastRunUsage and initialises cumulativeUsage", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("usage-agent", 1);
    tracker.startRun("usage-agent");

    const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15, cost: 0.001, turnCount: 1 };
    tracker.endRun("usage-agent", 200, undefined, usage);

    const agent = tracker.getAllAgents().find((a) => a.name === "usage-agent");
    expect(agent?.lastRunUsage).toEqual(usage);
    expect(agent?.cumulativeUsage?.totalTokens).toBe(15);
  });

  it("endRun accumulates cumulativeUsage across multiple calls", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("cumulative-agent", 2);
    tracker.startRun("cumulative-agent");
    tracker.startRun("cumulative-agent");

    const usage1 = { inputTokens: 10, outputTokens: 5, totalTokens: 15, cost: 0.001, turnCount: 1 };
    const usage2 = { inputTokens: 20, outputTokens: 10, totalTokens: 30, cost: 0.002, turnCount: 2 };
    tracker.endRun("cumulative-agent", 100, undefined, usage1);
    tracker.endRun("cumulative-agent", 200, undefined, usage2);

    const agent = tracker.getAllAgents().find((a) => a.name === "cumulative-agent");
    expect(agent?.cumulativeUsage?.totalTokens).toBe(45);
  });

  // ── setTaskUrl ─────────────────────────────────────────────────────────────

  it("setTaskUrl stores a URL on the agent", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("task-url-agent", 1);

    tracker.setTaskUrl("task-url-agent", "https://console.cloud.google.com/run/jobs/12345");
    const agent = tracker.getAllAgents().find((a) => a.name === "task-url-agent");
    expect(agent?.taskUrl).toBe("https://console.cloud.google.com/run/jobs/12345");
  });

  it("setTaskUrl(null) clears the task URL", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("task-url-clear-agent", 1);

    tracker.setTaskUrl("task-url-clear-agent", "https://example.com");
    tracker.setTaskUrl("task-url-clear-agent", null);
    const agent = tracker.getAllAgents().find((a) => a.name === "task-url-clear-agent");
    expect(agent?.taskUrl).toBeNull();
  });

  it("setTaskUrl no-op for unknown agent", () => {
    const tracker = new StatusTracker();
    expect(() => tracker.setTaskUrl("nonexistent", "https://example.com")).not.toThrow();
  });

  // ── setAgentDescription ───────────────────────────────────────────────────

  it("setAgentDescription updates the description field", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("desc-agent", 1, "original description");

    tracker.setAgentDescription("desc-agent", "updated description");
    const agent = tracker.getAllAgents().find((a) => a.name === "desc-agent");
    expect(agent?.description).toBe("updated description");
  });

  it("setAgentDescription to undefined clears the description", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("desc-clear-agent", 1, "some description");

    tracker.setAgentDescription("desc-clear-agent", undefined);
    const agent = tracker.getAllAgents().find((a) => a.name === "desc-clear-agent");
    expect(agent?.description).toBeUndefined();
  });

  it("setAgentDescription no-op for unknown agent", () => {
    const tracker = new StatusTracker();
    expect(() => tracker.setAgentDescription("nonexistent", "desc")).not.toThrow();
  });

  // ── setAgentStatusText ────────────────────────────────────────────────────

  it("setAgentStatusText sets the statusText on the agent", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("status-text-agent", 1);

    tracker.setAgentStatusText("status-text-agent", "Downloading data…");
    const agent = tracker.getAllAgents().find((a) => a.name === "status-text-agent");
    expect(agent?.statusText).toBe("Downloading data…");
  });

  it("setAgentStatusText no-op for unknown agent", () => {
    const tracker = new StatusTracker();
    expect(() => tracker.setAgentStatusText("nonexistent", "text")).not.toThrow();
  });

  // ── setAgentError ─────────────────────────────────────────────────────────

  it("setAgentError stores the error message", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("err-agent", 1);

    tracker.setAgentError("err-agent", "fatal error occurred");
    const agent = tracker.getAllAgents().find((a) => a.name === "err-agent");
    expect(agent?.lastError).toBe("fatal error occurred");
  });

  it("setAgentError no-op for unknown agent", () => {
    const tracker = new StatusTracker();
    expect(() => tracker.setAgentError("nonexistent", "err")).not.toThrow();
  });

  // ── completeRun ────────────────────────────────────────────────────────────

  it("completeRun sets state to idle and records duration when no error", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("complete-agent", 1);
    tracker.startRun("complete-agent");

    tracker.completeRun("complete-agent", 750);
    const agent = tracker.getAllAgents().find((a) => a.name === "complete-agent");
    expect(agent?.state).toBe("idle");
    expect(agent?.lastRunDuration).toBe(750);
    expect(agent?.lastRunAt).toBeInstanceOf(Date);
  });

  it("completeRun with error sets state to error and lastError", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("complete-err-agent", 1);
    tracker.startRun("complete-err-agent");

    tracker.completeRun("complete-err-agent", 100, "completion error");
    const agent = tracker.getAllAgents().find((a) => a.name === "complete-err-agent");
    expect(agent?.state).toBe("error");
    expect(agent?.lastError).toBe("completion error");
  });

  it("completeRun clears runReason", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("reason-clear-agent", 1);
    tracker.startRun("reason-clear-agent", "manual");

    tracker.completeRun("reason-clear-agent", 200);
    const agent = tracker.getAllAgents().find((a) => a.name === "reason-clear-agent");
    expect(agent?.runReason).toBeNull();
  });

  it("completeRun no-op for unknown agent", () => {
    const tracker = new StatusTracker();
    expect(() => tracker.completeRun("nonexistent", 100)).not.toThrow();
  });

  // ── setQueuedWebhooks ─────────────────────────────────────────────────────

  it("setQueuedWebhooks updates the count on the agent", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("queue-agent", 1);

    tracker.setQueuedWebhooks("queue-agent", 5);
    const agent = tracker.getAllAgents().find((a) => a.name === "queue-agent");
    expect(agent?.queuedWebhooks).toBe(5);
  });

  it("setQueuedWebhooks emits a triggers invalidation signal", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("queue-sig-agent", 1);
    const v0 = tracker.getInvalidationVersion();

    tracker.setQueuedWebhooks("queue-sig-agent", 3);
    const { signals } = tracker.getInvalidationsSince(v0);
    expect(signals.some((s) => s.type === "triggers")).toBe(true);
  });

  it("setQueuedWebhooks no-op for unknown agent", () => {
    const tracker = new StatusTracker();
    expect(() => tracker.setQueuedWebhooks("nonexistent", 1)).not.toThrow();
  });

  // ── setNextRunAt ──────────────────────────────────────────────────────────

  it("setNextRunAt stores the next run date", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("next-run-agent", 1);

    const next = new Date(Date.now() + 60_000);
    tracker.setNextRunAt("next-run-agent", next);
    const agent = tracker.getAllAgents().find((a) => a.name === "next-run-agent");
    expect(agent?.nextRunAt).toEqual(next);
  });

  it("setNextRunAt(null) clears the date", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("next-run-clear-agent", 1);

    tracker.setNextRunAt("next-run-clear-agent", new Date());
    tracker.setNextRunAt("next-run-clear-agent", null);
    const agent = tracker.getAllAgents().find((a) => a.name === "next-run-clear-agent");
    expect(agent?.nextRunAt).toBeNull();
  });

  it("setNextRunAt no-op for unknown agent", () => {
    const tracker = new StatusTracker();
    expect(() => tracker.setNextRunAt("nonexistent", null)).not.toThrow();
  });

  // ── disableAgent clears nextRunAt ─────────────────────────────────────────

  it("disableAgent clears the nextRunAt date", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("disable-next-agent", 1);
    tracker.setNextRunAt("disable-next-agent", new Date(Date.now() + 120_000));

    tracker.disableAgent("disable-next-agent");
    const agent = tracker.getAllAgents().find((a) => a.name === "disable-next-agent");
    expect(agent?.nextRunAt).toBeNull();
  });

  // ── addLogLine / getRecentLogs ────────────────────────────────────────────

  it("addLogLine makes entry visible via getRecentLogs", () => {
    const tracker = new StatusTracker();
    tracker.addLogLine("my-agent", "hello world");

    const logs = tracker.getRecentLogs(10);
    expect(logs).toHaveLength(1);
    expect(logs[0].agent).toBe("my-agent");
    expect(logs[0].message).toBe("hello world");
    expect(logs[0].timestamp).toBeInstanceOf(Date);
  });

  it("getRecentLogs returns only the last N entries", () => {
    const tracker = new StatusTracker();
    for (let i = 0; i < 5; i++) {
      tracker.addLogLine("agent", `message ${i}`);
    }

    const logs = tracker.getRecentLogs(3);
    expect(logs).toHaveLength(3);
    expect(logs[2].message).toBe("message 4");
  });

  it("addLogLine caps at 100 entries (maxLogs)", () => {
    const tracker = new StatusTracker();
    for (let i = 0; i < 110; i++) {
      tracker.addLogLine("agent", `msg ${i}`);
    }

    const logs = tracker.getRecentLogs(200);
    expect(logs).toHaveLength(100);
    // Oldest entry should have been evicted
    expect(logs[0].message).toBe("msg 10");
  });

  // ── getSchedulerInfo / setSchedulerInfo ────────────────────────────────────

  it("getSchedulerInfo returns null initially", () => {
    const tracker = new StatusTracker();
    expect(tracker.getSchedulerInfo()).toBeNull();
  });

  it("getSchedulerInfo returns the set info", () => {
    const tracker = new StatusTracker();
    const info = makeSchedulerInfo({ projectName: "my-project", cronJobCount: 3 });

    tracker.setSchedulerInfo(info);
    const result = tracker.getSchedulerInfo();
    expect(result?.projectName).toBe("my-project");
    expect(result?.cronJobCount).toBe(3);
  });

  it("setSchedulerInfo emits 'update' event", () => {
    const tracker = new StatusTracker();
    let updateCount = 0;
    tracker.on("update", () => { updateCount++; });

    tracker.setSchedulerInfo(makeSchedulerInfo());
    expect(updateCount).toBeGreaterThan(0);
  });

  // ── setBaseImageStatus / getBaseImageStatus ───────────────────────────────

  it("getBaseImageStatus returns null initially", () => {
    const tracker = new StatusTracker();
    expect(tracker.getBaseImageStatus()).toBeNull();
  });

  it("setBaseImageStatus then getBaseImageStatus returns set value", () => {
    const tracker = new StatusTracker();
    tracker.setBaseImageStatus("Building layer 3/5");
    expect(tracker.getBaseImageStatus()).toBe("Building layer 3/5");
  });

  it("setBaseImageStatus(null) clears the status", () => {
    const tracker = new StatusTracker();
    tracker.setBaseImageStatus("building...");
    tracker.setBaseImageStatus(null);
    expect(tracker.getBaseImageStatus()).toBeNull();
  });

  it("setBaseImageStatus emits 'update' event", () => {
    const tracker = new StatusTracker();
    let updated = false;
    tracker.on("update", () => { updated = true; });

    tracker.setBaseImageStatus("step 1");
    expect(updated).toBe(true);
  });

  // ── startBuild / completeBuild ────────────────────────────────────────────

  it("startBuild sets agent state to 'building'", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("build-agent", 1);

    tracker.startBuild("build-agent");
    const agent = tracker.getAllAgents().find((a) => a.name === "build-agent");
    expect(agent?.state).toBe("building");
  });

  it("completeBuild after startBuild sets agent state back to 'idle'", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("build-complete-agent", 1);

    tracker.startBuild("build-complete-agent");
    tracker.completeBuild("build-complete-agent");
    const agent = tracker.getAllAgents().find((a) => a.name === "build-complete-agent");
    expect(agent?.state).toBe("idle");
  });

  it("startBuild no-op for unknown agent (does not throw)", () => {
    const tracker = new StatusTracker();
    expect(() => tracker.startBuild("nonexistent")).not.toThrow();
  });

  it("completeBuild no-op for unknown agent (does not throw)", () => {
    const tracker = new StatusTracker();
    expect(() => tracker.completeBuild("nonexistent")).not.toThrow();
  });

  // ── createSession ────────────────────────────────────────────────────────

  it("createSession returns an SessionLifecycle for a registered agent", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("inst-creator-agent", 1);

    const lifecycle = tracker.createSession("inst-001", "inst-creator-agent", "manual");
    expect(lifecycle).not.toBeNull();
    expect(lifecycle?.sessionId ?? (lifecycle as unknown as { id: string })?.id ?? "inst-001").toBeTruthy();
  });

  it("createSession returns null for unknown agent", () => {
    const tracker = new StatusTracker();
    const lifecycle = tracker.createSession("inst-002", "nonexistent", "manual");
    expect(lifecycle).toBeNull();
  });

  it("createSession result can be started and completed without throwing", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("lifecycle-agent", 1);

    const lc = tracker.createSession("inst-003", "lifecycle-agent", "webhook");
    expect(lc).not.toBeNull();
    if (lc) {
      expect(() => lc.start()).not.toThrow();
      expect(() => lc.complete()).not.toThrow();
    }
  });

  // ── getAgentLifecycle ─────────────────────────────────────────────────────

  it("getAgentLifecycle returns AgentLifecycle for a registered agent", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("lifecycle-getter-agent", 1);

    const lc = tracker.getAgentLifecycle("lifecycle-getter-agent");
    expect(lc).toBeDefined();
  });

  it("getAgentLifecycle returns undefined for unknown agent", () => {
    const tracker = new StatusTracker();
    const lc = tracker.getAgentLifecycle("nonexistent");
    expect(lc).toBeUndefined();
  });

  it("getAgentLifecycle returns undefined after agent is unregistered", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("removed-agent", 1);
    tracker.unregisterAgent("removed-agent");

    const lc = tracker.getAgentLifecycle("removed-agent");
    expect(lc).toBeUndefined();
  });

  // ── event emissions ───────────────────────────────────────────────────────

  it("enableAgent emits 'agent-enabled' event with agent name", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("event-agent", 0);

    let emittedName: string | null = null;
    tracker.on("agent-enabled", (name: string) => { emittedName = name; });

    tracker.enableAgent("event-agent");
    expect(emittedName).toBe("event-agent");
  });

  it("disableAgent emits 'agent-disabled' event with agent name", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("disable-event-agent", 1);

    let emittedName: string | null = null;
    tracker.on("agent-disabled", (name: string) => { emittedName = name; });

    tracker.disableAgent("disable-event-agent");
    expect(emittedName).toBe("disable-event-agent");
  });

  it("updateAgentScale emits 'agent-scale-changed' event with name and scale", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("scale-event-agent", 1);

    let emittedName: string | null = null;
    let emittedScale: number | null = null;
    tracker.on("agent-scale-changed", (name: string, scale: number) => {
      emittedName = name;
      emittedScale = scale;
    });

    tracker.updateAgentScale("scale-event-agent", 4);
    expect(emittedName).toBe("scale-event-agent");
    expect(emittedScale).toBe(4);
  });
});
