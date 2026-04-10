import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionLifecycle } from "../../../src/execution/lifecycle/session-lifecycle.js";
import { isTerminalSessionState, isTerminalAgentState } from "../../../src/execution/lifecycle/index.js";

describe("SessionLifecycle", () => {
  let instance: SessionLifecycle;
  const sessionId = "test-instance-123";
  const agentName = "test-agent";
  const trigger = "schedule";

  beforeEach(() => {
    instance = new SessionLifecycle(sessionId, agentName, trigger);
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
      expect(info.sessionId).toBe(sessionId);
      expect(info.agentName).toBe(agentName);
      expect(info.trigger).toBe(trigger);
      expect(info.startedAt).toBeNull();
      expect(info.endedAt).toBeNull();
    });

    it("agentName getter returns the agent name", () => {
      expect(instance.agentName).toBe(agentName);
    });

    it("trigger getter returns the trigger string", () => {
      expect(instance.trigger).toBe(trigger);
    });
  });

  describe("valid state transitions", () => {
    it("should transition from queued to running via start()", () => {
      const spy = vi.fn();
      instance.on("session:start", spy);

      instance.start();

      expect(instance.getState()).toBe("running");
      expect(instance.isRunning()).toBe(true);
      expect(instance.isQueued()).toBe(false);
      expect(spy).toHaveBeenCalledWith({
        sessionId,
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
      instance.on("session:complete", spy);

      instance.complete();

      expect(instance.getState()).toBe("completed");
      expect(instance.isTerminal()).toBe(true);
      expect(instance.durationMs).toBeGreaterThanOrEqual(0);
      expect(spy).toHaveBeenCalledWith({
        sessionId,
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
      instance.on("session:error", spy);
      const error = "Test error message";

      instance.fail(error);

      expect(instance.getState()).toBe("error");
      expect(instance.isTerminal()).toBe(true);
      expect(instance.getInfo().error).toBe(error);
      expect(spy).toHaveBeenCalledWith({
        sessionId,
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
      instance.on("session:kill", spy);
      const reason = "User requested";

      instance.kill(reason);

      expect(instance.getState()).toBe("killed");
      expect(instance.isTerminal()).toBe(true);
      expect(spy).toHaveBeenCalledWith({
        sessionId,
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
      instance.on("session:kill", spy);

      instance.kill();

      expect(instance.getState()).toBe("killed");
      expect(instance.isTerminal()).toBe(true);
      expect(instance.durationMs).toBeGreaterThanOrEqual(0);
      expect(spy).toHaveBeenCalledWith({
        sessionId,
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
        "Cannot complete session in state 'queued'. Must be 'running'."
      );
    });

    it("should throw error when calling fail() on non-running instance", () => {
      expect(() => instance.fail("error")).toThrow(
        "Cannot fail session in state 'queued'. Must be 'running' or 'waiting'."
      );
    });

    it("should throw error when calling kill() on terminal state", () => {
      instance.start();
      instance.complete();
      
      expect(() => instance.kill()).toThrow(
        "Cannot kill session in terminal state 'completed'."
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
        sessionId,
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

describe("isTerminalSessionState", () => {
  it("returns false for non-terminal states", () => {
    expect(isTerminalSessionState("queued")).toBe(false);
    expect(isTerminalSessionState("running")).toBe(false);
  });

  it("returns true for terminal states", () => {
    expect(isTerminalSessionState("completed")).toBe(true);
    expect(isTerminalSessionState("error")).toBe(true);
    expect(isTerminalSessionState("killed")).toBe(true);
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

describe("SessionLifecycle class getters", () => {
  it("agentName getter returns the agent name", () => {
    const lifecycle = new SessionLifecycle("inst-1", "my-agent", "schedule");
    expect(lifecycle.agentName).toBe("my-agent");
  });

  it("trigger getter returns the trigger string", () => {
    const lifecycle = new SessionLifecycle("inst-2", "my-agent", "webhook");
    expect(lifecycle.trigger).toBe("webhook");
  });
});