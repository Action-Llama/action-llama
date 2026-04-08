/**
 * Integration tests: StatusTracker.createInstance() and getAgentLifecycle() — no Docker required.
 *
 * createInstance() is a key method in StatusTracker that creates an InstanceLifecycle
 * object and wires it up to the StatusTracker's event system. It is called by
 * execution/execution.ts during runWithReruns() and drainQueues() to track
 * per-instance lifecycle state.
 *
 * getAgentLifecycle() provides access to the AgentLifecycle object for a named agent,
 * used by the status tracker infrastructure.
 *
 * Test scenarios (no Docker required):
 *   1. createInstance() returns null when agentName is not registered
 *   2. createInstance() returns an InstanceLifecycle for a registered agent
 *   3. InstanceLifecycle has the correct instanceId
 *   4. InstanceLifecycle has the correct agentName
 *   5. InstanceLifecycle has the correct trigger
 *   6. createInstance() adds the instance to the AgentLifecycle
 *   7. createInstance() triggers "update" event when instance transitions
 *   8. createInstance() isQueued initially (InstanceLifecycle initial state)
 *   9. Two calls to createInstance() for same agent → two independent instances
 *  10. createInstance() for different agents → independent InstanceLifecycles
 *  11. getAgentLifecycle() returns undefined for unregistered agent
 *  12. getAgentLifecycle() returns AgentLifecycle for registered agent
 *  13. getAgentLifecycle() returns same object across multiple calls
 *  14. InstanceLifecycle.start() triggers StatusTracker "update" event
 *  15. InstanceLifecycle.complete() triggers StatusTracker "update" event
 *  16. InstanceLifecycle.fail() triggers StatusTracker "update" event
 *  17. InstanceLifecycle.kill() triggers StatusTracker "update" event
 *
 * Covers:
 *   - tui/status-tracker.ts: createInstance() — null when agent not registered
 *   - tui/status-tracker.ts: createInstance() — returns InstanceLifecycle for registered agent
 *   - tui/status-tracker.ts: createInstance() — instanceId/agentName/trigger set correctly
 *   - tui/status-tracker.ts: createInstance() — lifecycle added to AgentLifecycle
 *   - tui/status-tracker.ts: createInstance() — "update" emitted on instance:start event
 *   - tui/status-tracker.ts: createInstance() — "update" emitted on instance:complete event
 *   - tui/status-tracker.ts: createInstance() — "update" emitted on instance:error event
 *   - tui/status-tracker.ts: createInstance() — "update" emitted on instance:kill event
 *   - tui/status-tracker.ts: getAgentLifecycle() — undefined for unknown agent
 *   - tui/status-tracker.ts: getAgentLifecycle() — AgentLifecycle for registered agent
 *   - tui/status-tracker.ts: getAgentLifecycle() — stable reference across calls
 */

import { describe, it, expect, vi } from "vitest";
import { StatusTracker } from "@action-llama/action-llama/internals/status-tracker";

