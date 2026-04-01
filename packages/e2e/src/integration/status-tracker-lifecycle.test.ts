/**
 * Integration tests: StatusTracker run lifecycle — no Docker required.
 *
 * Tests the run lifecycle methods (startRun, endRun, completeRun), log
 * accumulation (addLogLine/getRecentLogs), base image status, and the
 * completeInstance method. No Docker or scheduler startup needed.
 *
 * Covers:
 *   - tui/status-tracker.ts: startRun(), endRun() (success/error/concurrent),
 *     completeRun() (success/error), addLogLine() / getRecentLogs(),
 *     setBaseImageStatus() / getBaseImageStatus(), completeInstance(),
 *     setQueuedWebhooks(), setNextRunAt(), flushInvalidations()
 */

import { describe, it, expect } from "vitest";
import { StatusTracker } from "@action-llama/action-llama/internals/status-tracker";

describe("status-tracker-lifecycle: run lifecycle", { timeout: 10_000 }, () => {
  it("startRun sets state to running and increments runningCount", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("run-agent", 1);

    tracker.startRun("run-agent", "schedule");

    const agent = tracker.getAllAgents().find((a) => a.name === "run-agent")!;
    expect(agent.state).toBe("running");
    expect(agent.runningCount).toBe(1);
    expect(agent.runReason).toBe("schedule");
  });

  it("endRun without error sets state to idle and records duration", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("end-agent", 1);

    tracker.startRun("end-agent");
    tracker.endRun("end-agent", 5000);

    const agent = tracker.getAllAgents().find((a) => a.name === "end-agent")!;
    expect(agent.state).toBe("idle");
    expect(agent.lastRunDuration).toBe(5000);
    expect(agent.lastRunAt).toBeInstanceOf(Date);
    expect(agent.runningCount).toBe(0);
  });

  it("endRun with error sets state to error and records error message", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("err-agent", 1);

    tracker.startRun("err-agent");
    tracker.endRun("err-agent", 3000, "container exited with code 1");

    const agent = tracker.getAllAgents().find((a) => a.name === "err-agent")!;
    expect(agent.state).toBe("error");
    expect(agent.lastError).toBe("container exited with code 1");
  });

  it("concurrent runs: state stays running while multiple runs are active", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("concurrent-agent", 2);

    tracker.startRun("concurrent-agent");
    tracker.startRun("concurrent-agent");

    const afterTwoStarts = tracker.getAllAgents().find((a) => a.name === "concurrent-agent")!;
    expect(afterTwoStarts.runningCount).toBe(2);

    // End one run — should still be "running" (count > 0)
    tracker.endRun("concurrent-agent", 1000);
    const afterOneEnd = tracker.getAllAgents().find((a) => a.name === "concurrent-agent")!;
    expect(afterOneEnd.runningCount).toBe(1);
    expect(afterOneEnd.state).toBe("running");

    // End second run — should go idle
    tracker.endRun("concurrent-agent", 1000);
    const afterBothEnds = tracker.getAllAgents().find((a) => a.name === "concurrent-agent")!;
    expect(afterBothEnds.runningCount).toBe(0);
    expect(afterBothEnds.state).toBe("idle");
  });

  it("completeRun without error sets state to idle", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("complete-agent", 1);

    tracker.startRun("complete-agent");
    tracker.completeRun("complete-agent", 2500);

    const agent = tracker.getAllAgents().find((a) => a.name === "complete-agent")!;
    expect(agent.state).toBe("idle");
    expect(agent.lastRunDuration).toBe(2500);
    expect(agent.runReason).toBeNull();
  });

  it("completeRun with error sets state to error", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("complete-err-agent", 1);

    tracker.startRun("complete-err-agent");
    tracker.completeRun("complete-err-agent", 1000, "run failed");

    const agent = tracker.getAllAgents().find((a) => a.name === "complete-err-agent")!;
    expect(agent.state).toBe("error");
    expect(agent.lastError).toBe("run failed");
  });
});

describe("status-tracker-lifecycle: log accumulation", { timeout: 10_000 }, () => {
  it("addLogLine stores lines and getRecentLogs returns them", () => {
    const tracker = new StatusTracker();

    tracker.addLogLine("agent-a", "Started successfully");
    tracker.addLogLine("agent-b", "Webhook received");

    const logs = tracker.getRecentLogs(10);
    expect(logs).toHaveLength(2);
    expect(logs[0].message).toBe("Started successfully");
    expect(logs[0].agent).toBe("agent-a");
    expect(logs[1].message).toBe("Webhook received");
  });

  it("getRecentLogs returns at most n entries", () => {
    const tracker = new StatusTracker();

    for (let i = 0; i < 15; i++) {
      tracker.addLogLine("test-agent", `Log line ${i}`);
    }

    const logs = tracker.getRecentLogs(5);
    expect(logs).toHaveLength(5);
    // Should return the most recent 5
    expect(logs[4].message).toBe("Log line 14");
  });
});

describe("status-tracker-lifecycle: base image and misc", { timeout: 10_000 }, () => {
  it("setBaseImageStatus / getBaseImageStatus roundtrip", () => {
    const tracker = new StatusTracker();
    expect(tracker.getBaseImageStatus()).toBeNull();

    tracker.setBaseImageStatus("Building base image...");
    expect(tracker.getBaseImageStatus()).toBe("Building base image...");

    tracker.setBaseImageStatus(null);
    expect(tracker.getBaseImageStatus()).toBeNull();
  });

  it("setQueuedWebhooks updates the agent's queuedWebhooks count", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("queue-agent", 1);

    tracker.setQueuedWebhooks("queue-agent", 3);

    const agent = tracker.getAllAgents().find((a) => a.name === "queue-agent")!;
    expect(agent.queuedWebhooks).toBe(3);
  });

  it("setNextRunAt updates the agent's nextRunAt field", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("cron-agent", 1);

    const nextRun = new Date(Date.now() + 60_000);
    tracker.setNextRunAt("cron-agent", nextRun);

    const agent = tracker.getAllAgents().find((a) => a.name === "cron-agent")!;
    expect(agent.nextRunAt).toEqual(nextRun);
  });

  it("flushInvalidations returns all signals and resets to version 0", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("flush-agent", 1);
    tracker.startRun("flush-agent", "manual");

    const signals = tracker.flushInvalidations();
    expect(signals.length).toBeGreaterThan(0);
    expect(tracker.getInvalidationVersion()).toBe(0);
  });

  it("completeInstance updates instance status", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("inst-agent", 1);

    tracker.registerInstance({
      id: "inst-abc",
      agentName: "inst-agent",
      startedAt: new Date(),
      status: "running",
      trigger: "schedule",
    });

    tracker.completeInstance("inst-abc", "completed");

    const instances = tracker.getInstances();
    expect(instances.find((i) => i.id === "inst-abc")?.status).toBe("completed");
  });
});
