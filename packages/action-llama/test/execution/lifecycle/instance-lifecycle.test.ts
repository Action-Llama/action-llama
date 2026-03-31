import { describe, it, expect, vi, beforeEach } from "vitest";
import { InstanceLifecycle } from "../../../src/execution/lifecycle/instance-lifecycle.js";
import { isTerminalInstanceState, isTerminalAgentState } from "../../../src/execution/lifecycle/index.js";

describe("InstanceLifecycle", () => {
  let instance: InstanceLifecycle;
  const instanceId = "test-instance-123";
  const agentName = "test-agent";
  const trigger = "schedule";

  beforeEach(() => {
    instance = new InstanceLifecycle(instanceId, agentName, trigger);
  });

  describe("initialization", () => {
    it("should initialize in queued state", () => {
      expect(instance.getState()).toBe("queued");
      expect(instance.isQueued()).toBe(true);
      expect(instance.isRunning()).toBe(false);
      expect(instance.isTerminal()).toBe(false);
    });

    it("should store instance information correctly", () => {
      const info = instance.getInfo();
      expect(info.instanceId).toBe(instanceId);
      expect(info.agentName).toBe(agentName);
      expect(info.trigger).toBe(trigger);
      expect(info.startedAt).toBeNull();
      expect(info.endedAt).toBeNull();
    });
  });

  describe("valid state transitions", () => {
    it("should transition from queued to running via start()", () => {
      const spy = vi.fn();
      instance.on("instance:start", spy);

      instance.start();

      expect(instance.getState()).toBe("running");
      expect(instance.isRunning()).toBe(true);
      expect(instance.isQueued()).toBe(false);
      expect(spy).toHaveBeenCalledWith({
        instanceId,
        agentName,
        trigger,
        fromState: "queued",
        toState: "running",
        timestamp: expect.any(Date),
      });

      const info = instance.getInfo();
      expect(info.startedAt).toBeInstanceOf(Date);
    });

    it("should transition from running to completed via complete()", () => {
      instance.start();
      const spy = vi.fn();
      instance.on("instance:complete", spy);

      instance.complete();

      expect(instance.getState()).toBe("completed");
      expect(instance.isTerminal()).toBe(true);
      expect(instance.durationMs).toBeGreaterThanOrEqual(0);
      expect(spy).toHaveBeenCalledWith({
        instanceId,
        agentName,
        durationMs: expect.any(Number),
        fromState: "running",
        toState: "completed",
        timestamp: expect.any(Date),
      });
    });

    it("should transition from running to error via fail()", () => {
      instance.start();
      const spy = vi.fn();
      instance.on("instance:error", spy);
      const error = "Test error message";

      instance.fail(error);

      expect(instance.getState()).toBe("error");
      expect(instance.isTerminal()).toBe(true);
      expect(instance.getInfo().error).toBe(error);
      expect(spy).toHaveBeenCalledWith({
        instanceId,
        agentName,
        error,
        durationMs: expect.any(Number),
        fromState: "running",
        toState: "error",
        timestamp: expect.any(Date),
      });
    });

    it("should transition from queued to killed via kill()", () => {
      const spy = vi.fn();
      instance.on("instance:kill", spy);
      const reason = "User requested";

      instance.kill(reason);

      expect(instance.getState()).toBe("killed");
      expect(instance.isTerminal()).toBe(true);
      expect(spy).toHaveBeenCalledWith({
        instanceId,
        agentName,
        reason,
        durationMs: undefined,
        fromState: "queued",
        toState: "killed",
        timestamp: expect.any(Date),
      });
    });

    it("should transition from running to killed via kill()", () => {
      instance.start();
      const spy = vi.fn();
      instance.on("instance:kill", spy);

      instance.kill();

      expect(instance.getState()).toBe("killed");
      expect(instance.isTerminal()).toBe(true);
      expect(instance.durationMs).toBeGreaterThanOrEqual(0);
      expect(spy).toHaveBeenCalledWith({
        instanceId,
        agentName,
        reason: undefined,
        durationMs: expect.any(Number),
        fromState: "running",
        toState: "killed",
        timestamp: expect.any(Date),
      });
    });
  });

  describe("invalid state transitions", () => {
    it("should throw error when calling complete() on non-running instance", () => {
      expect(() => instance.complete()).toThrow(
        "Cannot complete instance in state 'queued'. Must be 'running'."
      );
    });

    it("should throw error when calling fail() on non-running instance", () => {
      expect(() => instance.fail("error")).toThrow(
        "Cannot fail instance in state 'queued'. Must be 'running'."
      );
    });

    it("should throw error when calling kill() on terminal state", () => {
      instance.start();
      instance.complete();
      
      expect(() => instance.kill()).toThrow(
        "Cannot kill instance in terminal state 'completed'."
      );
    });

    it("should prevent transitions from terminal states", () => {
      instance.start();
      instance.complete();

      expect(() => instance.start()).toThrow();
      expect(() => instance.fail("error")).toThrow();
      expect(() => instance.complete()).toThrow();
    });
  });

  describe("event emission", () => {
    it("should emit transition events", () => {
      const transitionSpy = vi.fn();
      instance.on("transition", transitionSpy);

      instance.start();

      expect(transitionSpy).toHaveBeenCalledWith({
        instanceId,
        agentName,
        trigger,
        fromState: "queued",
        toState: "running",
        timestamp: expect.any(Date),
      });
    });
  });

  describe("duration calculation", () => {
    it("should calculate duration correctly", async () => {
      instance.start();
      
      // Wait a small amount
      await new Promise(resolve => setTimeout(resolve, 10));
      
      instance.complete();
      const duration = instance.durationMs;
      expect(duration).toBeGreaterThan(0);
      expect(duration).toBeLessThan(100); // Should be very small for test
    });

    it("should return null duration before completion", () => {
      expect(instance.durationMs).toBeNull();
      
      instance.start();
      expect(instance.durationMs).toBeNull();
    });
  });

  describe("state queries", () => {
    it("should correctly report terminal states", () => {
      expect(instance.isTerminal()).toBe(false);
      
      instance.start();
      expect(instance.isTerminal()).toBe(false);
      
      instance.complete();
      expect(instance.isTerminal()).toBe(true);
    });

    it("should correctly report running state", () => {
      expect(instance.isRunning()).toBe(false);
      
      instance.start();
      expect(instance.isRunning()).toBe(true);
      
      instance.complete();
      expect(instance.isRunning()).toBe(false);
    });

    it("should correctly report queued state", () => {
      expect(instance.isQueued()).toBe(true);
      
      instance.start();
      expect(instance.isQueued()).toBe(false);
    });
  });
});

describe("isTerminalInstanceState", () => {
  it("returns false for non-terminal states", () => {
    expect(isTerminalInstanceState("queued")).toBe(false);
    expect(isTerminalInstanceState("running")).toBe(false);
  });

  it("returns true for terminal states", () => {
    expect(isTerminalInstanceState("completed")).toBe(true);
    expect(isTerminalInstanceState("error")).toBe(true);
    expect(isTerminalInstanceState("killed")).toBe(true);
  });
});

describe("isTerminalAgentState", () => {
  it("returns false for non-terminal agent states", () => {
    expect(isTerminalAgentState("idle")).toBe(false);
    expect(isTerminalAgentState("running")).toBe(false);
    expect(isTerminalAgentState("building")).toBe(false);
    expect(isTerminalAgentState("error")).toBe(false);
  });
});