describe("status-tracker createInstance()", { timeout: 10_000 }, () => {

  // ── null when agent not registered ────────────────────────────────────────

  it("returns null when agentName is not registered", () => {
    const tracker = new StatusTracker();
    const result = tracker.createInstance("inst-1", "nonexistent-agent", "schedule");
    expect(result).toBeNull();
  });

  it("returns null for any trigger type when agent is not registered", () => {
    const tracker = new StatusTracker();
    expect(tracker.createInstance("i1", "missing", "webhook:github")).toBeNull();
    expect(tracker.createInstance("i2", "missing", "manual")).toBeNull();
    expect(tracker.createInstance("i3", "missing", "agent:other")).toBeNull();
  });

  // ── returns InstanceLifecycle for registered agent ─────────────────────────

  it("returns an InstanceLifecycle object for a registered agent", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("my-agent", 1);

    const lifecycle = tracker.createInstance("inst-abc", "my-agent", "schedule");
    expect(lifecycle).not.toBeNull();
    expect(typeof lifecycle).toBe("object");
  });

  it("returned InstanceLifecycle has correct instanceId", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("my-agent", 1);

    const lifecycle = tracker.createInstance("inst-xyz", "my-agent", "manual");
    expect(lifecycle!.instanceId).toBe("inst-xyz");
  });

  it("returned InstanceLifecycle has correct agentName", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("my-agent", 1);

    const lifecycle = tracker.createInstance("inst-xyz", "my-agent", "manual");
    expect(lifecycle!.agentName).toBe("my-agent");
  });

  it("returned InstanceLifecycle has correct trigger", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("my-agent", 1);

    const lifecycle = tracker.createInstance("inst-xyz", "my-agent", "webhook:github");
    expect(lifecycle!.trigger).toBe("webhook:github");
  });

  it("returned InstanceLifecycle.isQueued() is true initially", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("queued-agent", 1);

    const lifecycle = tracker.createInstance("inst-q", "queued-agent", "schedule");
    expect(lifecycle!.isQueued()).toBe(true);
    expect(lifecycle!.isRunning()).toBe(false);
  });

  // ── adds instance to AgentLifecycle ───────────────────────────────────────

  it("AgentLifecycle.getInstances() includes the created InstanceLifecycle", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("lifecycle-agent", 1);

    tracker.createInstance("inst-for-lifecycle", "lifecycle-agent", "manual");
    const agentLC = tracker.getAgentLifecycle("lifecycle-agent");
    expect(agentLC).toBeDefined();

    const instances = agentLC!.getInstances();
    // getInstances() returns a ReadonlyMap<string, InstanceLifecycle>
    expect(instances.has("inst-for-lifecycle")).toBe(true);
  });

  // ── two independent instances ──────────────────────────────────────────────

  it("two calls to createInstance() for same agent create two independent lifecycles", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("multi-instance-agent", 1);

    const lc1 = tracker.createInstance("inst-1", "multi-instance-agent", "schedule");
    const lc2 = tracker.createInstance("inst-2", "multi-instance-agent", "schedule");

    expect(lc1).not.toBeNull();
    expect(lc2).not.toBeNull();
    expect(lc1).not.toBe(lc2);
    expect(lc1!.instanceId).toBe("inst-1");
    expect(lc2!.instanceId).toBe("inst-2");
  });

  it("createInstance() for different agents → independent InstanceLifecycles", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("agent-a", 1);
    tracker.registerAgent("agent-b", 1);

    const lcA = tracker.createInstance("inst-a", "agent-a", "schedule");
    const lcB = tracker.createInstance("inst-b", "agent-b", "webhook:github");

    expect(lcA!.agentName).toBe("agent-a");
    expect(lcB!.agentName).toBe("agent-b");
    expect(lcA!.instanceId).not.toBe(lcB!.instanceId);
  });

  // ── "update" events emitted on lifecycle transitions ─────────────────────

  it("instance:start → StatusTracker emits 'update'", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("event-agent", 1);

    const lifecycle = tracker.createInstance("inst-ev", "event-agent", "manual")!;
    const onUpdate = vi.fn();
    tracker.on("update", onUpdate);

    lifecycle.start();

    expect(onUpdate).toHaveBeenCalled();
    tracker.removeListener("update", onUpdate);
  });

  it("instance:complete → StatusTracker emits 'update'", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("event-agent2", 1);

    const lifecycle = tracker.createInstance("inst-ev2", "event-agent2", "schedule")!;
    lifecycle.start();

    const onUpdate = vi.fn();
    tracker.on("update", onUpdate);

    lifecycle.complete("all done");

    expect(onUpdate).toHaveBeenCalled();
    tracker.removeListener("update", onUpdate);
  });

  it("instance:error → StatusTracker emits 'update'", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("event-agent3", 1);

    const lifecycle = tracker.createInstance("inst-ev3", "event-agent3", "schedule")!;
    lifecycle.start();

    const onUpdate = vi.fn();
    tracker.on("update", onUpdate);

    lifecycle.fail("something went wrong");

    expect(onUpdate).toHaveBeenCalled();
    tracker.removeListener("update", onUpdate);
  });

  it("instance:kill → StatusTracker emits 'update'", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("event-agent4", 1);

    const lifecycle = tracker.createInstance("inst-ev4", "event-agent4", "schedule")!;

    const onUpdate = vi.fn();
    tracker.on("update", onUpdate);

    lifecycle.kill(); // kill from queued state

    expect(onUpdate).toHaveBeenCalled();
    tracker.removeListener("update", onUpdate);
  });
});

// ── getAgentLifecycle() ───────────────────────────────────────────────────────

describe("status-tracker getAgentLifecycle()", { timeout: 10_000 }, () => {

  it("returns undefined for an unregistered agent", () => {
    const tracker = new StatusTracker();
    const result = tracker.getAgentLifecycle("not-registered");
    expect(result).toBeUndefined();
  });

  it("returns an AgentLifecycle for a registered agent", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("reg-agent", 1);

    const lifecycle = tracker.getAgentLifecycle("reg-agent");
    expect(lifecycle).toBeDefined();
    expect(typeof lifecycle).toBe("object");
  });

  it("returns the same AgentLifecycle object across multiple calls", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("stable-agent", 1);

    const lc1 = tracker.getAgentLifecycle("stable-agent");
    const lc2 = tracker.getAgentLifecycle("stable-agent");
    expect(lc1).toBe(lc2);
  });

  it("returns undefined after agent is unregistered", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("temp-agent", 1);

    expect(tracker.getAgentLifecycle("temp-agent")).toBeDefined();

    tracker.unregisterAgent("temp-agent");

    expect(tracker.getAgentLifecycle("temp-agent")).toBeUndefined();
  });

  it("different agents return different AgentLifecycle objects", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("alpha", 1);
    tracker.registerAgent("beta", 1);

    const lcAlpha = tracker.getAgentLifecycle("alpha");
    const lcBeta = tracker.getAgentLifecycle("beta");

    expect(lcAlpha).not.toBe(lcBeta);
  });

  it("AgentLifecycle has getInstances() method accessible returning a Map", () => {
    const tracker = new StatusTracker();
    tracker.registerAgent("method-agent", 1);

    const lifecycle = tracker.getAgentLifecycle("method-agent");
    expect(typeof lifecycle!.getInstances).toBe("function");
    // getInstances() returns ReadonlyMap<string, InstanceLifecycle>
    const instances = lifecycle!.getInstances();
    expect(typeof instances.has).toBe("function");
    expect(typeof instances.get).toBe("function");
  });
});
