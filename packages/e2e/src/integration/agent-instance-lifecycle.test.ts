/**
 * Integration tests: execution/lifecycle/agent-lifecycle.ts and
 * execution/lifecycle/instance-lifecycle.ts — no Docker required.
 *
 * These classes implement state machines for managing agent and instance lifecycles.
 * They are currently only exercised indirectly through the scheduler, but can
 * be tested directly without any infrastructure.
 *
 * InstanceLifecycle covers:
 *   - constructor: starts in "queued" state with correct info
 *   - getters: instanceId, agentName, trigger
 *   - durationMs: null before start/complete, positive after complete
 *   - start(): transitions to "running", sets startedAt
 *   - complete(): transitions to "completed", sets endedAt
 *   - fail(): transitions to "error" from "running"
 *   - kill(): transitions to "killed" from "queued" or "running"
 *   - isTerminal(): false in queued/running, true in completed/error/killed
 *   - isRunning(): true only in "running" state
 *   - isQueued(): true only in "queued" state
 *   - complete() from non-running throws Error
 *
 * AgentLifecycle covers:
 *   - constructor: starts in "idle" state
 *   - getters: agentName, runningInstanceCount, totalInstanceCount
 *   - getInfo(): returns copy of info
 *   - startBuild(): transitions to "building"
 *   - completeBuild(): transitions back to "idle", sets lastBuildAt
 *   - addInstance(): increments totalInstanceCount
 *   - removeInstance(): returns false for unknown ID, removes known instance
 *   - setError(): transitions to "error", stores error message
 *   - clearError(): clears error message
 *   - getError(): returns current error string or undefined
 *   - hasRunningInstances(): false at idle, true when instances running
 *   - isBuilding(): true only in "building" state
 *   - hasError(): true only in "error" state
 *   - state transitions via instance lifecycle (addInstance + start → running, kill → back to idle)
 *   - getInstances(): returns map of instances
 *
 * Covers:
 *   - execution/lifecycle/instance-lifecycle.ts: InstanceLifecycle all methods
 *   - execution/lifecycle/agent-lifecycle.ts: AgentLifecycle all methods
 */

import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";

const { InstanceLifecycle } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/execution/lifecycle/instance-lifecycle.js"
);

const { AgentLifecycle } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/execution/lifecycle/agent-lifecycle.js"
);

// ── InstanceLifecycle ────────────────────────────────────────────────────────

