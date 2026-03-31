import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentLifecycle } from "../../../src/execution/lifecycle/agent-lifecycle.js";
import { InstanceLifecycle } from "../../../src/execution/lifecycle/instance-lifecycle.js";

describe("AgentLifecycle", () => {
  let agent: AgentLifecycle;
  const agentName = "test-agent";

  beforeEach(() => {
    agent = new AgentLifecycle(agentName);
  });

  describe("initialization", () => {
    it("should initialize in idle state", () => {
      expect(agent.getState()).toBe("idle");
      expect(agent.hasRunningInstances()).toBe(false);
      expect(agent.isBuilding()).toBe(false);
      expect(agent.hasError()).toBe(false);
    });

    it("should store agent information correctly", () => {
      const info = agent.getInfo();
      expect(info.name).toBe(agentName);
      expect(info.runningInstanceCount).toBe(0);
      expect(info.totalInstanceCount).toBe(0);
      expect(info.lastRunAt).toBeNull();
      expect(info.lastBuildAt).toBeNull();
    });

    it("agentName getter returns the agent name", () => {
      expect(agent.agentName).toBe(agentName);
    });

    it("runningInstanceCount getter returns the running instance count", () => {
      expect(agent.runningInstanceCount).toBe(0);
    });
  });

  describe("build state transitions", () => {
    it("should transition from idle to building via startBuild()", () => {
      const spy = vi.fn();
      agent.on("agent:build-start", spy);
      const reason = "Image update";

      agent.startBuild(reason);

      expect(agent.getState()).toBe("building");
      expect(agent.isBuilding()).toBe(true);
      expect(spy).toHaveBeenCalledWith({
        agentName,
        reason,
        fromState: "idle",
        toState: "building",
        timestamp: expect.any(Date),
      });
    });

    it("should transition from building to idle via completeBuild() with no running instances", () => {
      agent.startBuild();
      const spy = vi.fn();
      agent.on("agent:build-complete", spy);

      agent.completeBuild();

      expect(agent.getState()).toBe("idle");
      expect(agent.isBuilding()).toBe(false);
      expect(agent.getInfo().lastBuildAt).toBeInstanceOf(Date);
      expect(spy).toHaveBeenCalledWith({
        agentName,
        durationMs: expect.any(Number),
        fromState: "building",
        toState: "idle",
        timestamp: expect.any(Date),
      });
    });

    it("should transition from building to running via completeBuild() with running instances", () => {
      agent.startBuild();
      
      // Add and start an instance
      const instance = new InstanceLifecycle("inst-1", agentName, "schedule");
      agent.addInstance(instance);
      instance.start();

      const spy = vi.fn();
      agent.on("agent:build-complete", spy);

      agent.completeBuild();

      expect(agent.getState()).toBe("running");
      expect(spy).toHaveBeenCalledWith({
        agentName,
        durationMs: expect.any(Number),
        fromState: "building",
        toState: "running",
        timestamp: expect.any(Date),
      });
    });

    it("should throw error when calling completeBuild() on non-building agent", () => {
      expect(() => agent.completeBuild()).toThrow(
        "Cannot complete build in state 'idle'. Must be 'building'."
      );
    });
  });

  describe("instance management", () => {
    it("should track instances and update state accordingly", () => {
      const instance = new InstanceLifecycle("inst-1", agentName, "schedule");
      const startSpy = vi.fn();
      const endSpy = vi.fn();
      
      agent.on("agent:instance-start", startSpy);
      agent.on("agent:instance-end", endSpy);

      // Add instance
      agent.addInstance(instance);
      expect(agent.getInfo().totalInstanceCount).toBe(1);
      expect(agent.getInstances().has("inst-1")).toBe(true);

      // Start instance - should trigger state change to running
      instance.start();
      expect(agent.getState()).toBe("running");
      expect(agent.runningInstanceCount).toBe(1);
      expect(agent.hasRunningInstances()).toBe(true);
      expect(startSpy).toHaveBeenCalledWith({
        agentName,
        instanceId: "inst-1",
        runningCount: 1,
        fromState: "idle",
        toState: "running",
        timestamp: expect.any(Date),
      });

      // Complete instance - should trigger state change back to idle
      instance.complete();
      expect(agent.getState()).toBe("idle");
      expect(agent.runningInstanceCount).toBe(0);
      expect(agent.hasRunningInstances()).toBe(false);
      expect(endSpy).toHaveBeenCalledWith({
        agentName,
        instanceId: "inst-1",
        runningCount: 0,
        reason: "completed",
        fromState: "running",
        toState: "idle",
        timestamp: expect.any(Date),
      });
    });

    it("should handle multiple running instances", () => {
      const instance1 = new InstanceLifecycle("inst-1", agentName, "schedule");
      const instance2 = new InstanceLifecycle("inst-2", agentName, "webhook");
      
      agent.addInstance(instance1);
      agent.addInstance(instance2);

      // Start both instances
      instance1.start();
      expect(agent.runningInstanceCount).toBe(1);
      expect(agent.getState()).toBe("running");

      instance2.start();
      expect(agent.runningInstanceCount).toBe(2);
      expect(agent.getState()).toBe("running");

      // Complete one - should stay running
      instance1.complete();
      expect(agent.runningInstanceCount).toBe(1);
      expect(agent.getState()).toBe("running");

      // Complete second - should go to idle
      instance2.complete();
      expect(agent.runningInstanceCount).toBe(0);
      expect(agent.getState()).toBe("idle");
    });

    it("should remove instances correctly", () => {
      const instance = new InstanceLifecycle("inst-1", agentName, "schedule");
      agent.addInstance(instance);
      instance.start();

      expect(agent.getInstances().has("inst-1")).toBe(true);
      expect(agent.runningInstanceCount).toBe(1);

      const removed = agent.removeInstance("inst-1");
      expect(removed).toBe(true);
      expect(agent.getInstances().has("inst-1")).toBe(false);
      expect(agent.runningInstanceCount).toBe(0);
      expect(agent.getState()).toBe("idle");
    });

    it("removeInstance skips state update when agent is in building state (_updateStateFromInstanceCount early return)", () => {
      // Start a build so the agent is in "building" state
      agent.startBuild();
      expect(agent.getState()).toBe("building");

      // Add and start an instance (agent stays in "building")
      const instance = new InstanceLifecycle("inst-building", agentName, "schedule");
      agent.addInstance(instance);
      instance.start();
      // Agent should still be in "building" — no state transition on instance:start during build
      expect(agent.getState()).toBe("building");
      expect(agent.runningInstanceCount).toBe(1);

      // removeInstance on a running instance calls _updateStateFromInstanceCount()
      // which should hit the early return since state is "building"
      const removed = agent.removeInstance("inst-building");
      expect(removed).toBe(true);
      // After removal, running count decreases but state stays "building"
      expect(agent.runningInstanceCount).toBe(0);
      expect(agent.getState()).toBe("building"); // still building, not idle
    });

    it("should handle instance failures", () => {
      const instance = new InstanceLifecycle("inst-1", agentName, "schedule");
      const endSpy = vi.fn();
      
      agent.on("agent:instance-end", endSpy);
      agent.addInstance(instance);
      instance.start();

      instance.fail("Test error");

      expect(agent.runningInstanceCount).toBe(0);
      expect(agent.getState()).toBe("idle");
      expect(endSpy).toHaveBeenCalledWith({
        agentName,
        instanceId: "inst-1",
        runningCount: 0,
        reason: "error",
        fromState: "running",
        toState: "idle",
        timestamp: expect.any(Date),
      });
    });

    it("should handle instance kills", () => {
      const instance = new InstanceLifecycle("inst-1", agentName, "schedule");
      const endSpy = vi.fn();
      
      agent.on("agent:instance-end", endSpy);
      agent.addInstance(instance);
      instance.start();

      instance.kill("User requested");

      expect(agent.runningInstanceCount).toBe(0);
      expect(agent.getState()).toBe("idle");
      expect(endSpy).toHaveBeenCalledWith({
        agentName,
        instanceId: "inst-1",
        runningCount: 0,
        reason: "killed",
        fromState: "running",
        toState: "idle",
        timestamp: expect.any(Date),
      });
    });
  });

  describe("error state management", () => {
    it("should transition to error state via setError()", () => {
      const spy = vi.fn();
      agent.on("agent:error", spy);
      const error = "Test error message";

      agent.setError(error);

      expect(agent.getState()).toBe("error");
      expect(agent.hasError()).toBe(true);
      expect(agent.getError()).toBe(error);
      expect(spy).toHaveBeenCalledWith({
        agentName,
        error,
        fromState: "idle",
        toState: "error",
        timestamp: expect.any(Date),
      });
    });

    it("should clear error state and return to appropriate state", () => {
      agent.setError("Test error");
      expect(agent.getState()).toBe("error");

      const spy = vi.fn();
      agent.on("agent:error-cleared", spy);

      agent.clearError();

      expect(agent.getState()).toBe("idle");
      expect(agent.hasError()).toBe(false);
      expect(agent.getError()).toBeUndefined();
      expect(spy).toHaveBeenCalledWith({
        agentName,
        fromState: "error",
        toState: "idle",
        timestamp: expect.any(Date),
      });
    });

    it("should clear error and return to running if instances are running", () => {
      const instance = new InstanceLifecycle("inst-1", agentName, "schedule");
      agent.addInstance(instance);
      instance.start();

      agent.setError("Test error");
      expect(agent.getState()).toBe("error");

      agent.clearError();
      expect(agent.getState()).toBe("running");
    });

    it("should throw error when calling clearError() on non-error state", () => {
      expect(() => agent.clearError()).toThrow(
        "Cannot clear error in state 'idle'. Must be 'error'."
      );
    });
  });

  describe("state queries", () => {
    it("should correctly report building state", () => {
      expect(agent.isBuilding()).toBe(false);
      
      agent.startBuild();
      expect(agent.isBuilding()).toBe(true);
      
      agent.completeBuild();
      expect(agent.isBuilding()).toBe(false);
    });

    it("should correctly report error state", () => {
      expect(agent.hasError()).toBe(false);
      
      agent.setError("test");
      expect(agent.hasError()).toBe(true);
      
      agent.clearError();
      expect(agent.hasError()).toBe(false);
    });

    it("should correctly report running instances", () => {
      expect(agent.hasRunningInstances()).toBe(false);
      
      const instance = new InstanceLifecycle("inst-1", agentName, "schedule");
      agent.addInstance(instance);
      expect(agent.hasRunningInstances()).toBe(false);
      
      instance.start();
      expect(agent.hasRunningInstances()).toBe(true);
      
      instance.complete();
      expect(agent.hasRunningInstances()).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("should handle removing non-existent instances", () => {
      const removed = agent.removeInstance("non-existent");
      expect(removed).toBe(false);
    });

    it("should handle error state during building", () => {
      agent.startBuild();
      agent.setError("Build failed");
      
      expect(agent.getState()).toBe("error");
      expect(agent.hasError()).toBe(true);
    });

    it("should not auto-transition when in error state", () => {
      agent.setError("Test error");
      
      const instance = new InstanceLifecycle("inst-1", agentName, "schedule");
      agent.addInstance(instance);
      instance.start();
      
      // Should stay in error state despite running instance
      expect(agent.getState()).toBe("error");
    });

    it("should not auto-transition when in building state", () => {
      agent.startBuild();

      const instance = new InstanceLifecycle("inst-2", agentName, "schedule");
      agent.addInstance(instance);
      instance.start();

      // Should stay in building state despite running instance
      expect(agent.getState()).toBe("building");
    });

    it("emits agent:instance-end without state transition when instance ends in non-running agent state", () => {
      // Put agent in error state then complete an instance
      agent.setError("Some error");

      const instance = new InstanceLifecycle("inst-3", agentName, "schedule");
      agent.addInstance(instance);
      instance.start();

      const spy = vi.fn();
      agent.on("agent:instance-end", spy);

      // Complete the instance; agent is in "error" state, so no state transition
      instance.complete();

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          agentName,
          instanceId: "inst-3",
          reason: "completed",
          fromState: "error",
          toState: "error",
        })
      );
      // Agent should remain in error state
      expect(agent.getState()).toBe("error");
    });
  });

  describe("AgentLifecycle class getters", () => {
    it("agentName getter returns the agent name", () => {
      expect(agent.agentName).toBe(agentName);
    });

    it("totalInstanceCount getter returns total instance count", () => {
      expect(agent.totalInstanceCount).toBe(0);

      const instance1 = new InstanceLifecycle("inst-a", agentName, "schedule");
      agent.addInstance(instance1);
      expect(agent.totalInstanceCount).toBe(1);

      const instance2 = new InstanceLifecycle("inst-b", agentName, "schedule");
      agent.addInstance(instance2);
      expect(agent.totalInstanceCount).toBe(2);
    });
  });
});