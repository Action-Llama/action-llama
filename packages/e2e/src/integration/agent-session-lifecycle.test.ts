/**
 * Integration tests: execution/lifecycle/agent-lifecycle.ts and
 * execution/lifecycl./session-lifecycle.ts — no Docker required.
 *
 * These classes implement state machines for managing agent and instance lifecycles.
 * They are currently only exercised indirectly through the scheduler, but can
 * be tested directly without any infrastructure.
 *
 * SessionLifecycle covers:
 *   - constructor: starts in "queued" state with correct info
 *   - getters: sessionId, agentName, trigger
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
 *   - getters: agentName, runningSessionCount, totalSessionCount
 *   - getInfo(): returns copy of info
 *   - startBuild(): transitions to "building"
 *   - completeBuild(): transitions back to "idle", sets lastBuildAt
 *   - addSession(): increments totalSessionCount
 *   - removeSession(): returns false for unknown ID, removes known instance
 *   - setError(): transitions to "error", stores error message
 *   - clearError(): clears error message
 *   - getError(): returns current error string or undefined
 *   - hasRunningSessions(): false at idle, true when instances running
 *   - isBuilding(): true only in "building" state
 *   - hasError(): true only in "error" state
 *   - state transitions via instance lifecycle (addSession + start → running, kill → back to idle)
 *   - getSessions(): returns map of instances
 *
 * Covers:
 *   - execution/lifecycl./session-lifecycle.ts: SessionLifecycle all methods
 *   - execution/lifecycle/agent-lifecycle.ts: AgentLifecycle all methods
 */

import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";

const { SessionLifecycle } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/execution/lifecycle/session-lifecycle.js"
);

const { AgentLifecycle } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/execution/lifecycle/agent-lifecycle.js"
);

// ── SessionLifecycle ────────────────────────────────────────────────────────