describe("InstanceLifecycle (execution/lifecycle/instance-lifecycle.ts)", { timeout: 10_000 }, () => {
  it("constructor starts in 'queued' state with correct getters", () => {
    const id = randomUUID();
    const inst = new InstanceLifecycle(id, "my-agent", "manual");

    expect(inst.currentState).toBe("queued");
    expect(inst.instanceId).toBe(id);
    expect(inst.agentName).toBe("my-agent");
    expect(inst.trigger).toBe("manual");
    expect(inst.durationMs).toBeNull();
  });

  it("getInfo() returns a copy of the info object", () => {
    const id = randomUUID();
    const inst = new InstanceLifecycle(id, "test-agent", "webhook:github");
    const info = inst.getInfo();
    expect(info.instanceId).toBe(id);
    expect(info.agentName).toBe("test-agent");
    expect(info.trigger).toBe("webhook:github");
    expect(info.startedAt).toBeNull();
    expect(info.endedAt).toBeNull();
  });

  it("isQueued() true in queued, isRunning() false, isTerminal() false", () => {
    const inst = new InstanceLifecycle(randomUUID(), "agent", "manual");
    expect(inst.isQueued()).toBe(true);
    expect(inst.isRunning()).toBe(false);
    expect(inst.isTerminal()).toBe(false);
  });

  it("start() transitions to 'running', sets startedAt", () => {
    const inst = new InstanceLifecycle(randomUUID(), "agent", "manual");
    const before = Date.now();
    inst.start();
    expect(inst.currentState).toBe("running");
    expect(inst.isRunning()).toBe(true);
    expect(inst.isQueued()).toBe(false);
    expect(inst.getInfo().startedAt).not.toBeNull();
    expect(inst.getInfo().startedAt!.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("complete() transitions to 'completed' from running, sets endedAt and durationMs", async () => {
    const inst = new InstanceLifecycle(randomUUID(), "agent", "schedule");
    inst.start();
    await new Promise((r) => setTimeout(r, 5)); // ensure positive duration
    inst.complete();

    expect(inst.currentState).toBe("completed");
    expect(inst.isTerminal()).toBe(true);
    expect(inst.isRunning()).toBe(false);
    expect(inst.getInfo().endedAt).not.toBeNull();
    expect(inst.durationMs).toBeGreaterThan(0);
  });

  it("complete() throws Error if called from non-running state", () => {
    const inst = new InstanceLifecycle(randomUUID(), "agent", "manual");
    // Currently in "queued" state
    expect(() => inst.complete()).toThrow("Cannot complete instance");
  });

  it("fail() transitions to 'error' from running", () => {
    const inst = new InstanceLifecycle(randomUUID(), "agent", "manual");
    inst.start();
    inst.fail("container crashed");

    expect(inst.currentState).toBe("error");
    expect(inst.isTerminal()).toBe(true);
    expect(inst.getInfo().error).toBe("container crashed");
  });

  it("kill() transitions to 'killed' from queued state", () => {
    const inst = new InstanceLifecycle(randomUUID(), "agent", "manual");
    // From "queued"
    inst.kill("user request");
    expect(inst.currentState).toBe("killed");
    expect(inst.isTerminal()).toBe(true);
  });

  it("kill() transitions to 'killed' from running state", () => {
    const inst = new InstanceLifecycle(randomUUID(), "agent", "manual");
    inst.start();
    inst.kill("timeout");
    expect(inst.currentState).toBe("killed");
    expect(inst.isTerminal()).toBe(true);
  });

  it("durationMs returns null when not started", () => {
    const inst = new InstanceLifecycle(randomUUID(), "agent", "manual");
    expect(inst.durationMs).toBeNull();
  });

  it("durationMs returns null when started but not completed", () => {
    const inst = new InstanceLifecycle(randomUUID(), "agent", "manual");
    inst.start();
    expect(inst.durationMs).toBeNull();
  });
});

// ── AgentLifecycle ───────────────────────────────────────────────────────────

describe("AgentLifecycle (execution/lifecycle/agent-lifecycle.ts)", { timeout: 10_000 }, () => {
  it("constructor starts in 'idle' state with correct agent name", () => {
    const agent = new AgentLifecycle("my-agent");
    expect(agent.currentState).toBe("idle");
    expect(agent.agentName).toBe("my-agent");
    expect(agent.runningInstanceCount).toBe(0);
    expect(agent.totalInstanceCount).toBe(0);
  });

  it("getInfo() returns a copy of the info", () => {
    const agent = new AgentLifecycle("reporter");
    const info = agent.getInfo();
    expect(info.name).toBe("reporter");
    expect(info.runningInstanceCount).toBe(0);
    expect(info.lastRunAt).toBeNull();
    expect(info.lastBuildAt).toBeNull();
  });

  it("isBuilding() false at idle, hasError() false at idle", () => {
    const agent = new AgentLifecycle("test-agent");
    expect(agent.isBuilding()).toBe(false);
    expect(agent.hasError()).toBe(false);
    expect(agent.hasRunningInstances()).toBe(false);
  });

  it("startBuild() transitions to 'building' state", () => {
    const agent = new AgentLifecycle("builder");
    agent.startBuild("initial build");
    expect(agent.currentState).toBe("building");
    expect(agent.isBuilding()).toBe(true);
  });

  it("completeBuild() transitions back to 'idle', sets lastBuildAt", () => {
    const agent = new AgentLifecycle("builder");
    agent.startBuild();
    const before = Date.now();
    agent.completeBuild();
    expect(agent.currentState).toBe("idle");
    expect(agent.isBuilding()).toBe(false);
    expect(agent.getInfo().lastBuildAt).not.toBeNull();
    expect(agent.getInfo().lastBuildAt!.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("setError() transitions to 'error' state and stores message", () => {
    const agent = new AgentLifecycle("agent");
    agent.setError("build failed");
    expect(agent.currentState).toBe("error");
    expect(agent.hasError()).toBe(true);
    expect(agent.getError()).toBe("build failed");
  });

  it("clearError() removes the error message", () => {
    const agent = new AgentLifecycle("agent");
    agent.setError("some error");
    expect(agent.getError()).toBe("some error");
    agent.clearError();
    expect(agent.getError()).toBeUndefined();
  });

  it("addInstance() increments totalInstanceCount", () => {
    const agent = new AgentLifecycle("agent");
    const inst = new InstanceLifecycle(randomUUID(), "agent", "manual");
    agent.addInstance(inst);
    expect(agent.totalInstanceCount).toBe(1);
  });

  it("addInstance + start → runningInstanceCount increases, state → 'running'", () => {
    const agent = new AgentLifecycle("agent");
    const inst = new InstanceLifecycle(randomUUID(), "agent", "manual");
    agent.addInstance(inst);
    inst.start(); // fires instance:start event
    expect(agent.currentState).toBe("running");
    expect(agent.runningInstanceCount).toBe(1);
    expect(agent.hasRunningInstances()).toBe(true);
  });

  it("instance complete → runningInstanceCount decreases → state back to 'idle'", () => {
    const agent = new AgentLifecycle("agent");
    const inst = new InstanceLifecycle(randomUUID(), "agent", "manual");
    agent.addInstance(inst);
    inst.start();
    expect(agent.currentState).toBe("running");

    inst.complete();
    expect(agent.runningInstanceCount).toBe(0);
    expect(agent.hasRunningInstances()).toBe(false);
    // After last instance completes, agent should be back to idle
    expect(agent.currentState).toBe("idle");
    // lastRunAt should be set
    expect(agent.getInfo().lastRunAt).not.toBeNull();
  });

  it("instance kill from queued → agent remains idle (no running count change)", () => {
    const agent = new AgentLifecycle("agent");
    const inst = new InstanceLifecycle(randomUUID(), "agent", "manual");
    agent.addInstance(inst);
    // Kill before start (queued → killed)
    inst.kill("user cancelled");
    // Running count was never incremented, so agent stays idle
    expect(agent.runningInstanceCount).toBe(0);
    expect(agent.currentState).toBe("idle");
  });

  it("removeInstance() returns false for unknown instanceId", () => {
    const agent = new AgentLifecycle("agent");
    const result = agent.removeInstance("nonexistent-id");
    expect(result).toBe(false);
  });

  it("removeInstance() returns true and removes known instance", () => {
    const agent = new AgentLifecycle("agent");
    const id = randomUUID();
    const inst = new InstanceLifecycle(id, "agent", "manual");
    agent.addInstance(inst);
    expect(agent.totalInstanceCount).toBe(1);

    const result = agent.removeInstance(id);
    expect(result).toBe(true);
    expect(agent.getInstances().has(id)).toBe(false);
  });

  it("getInstances() returns the map of managed instances", () => {
    const agent = new AgentLifecycle("agent");
    const id = randomUUID();
    const inst = new InstanceLifecycle(id, "agent", "manual");
    agent.addInstance(inst);

    const map = agent.getInstances();
    expect(map.has(id)).toBe(true);
    expect(map.get(id)).toBe(inst);
  });

  it("two concurrent instances → running count = 2, both complete → idle", () => {
    const agent = new AgentLifecycle("agent");
    const inst1 = new InstanceLifecycle(randomUUID(), "agent", "manual");
    const inst2 = new InstanceLifecycle(randomUUID(), "agent", "schedule");
    agent.addInstance(inst1);
    agent.addInstance(inst2);
    inst1.start();
    inst2.start();

    expect(agent.runningInstanceCount).toBe(2);
    expect(agent.currentState).toBe("running");

    inst1.complete();
    expect(agent.runningInstanceCount).toBe(1);
    expect(agent.currentState).toBe("running"); // still running

    inst2.complete();
    expect(agent.runningInstanceCount).toBe(0);
    expect(agent.currentState).toBe("idle");
  });
});
