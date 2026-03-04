import { describe, it, expect, vi } from "vitest";
import { StatusTracker } from "../../src/tui/status-tracker.js";

describe("StatusTracker", () => {
  it("registers agents and returns them", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.registerAgent("reviewer");

    const agents = tracker.getAllAgents();
    expect(agents).toHaveLength(2);
    expect(agents[0].name).toBe("dev");
    expect(agents[0].state).toBe("idle");
    expect(agents[1].name).toBe("reviewer");
  });

  it("sets agent state and emits update", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");

    const listener = vi.fn();
    tracker.on("update", listener);

    tracker.setAgentState("dev", "running");

    const agent = tracker.getAllAgents()[0];
    expect(agent.state).toBe("running");
    expect(listener).toHaveBeenCalled();
  });

  it("sets agent status text", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");

    tracker.setAgentStatusText("dev", "Implementing issue #42");

    const agent = tracker.getAllAgents()[0];
    expect(agent.statusText).toBe("Implementing issue #42");
  });

  it("clears status text when state changes to running", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setAgentStatusText("dev", "old status");

    tracker.setAgentState("dev", "running");

    const agent = tracker.getAllAgents()[0];
    expect(agent.statusText).toBeNull();
  });

  it("completes run with duration", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setAgentState("dev", "running");

    tracker.completeRun("dev", 45000);

    const agent = tracker.getAllAgents()[0];
    expect(agent.state).toBe("idle");
    expect(agent.lastRunDuration).toBe(45000);
    expect(agent.lastRunAt).toBeInstanceOf(Date);
    expect(agent.statusText).toBeNull();
  });

  it("sets next run time", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    const nextRun = new Date(Date.now() + 60000);

    tracker.setNextRunAt("dev", nextRun);

    const agent = tracker.getAllAgents()[0];
    expect(agent.nextRunAt).toBe(nextRun);
  });

  it("stores and retrieves scheduler info", () => {
    const tracker = new StatusTracker();
    const info = {
      mode: "docker" as const,
      brokerPort: 8080,
      cronJobCount: 3,
      webhooksActive: true,
      webhookUrls: ["http://localhost:8080/webhooks/github"],
      startedAt: new Date(),
    };

    tracker.setSchedulerInfo(info);

    expect(tracker.getSchedulerInfo()).toBe(info);
  });

  it("adds log lines and retrieves recent ones", () => {
    const tracker = new StatusTracker();

    for (let i = 0; i < 15; i++) {
      tracker.addLogLine("dev", `message ${i}`);
    }

    const recent = tracker.getRecentLogs(5);
    expect(recent).toHaveLength(5);
    expect(recent[0].message).toBe("message 10");
    expect(recent[4].message).toBe("message 14");
    expect(recent[0].agent).toBe("dev");
  });

  it("limits stored log lines to maxLogs", () => {
    const tracker = new StatusTracker();

    for (let i = 0; i < 150; i++) {
      tracker.addLogLine("dev", `message ${i}`);
    }

    const all = tracker.getRecentLogs(200);
    expect(all).toHaveLength(100);
    expect(all[0].message).toBe("message 50");
  });

  it("ignores operations on unregistered agents", () => {
    const tracker = new StatusTracker();

    // Should not throw
    tracker.setAgentState("unknown", "running");
    tracker.setAgentStatusText("unknown", "test");
    tracker.completeRun("unknown", 1000);
    tracker.setNextRunAt("unknown", new Date());

    expect(tracker.getAllAgents()).toHaveLength(0);
  });

  it("emits update on every mutation", () => {
    const tracker = new StatusTracker();
    const listener = vi.fn();
    tracker.on("update", listener);

    tracker.registerAgent("dev");
    tracker.setAgentState("dev", "running");
    tracker.setAgentStatusText("dev", "working");
    tracker.completeRun("dev", 1000);
    tracker.setNextRunAt("dev", new Date());
    tracker.setSchedulerInfo({
      mode: "host",
      brokerPort: null,
      cronJobCount: 1,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
    });
    tracker.addLogLine("dev", "test");

    expect(listener).toHaveBeenCalledTimes(7);
  });
});
