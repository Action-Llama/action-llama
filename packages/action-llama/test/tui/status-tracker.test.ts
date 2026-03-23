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
    expect(agents[0].lastError).toBeNull();
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

  it("completes run with error", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setAgentState("dev", "running");

    tracker.completeRun("dev", 5000, "Session failed");

    const agent = tracker.getAllAgents()[0];
    expect(agent.state).toBe("error");
    expect(agent.lastError).toBe("Session failed");
    expect(agent.lastRunDuration).toBe(5000);
  });

  it("sets agent error", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");

    tracker.setAgentError("dev", "$ gh pr list — Resource not accessible");

    const agent = tracker.getAllAgents()[0];
    expect(agent.lastError).toBe("$ gh pr list — Resource not accessible");
  });

  it("clears error when state changes to running", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setAgentError("dev", "previous error");

    tracker.setAgentState("dev", "running");

    const agent = tracker.getAllAgents()[0];
    expect(agent.lastError).toBeNull();
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
      gatewayPort: 8080,
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
    tracker.setAgentError("dev", "some error");
    tracker.completeRun("dev", 1000);
    tracker.setNextRunAt("dev", new Date());
    tracker.setSchedulerInfo({
      mode: "host",
      gatewayPort: null,
      cronJobCount: 1,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date(),
    });
    tracker.addLogLine("dev", "test");

    expect(listener).toHaveBeenCalledTimes(8);
  });

  it("registers agent with scale", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev", 3);

    const agent = tracker.getAllAgents()[0];
    expect(agent.scale).toBe(3);
    expect(agent.runningCount).toBe(0);
  });

  it("defaults scale to 1", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");

    const agent = tracker.getAllAgents()[0];
    expect(agent.scale).toBe(1);
    expect(agent.runningCount).toBe(0);
  });

  it("registers scale = 0 agent as disabled", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev", 0);

    const agent = tracker.getAllAgents()[0];
    expect(agent.scale).toBe(0);
    expect(agent.enabled).toBe(false);
  });

  it("startRun increments running count and sets state", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev", 3);

    tracker.startRun("dev");
    let agent = tracker.getAllAgents()[0];
    expect(agent.runningCount).toBe(1);
    expect(agent.state).toBe("running");

    tracker.startRun("dev");
    agent = tracker.getAllAgents()[0];
    expect(agent.runningCount).toBe(2);
    expect(agent.state).toBe("running");
  });

  it("endRun decrements running count and transitions to idle when zero", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev", 2);

    tracker.startRun("dev");
    tracker.startRun("dev");

    tracker.endRun("dev", 5000);
    let agent = tracker.getAllAgents()[0];
    expect(agent.runningCount).toBe(1);
    expect(agent.state).toBe("running"); // still one running

    tracker.endRun("dev", 3000);
    agent = tracker.getAllAgents()[0];
    expect(agent.runningCount).toBe(0);
    expect(agent.state).toBe("idle");
    expect(agent.lastRunDuration).toBe(3000);
  });

  it("endRun with error sets error state even if other instances running", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev", 2);

    tracker.startRun("dev");
    tracker.startRun("dev");

    tracker.endRun("dev", 5000, "Session failed");
    const agent = tracker.getAllAgents()[0];
    expect(agent.runningCount).toBe(1);
    expect(agent.state).toBe("error");
    expect(agent.lastError).toBe("Session failed");
  });

  it("createInstance + startRun does not double-count runningCount (scale > 1)", () => {
    // Regression: lifecycle event listeners in createInstance() used to set
    // agent.runningCount = lifecycle.runningInstanceCount, but the runner
    // also calls startRun() which increments runningCount. For scale=2 agents
    // this caused the dashboard to show "running 2/2" when only 1 instance
    // was actually started.
    const tracker = new StatusTracker();
    tracker.registerAgent("dev", 2);

    // Simulate the real execution flow:
    // 1. runWithReruns creates an instance lifecycle
    const instanceLifecycle = tracker.createInstance("dev-abc123", "dev", "schedule");
    expect(instanceLifecycle).not.toBeNull();

    // 2. executeRun calls instanceLifecycle.start()
    instanceLifecycle!.start();

    // 3. runner.run() internally calls statusTracker.startRun()
    tracker.startRun("dev");

    // Should be 1, not 2
    const agent = tracker.getAllAgents()[0];
    expect(agent.runningCount).toBe(1);
    expect(agent.state).toBe("running");
  });

  it("createInstance + endRun correctly reaches zero for scale > 1", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev", 2);

    // Start a run through both paths
    const instanceLifecycle = tracker.createInstance("dev-abc123", "dev", "schedule");
    instanceLifecycle!.start();
    tracker.startRun("dev");

    // End the run through both paths (runner endRun first, then lifecycle complete)
    tracker.endRun("dev", 5000);
    instanceLifecycle!.complete();

    const agent = tracker.getAllAgents()[0];
    expect(agent.runningCount).toBe(0);
    expect(agent.state).toBe("idle");
  });

  it("two concurrent instances with scale=2 shows correct count", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev", 2);

    // Start first instance
    const instance1 = tracker.createInstance("dev-001", "dev", "schedule");
    instance1!.start();
    tracker.startRun("dev");

    // Start second instance
    const instance2 = tracker.createInstance("dev-002", "dev", "webhook:push");
    instance2!.start();
    tracker.startRun("dev");

    let agent = tracker.getAllAgents()[0];
    expect(agent.runningCount).toBe(2);
    expect(agent.state).toBe("running");

    // First finishes
    tracker.endRun("dev", 3000);
    instance1!.complete();

    agent = tracker.getAllAgents()[0];
    expect(agent.runningCount).toBe(1);
    expect(agent.state).toBe("running");

    // Second finishes
    tracker.endRun("dev", 4000);
    instance2!.complete();

    agent = tracker.getAllAgents()[0];
    expect(agent.runningCount).toBe(0);
    expect(agent.state).toBe("idle");
  });
});