describe("SessionLifecycle (execution/lifecycl./session-lifecycle.ts)", { timeout: 10_000 }, () => {
  it("constructor starts in 'queued' state with correct getters", () => {
    const id = randomUUID();
    const inst = new SessionLifecycle(id, "my-agent", "manual");

    expect(inst.currentState).toBe("queued");
    expect(inst.sessionId).toBe(id);
    expect(inst.agentName).toBe("my-agent");
    expect(inst.trigger).toBe("manual");
    expect(inst.durationMs).toBeNull();
  });

  it("getInfo() returns a copy of the info object", () => {
    const id = randomUUID();
    const inst = new SessionLifecycle(id, "test-agent", "webhook:github");
    const info = inst.getInfo();
    expect(info.sessionId).toBe(id);
    expect(info.agentName).toBe("test-agent");
    expect(info.trigger).toBe("webhook:github");
    expect(info.startedAt).toBeNull();
    expect(info.endedAt).toBeNull();
  });

  it("isQueued() true in queued, isRunning() false, isTerminal() false", () => {
    const inst = new SessionLifecycle(randomUUID(), "agent", "manual");
    expect(inst.isQueued()).toBe(true);
    expect(inst.isRunning()).toBe(false);
    expect(inst.isTerminal()).toBe(false);
  });

  it("start() transitions to 'running', sets startedAt", () => {
    const inst = new SessionLifecycle(randomUUID(), "agent", "manual");
    const before = Date.now();
    inst.start();
    expect(inst.currentState).toBe("running");
    expect(inst.isRunning()).toBe(true);
    expect(inst.isQueued()).toBe(false);
    expect(inst.getInfo().startedAt).not.toBeNull();
    expect(inst.getInfo().startedAt!.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("complete() transitions to 'completed' from running, sets endedAt and durationMs", async () => {
    const inst = new SessionLifecycle(randomUUID(), "agent", "schedule");
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
    const inst = new SessionLifecycle(randomUUID(), "agent", "manual");
    // Currently in "queued" state
    expect(() => inst.complete()).toThrow("Cannot complete instance");
  });

  it("fail() transitions to 'error' from running", () => {
    const inst = new SessionLifecycle(randomUUID(), "agent", "manual");
    inst.start();
    inst.fail("container crashed");

    expect(inst.currentState).toBe("error");
    expect(inst.isTerminal()).toBe(true);
    expect(inst.getInfo().error).toBe("container crashed");
  });

  it("kill() transitions to 'killed' from queued state", () => {
    const inst = new SessionLifecycle(randomUUID(), "agent", "manual");
    // From "queued"
    inst.kill("user request");
    expect(inst.currentState).toBe("killed");
    expect(inst.isTerminal()).toBe(true);
  });

  it("kill() transitions to 'killed' from running state", () => {
    const inst = new SessionLifecycle(randomUUID(), "agent", "manual");
    inst.start();
    inst.kill("timeout");
    expect(inst.currentState).toBe("killed");
    expect(inst.isTerminal()).toBe(true);
  });

  it("durationMs returns null when not started", () => {
    const inst = new SessionLifecycle(randomUUID(), "agent", "manual");
    expect(inst.durationMs).toBeNull();
  });

  it("durationMs returns null when started but not completed", () => {
    const inst = new SessionLifecycle(randomUUID(), "agent", "manual");
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
    expect(agent.runningSessionCount).toBe(0);
    expect(agent.totalSessionCount).toBe(0);
  });

  it("getInfo() returns a copy of the info", () => {
    const agent = new AgentLifecycle("reporter");
    const info = agent.getInfo();
    expect(info.name).toBe("reporter");
    expect(info.runningSessionCount).toBe(0);
    expect(info.lastRunAt).toBeNull();
    expect(info.lastBuildAt).toBeNull();
  });

  it("isBuilding() false at idle, hasError() false at idle", () => {
    const agent = new AgentLifecycle("test-agent");
    expect(agent.isBuilding()).toBe(false);
    expect(agent.hasError()).toBe(false);
    expect(agent.hasRunningSessions()).toBe(false);
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

  it("addSession() increments totalSessionCount", () => {
    const agent = new AgentLifecycle("agent");
    const inst = new SessionLifecycle(randomUUID(), "agent", "manual");
    agent.addSession(inst);
    expect(agent.totalSessionCount).toBe(1);
  });

  it("addSession + start → runningSessionCount increases, state → 'running'", () => {
    const agent = new AgentLifecycle("agent");
    const inst = new SessionLifecycle(randomUUID(), "agent", "manual");
    agent.addSession(inst);
    inst.start(); // fires session:start event
    expect(agent.currentState).toBe("running");
    expect(agent.runningSessionCount).toBe(1);
    expect(agent.hasRunningSessions()).toBe(true);
  });

  it("instance complete → runningSessionCount decreases → state back to 'idle'", () => {
    const agent = new AgentLifecycle("agent");
    const inst = new SessionLifecycle(randomUUID(), "agent", "manual");
    agent.addSession(inst);
    inst.start();
    expect(agent.currentState).toBe("running");

    inst.complete();
    expect(agent.runningSessionCount).toBe(0);
    expect(agent.hasRunningSessions()).toBe(false);
    // After last instance completes, agent should be back to idle
    expect(agent.currentState).toBe("idle");
    // lastRunAt should be set
    expect(agent.getInfo().lastRunAt).not.toBeNull();
  });

  it("instance kill from queued → agent remains idle (no running count change)", () => {
    const agent = new AgentLifecycle("agent");
    const inst = new SessionLifecycle(randomUUID(), "agent", "manual");
    agent.addSession(inst);
    // Kill before start (queued → killed)
    inst.kill("user cancelled");
    // Running count was never incremented, so agent stays idle
    expect(agent.runningSessionCount).toBe(0);
    expect(agent.currentState).toBe("idle");
  });

  it("removeSession() returns false for unknown sessionId", () => {
    const agent = new AgentLifecycle("agent");
    const result = agent.removeSession("nonexistent-id");
    expect(result).toBe(false);
  });

  it("removeSession() returns true and removes known instance", () => {
    const agent = new AgentLifecycle("agent");
    const id = randomUUID();
    const inst = new SessionLifecycle(id, "agent", "manual");
    agent.addSession(inst);
    expect(agent.totalSessionCount).toBe(1);

    const result = agent.removeSession(id);
    expect(result).toBe(true);
    expect(agent.getSessions().has(id)).toBe(false);
  });

  it("getSessions() returns the map of managed instances", () => {
    const agent = new AgentLifecycle("agent");
    const id = randomUUID();
    const inst = new SessionLifecycle(id, "agent", "manual");
    agent.addSession(inst);

    const map = agent.getSessions();
    expect(map.has(id)).toBe(true);
    expect(map.get(id)).toBe(inst);
  });

  it("two concurrent instances → running count = 2, both complete → idle", () => {
    const agent = new AgentLifecycle("agent");
    const inst1 = new SessionLifecycle(randomUUID(), "agent", "manual");
    const inst2 = new SessionLifecycle(randomUUID(), "agent", "schedule");
    agent.addSession(inst1);
    agent.addSession(inst2);
    inst1.start();
    inst2.start();

    expect(agent.runningSessionCount).toBe(2);
    expect(agent.currentState).toBe("running");

    inst1.complete();
    expect(agent.runningSessionCount).toBe(1);
    expect(agent.currentState).toBe("running"); // still running

    inst2.complete();
    expect(agent.runningSessionCount).toBe(0);
    expect(agent.currentState).toBe("idle");
  });
});
