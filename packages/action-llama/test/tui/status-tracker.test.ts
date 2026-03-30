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

  // --- Invalidation signal tests ---

  it("startRun accumulates runs, triggers, and stats signals", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");

    tracker.startRun("dev");
    const signals = tracker.flushInvalidations();

    expect(signals).toContainEqual({ type: "runs", agent: "dev" });
    expect(signals).toContainEqual({ type: "triggers" });
    expect(signals).toContainEqual({ type: "stats", agent: "dev" });
  });

  it("endRun accumulates runs and stats signals", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.startRun("dev");
    tracker.flushInvalidations(); // clear

    tracker.endRun("dev", 5000);
    const signals = tracker.flushInvalidations();

    expect(signals).toContainEqual({ type: "runs", agent: "dev" });
    expect(signals).toContainEqual({ type: "stats", agent: "dev" });
    expect(signals).not.toContainEqual(expect.objectContaining({ type: "triggers" }));
  });

  it("flushInvalidations returns and clears the list", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.startRun("dev");

    const first = tracker.flushInvalidations();
    expect(first.length).toBeGreaterThan(0);

    const second = tracker.flushInvalidations();
    expect(second).toHaveLength(0);
  });

  it("deduplicates identical invalidation signals", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");

    // startRun produces runs:dev, triggers, stats:dev
    // endRun also produces runs:dev, stats:dev
    tracker.startRun("dev");
    tracker.endRun("dev", 1000);

    const signals = tracker.flushInvalidations();
    const runSignals = signals.filter((s) => s.type === "runs" && s.agent === "dev");
    expect(runSignals).toHaveLength(1);
  });

  it("enableAgent/disableAgent emit config signals", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.flushInvalidations(); // clear

    tracker.enableAgent("dev");
    tracker.disableAgent("dev");

    const signals = tracker.flushInvalidations();
    // config should be deduped to one
    const configSignals = signals.filter((s) => s.type === "config");
    expect(configSignals).toHaveLength(1);
  });

  it("completeInstance emits instance and runs signals", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.registerInstance({ id: "inst-1", agentName: "dev", status: "running", startedAt: new Date().toISOString(), trigger: "schedule" } as any);
    tracker.flushInvalidations(); // clear

    tracker.completeInstance("inst-1", "completed");

    const signals = tracker.flushInvalidations();
    expect(signals).toContainEqual({ type: "instance", agent: "dev", instanceId: "inst-1" });
    expect(signals).toContainEqual({ type: "runs", agent: "dev" });
  });

  it("getAllAgents is unaffected by invalidation tracking", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.startRun("dev");

    const agents = tracker.getAllAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].state).toBe("running");
  });

  it("startRun allows runningCount to exceed scale (no clamping)", () => {
    // During scale transitions or race conditions, runningCount should reflect
    // the actual number of running instances — not be capped at scale.
    const tracker = new StatusTracker();
    tracker.registerAgent("dev", 2);

    tracker.startRun("dev");
    tracker.startRun("dev");
    tracker.startRun("dev"); // third run on a scale=2 agent

    const agent = tracker.getAllAgents()[0];
    expect(agent.runningCount).toBe(3);
  });

  it("updateAgentScale preserves runningCount", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev", 2);

    tracker.startRun("dev");
    tracker.startRun("dev");

    tracker.updateAgentScale("dev", 3);

    const agent = tracker.getAllAgents()[0];
    expect(agent.runningCount).toBe(2); // unchanged
    expect(agent.scale).toBe(3);
    expect(agent.state).toBe("running");
  });

  it("registerAgent resets runningCount (documents behavior)", () => {
    // registerAgent() completely replaces the agent status object, resetting
    // runningCount to 0. This is why watcher.ts uses updateAgentScale for
    // scale changes instead of re-registering, to avoid losing running state.
    const tracker = new StatusTracker();
    tracker.registerAgent("dev", 2);

    tracker.startRun("dev");
    tracker.startRun("dev");

    // Re-registering resets everything
    tracker.registerAgent("dev", 3);

    const agent = tracker.getAllAgents()[0];
    expect(agent.runningCount).toBe(0);
    expect(agent.scale).toBe(3);
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

  // ── unregisterAgent ───────────────────────────────────────────────────────

  it("unregisterAgent removes agent and emits update", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.registerAgent("reviewer");

    const listener = vi.fn();
    tracker.on("update", listener);

    tracker.unregisterAgent("dev");

    expect(tracker.getAllAgents()).toHaveLength(1);
    expect(tracker.getAllAgents()[0].name).toBe("reviewer");
    expect(listener).toHaveBeenCalled();
  });

  it("unregisterAgent is safe for unknown agent", () => {
    const tracker = new StatusTracker();
    expect(() => tracker.unregisterAgent("nonexistent")).not.toThrow();
  });

  // ── endRun with token usage ───────────────────────────────────────────────

  it("endRun accumulates token usage", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.startRun("dev");

    const usage = {
      inputTokens: 100, outputTokens: 50,
      cacheReadTokens: 10, cacheWriteTokens: 5,
      totalTokens: 165, cost: 0.01, turnCount: 3,
    };
    tracker.endRun("dev", 5000, undefined, usage);

    const agent = tracker.getAllAgents()[0];
    expect(agent.lastRunUsage?.inputTokens).toBe(100);
    expect(agent.cumulativeUsage?.inputTokens).toBe(100);

    // Second run accumulates
    tracker.startRun("dev");
    tracker.endRun("dev", 3000, undefined, usage);
    const agent2 = tracker.getAllAgents()[0];
    expect(agent2.cumulativeUsage?.inputTokens).toBe(200);
    expect(agent2.cumulativeUsage?.totalTokens).toBe(330);
  });

  // ── completeRun ───────────────────────────────────────────────────────────

  it("completeRun sets state to idle on success", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.completeRun("dev", 5000);
    const agent = tracker.getAllAgents()[0];
    expect(agent.state).toBe("idle");
    expect(agent.lastRunDuration).toBe(5000);
    expect(agent.lastRunAt).not.toBeNull();
  });

  it("completeRun sets state to error on failure", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.completeRun("dev", 2000, "Container exited with code 1");
    const agent = tracker.getAllAgents()[0];
    expect(agent.state).toBe("error");
    expect(agent.lastError).toBe("Container exited with code 1");
  });

  // ── setQueuedWebhooks ─────────────────────────────────────────────────────

  it("setQueuedWebhooks updates queue count", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setQueuedWebhooks("dev", 5);
    const agent = tracker.getAllAgents()[0];
    expect(agent.queuedWebhooks).toBe(5);
  });

  // ── baseImageStatus ───────────────────────────────────────────────────────

  it("setBaseImageStatus / getBaseImageStatus round-trips", () => {
    const tracker = new StatusTracker();
    expect(tracker.getBaseImageStatus()).toBeNull();
    tracker.setBaseImageStatus("Building base image...");
    expect(tracker.getBaseImageStatus()).toBe("Building base image...");
    tracker.setBaseImageStatus(null);
    expect(tracker.getBaseImageStatus()).toBeNull();
  });

  // ── instance lifecycle ────────────────────────────────────────────────────

  it("registerInstance and unregisterInstance track instances", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");

    tracker.registerInstance({
      id: "dev-abc123",
      agentName: "dev",
      status: "running",
      startedAt: new Date(),
      trigger: "schedule",
    });

    expect(tracker.getInstances()).toHaveLength(1);
    expect(tracker.getInstances()[0].id).toBe("dev-abc123");

    tracker.unregisterInstance("dev-abc123");
    expect(tracker.getInstances()).toHaveLength(0);
  });

  // ── setPaused / isPaused ──────────────────────────────────────────────────

  it("setPaused and isPaused work when schedulerInfo is set", () => {
    const tracker = new StatusTracker();
    tracker.setSchedulerInfo({ uptime: 0, paused: false, shuttingDown: false });

    expect(tracker.isPaused()).toBe(false);
    tracker.setPaused(true);
    expect(tracker.isPaused()).toBe(true);
    tracker.setPaused(false);
    expect(tracker.isPaused()).toBe(false);
  });

  it("isPaused returns false when schedulerInfo is not set", () => {
    const tracker = new StatusTracker();
    expect(tracker.isPaused()).toBe(false);
  });

  it("setPaused is safe when schedulerInfo is not set", () => {
    const tracker = new StatusTracker();
    expect(() => tracker.setPaused(true)).not.toThrow();
  });

  // ── setAgentDescription ───────────────────────────────────────────────────

  it("setAgentDescription updates description", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setAgentDescription("dev", "My custom description");
    const agent = tracker.getAllAgents()[0];
    expect(agent.description).toBe("My custom description");
  });

  // ── setTaskUrl ────────────────────────────────────────────────────────────

  it("setTaskUrl stores and clears task URL", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.setTaskUrl("dev", "https://console.example.com/tasks/123");
    expect(tracker.getAllAgents()[0].taskUrl).toBe("https://console.example.com/tasks/123");
    tracker.setTaskUrl("dev", null);
    expect(tracker.getAllAgents()[0].taskUrl).toBeNull();
  });

  // ── getAgentLifecycle ─────────────────────────────────────────────────────

  it("getAgentLifecycle returns lifecycle for registered agent", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    const lifecycle = tracker.getAgentLifecycle("dev");
    expect(lifecycle).toBeDefined();
  });

  it("getAgentLifecycle returns undefined for unknown agent", () => {
    const tracker = new StatusTracker();
    expect(tracker.getAgentLifecycle("nonexistent")).toBeUndefined();
  });

  // ── getAgentScale ─────────────────────────────────────────────────────────

  it("getAgentScale returns current scale", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev", 3);
    expect(tracker.getAgentScale("dev")).toBe(3);
  });

  it("getAgentScale returns 1 for unknown agent", () => {
    const tracker = new StatusTracker();
    expect(tracker.getAgentScale("unknown")).toBe(1);
  });

  // ── startBuild / completeBuild ────────────────────────────────────────────

  it("startBuild sets agent state to building", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.startBuild("dev", "image update");
    const agent = tracker.getAllAgents()[0];
    expect(agent.state).toBe("building");
  });

  it("completeBuild transitions agent from building to idle", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");

    tracker.startBuild("dev", "image update");
    expect(tracker.getAllAgents()[0].state).toBe("building");

    tracker.completeBuild("dev");
    const agent = tracker.getAllAgents()[0];
    expect(agent.state).toBe("idle");
  });

  it("completeBuild fires agent:build-complete event and emits update", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.startBuild("dev");

    const listener = vi.fn();
    tracker.on("update", listener);

    tracker.completeBuild("dev");
    expect(listener).toHaveBeenCalled();
  });

  it("completeBuild is safe for unknown agent (guard return)", () => {
    const tracker = new StatusTracker();
    expect(() => tracker.completeBuild("nonexistent")).not.toThrow();
  });

  it("startBuild is safe for unknown agent (guard return)", () => {
    const tracker = new StatusTracker();
    expect(() => tracker.startBuild("nonexistent", "reason")).not.toThrow();
  });

  // ── guard returns for unknown agents ─────────────────────────────────────

  it("startRun is safe for unknown agent", () => {
    const tracker = new StatusTracker();
    expect(() => tracker.startRun("nonexistent")).not.toThrow();
    expect(tracker.getAllAgents()).toHaveLength(0);
  });

  it("endRun is safe for unknown agent", () => {
    const tracker = new StatusTracker();
    expect(() => tracker.endRun("nonexistent", 1000)).not.toThrow();
    expect(tracker.getAllAgents()).toHaveLength(0);
  });

  it("setTaskUrl is safe for unknown agent", () => {
    const tracker = new StatusTracker();
    expect(() => tracker.setTaskUrl("nonexistent", "https://example.com")).not.toThrow();
    expect(tracker.getAllAgents()).toHaveLength(0);
  });

  it("setAgentDescription is safe for unknown agent", () => {
    const tracker = new StatusTracker();
    expect(() => tracker.setAgentDescription("nonexistent", "some desc")).not.toThrow();
    expect(tracker.getAllAgents()).toHaveLength(0);
  });

  it("setAgentError is safe for unknown agent", () => {
    const tracker = new StatusTracker();
    expect(() => tracker.setAgentError("nonexistent", "some error")).not.toThrow();
    expect(tracker.getAllAgents()).toHaveLength(0);
  });

  it("setQueuedWebhooks is safe for unknown agent", () => {
    const tracker = new StatusTracker();
    expect(() => tracker.setQueuedWebhooks("nonexistent", 5)).not.toThrow();
    expect(tracker.getAllAgents()).toHaveLength(0);
  });

  it("completeInstance is safe for unknown instance id", () => {
    const tracker = new StatusTracker();
    expect(() => tracker.completeInstance("nonexistent-instance", "completed")).not.toThrow();
  });

  it("updateAgentScale is safe for unknown agent", () => {
    const tracker = new StatusTracker();
    expect(() => tracker.updateAgentScale("nonexistent", 3)).not.toThrow();
    expect(tracker.getAllAgents()).toHaveLength(0);
  });

  it("createInstance returns null for unknown agent", () => {
    const tracker = new StatusTracker();
    const result = tracker.createInstance("inst-1", "nonexistent", "schedule");
    expect(result).toBeNull();
  });

  // ── AgentLifecycle event handlers wired in registerAgent ─────────────────

  it("agent:build-complete event on lifecycle emits tracker update", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");
    tracker.startBuild("dev");

    const listener = vi.fn();
    tracker.on("update", listener);
    listener.mockClear();

    // Trigger agent:build-complete by completing the build through the lifecycle
    const lifecycle = tracker.getAgentLifecycle("dev");
    lifecycle!.completeBuild();

    expect(listener).toHaveBeenCalled();
  });

  it("agent:error event on lifecycle emits tracker update", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");

    const listener = vi.fn();
    tracker.on("update", listener);
    listener.mockClear();

    const lifecycle = tracker.getAgentLifecycle("dev");
    lifecycle!.setError("something went wrong");

    expect(listener).toHaveBeenCalled();
  });

  it("agent:error-cleared event on lifecycle emits tracker update", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");

    const lifecycle = tracker.getAgentLifecycle("dev");
    lifecycle!.setError("initial error");

    const listener = vi.fn();
    tracker.on("update", listener);
    listener.mockClear();

    lifecycle!.clearError();

    expect(listener).toHaveBeenCalled();
  });

  // ── instance lifecycle event handlers in createInstance ──────────────────

  it("instance:error event on InstanceLifecycle emits tracker update", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");

    const instanceLifecycle = tracker.createInstance("dev-err1", "dev", "schedule");
    expect(instanceLifecycle).not.toBeNull();

    instanceLifecycle!.start();

    const listener = vi.fn();
    tracker.on("update", listener);
    listener.mockClear();

    instanceLifecycle!.fail("container exited with code 1");

    expect(listener).toHaveBeenCalled();
  });

  it("instance:kill event on InstanceLifecycle emits tracker update", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("dev");

    const instanceLifecycle = tracker.createInstance("dev-kill1", "dev", "schedule");
    expect(instanceLifecycle).not.toBeNull();

    const listener = vi.fn();
    tracker.on("update", listener);
    listener.mockClear();

    instanceLifecycle!.kill("shutting down");

    expect(listener).toHaveBeenCalled();
  });
});
