/**
 * Integration tests: execution/lifecycle — no Docker required.
 *
 * The lifecycle module (execution/lifecycle/index.ts) defines state machines
 * for tracking agent and instance lifecycle states. It has ZERO existing test
 * coverage. All types and functions are pure (no network, no Docker).
 *
 * Exported items tested:
 *   - InstanceState type: "queued" | "running" | "completed" | "error" | "killed"
 *   - AgentState type: "idle" | "running" | "building" | "error"
 *   - BaseStateMachine<T>: base class with validation logic
 *   - getValidInstanceTransitions(): returns VALID_INSTANCE_TRANSITIONS map
 *   - getValidAgentTransitions(): returns VALID_AGENT_TRANSITIONS map
 *   - isTerminalInstanceState(state): true if terminal (completed/error/killed)
 *   - isTerminalAgentState(state): true if terminal (none — all agent states allow transitions)
 *
 * Test scenarios (no Docker required):
 *   1. getValidInstanceTransitions returns the full transition map
 *   2. getValidAgentTransitions returns the full transition map
 *   3. isTerminalInstanceState: completed/error/killed → true
 *   4. isTerminalInstanceState: queued/running → false
 *   5. isTerminalAgentState: all agent states have transitions → false for all
 *   6. BaseStateMachine.getState() returns initial state
 *   7. BaseStateMachine.canTransitionTo(): valid transition → true
 *   8. BaseStateMachine.canTransitionTo(): invalid transition → false
 *   9. BaseStateMachine.transition(): valid transition emits 'transition' event
 *  10. BaseStateMachine.transition(): invalid transition throws with message
 *  11. Concrete subclass using InstanceState transitions
 *  12. forceTransition(): transitions without validation check
 *
 * Covers:
 *   - execution/lifecycle/index.ts: all exported functions and BaseStateMachine
 */

import { describe, it, expect } from "vitest";

const {
  BaseStateMachine,
  getValidInstanceTransitions,
  getValidAgentTransitions,
  isTerminalInstanceState,
  isTerminalAgentState,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/execution/lifecycle/index.js"
);

// Minimal concrete subclass to test BaseStateMachine
class TestInstanceMachine extends BaseStateMachine {
  constructor() {
    super("queued", getValidInstanceTransitions());
  }

  transitionToRunning(instanceId: string) {
    this.transition("running", "instance:running", { instanceId });
  }

  transitionToCompleted(instanceId: string) {
    this.transition("completed", "instance:completed", { instanceId });
  }

  transitionToError(instanceId: string) {
    this.transition("error", "instance:error", { instanceId });
  }

  transitionToKilled(instanceId: string) {
    this.transition("killed", "instance:killed", { instanceId });
  }

  forceToError(instanceId: string) {
    this.forceTransition("error", "instance:force-error", { instanceId });
  }
}

describe("integration: execution/lifecycle/index.ts (no Docker required)", () => {

  // ── getValidInstanceTransitions ───────────────────────────────────────────

  describe("getValidInstanceTransitions()", () => {
    it("returns the valid instance state transitions map", () => {
      const transitions = getValidInstanceTransitions();
      expect(typeof transitions).toBe("object");
      expect(Array.isArray(transitions.queued)).toBe(true);
      expect(Array.isArray(transitions.running)).toBe(true);
      expect(Array.isArray(transitions.completed)).toBe(true);
      expect(Array.isArray(transitions.error)).toBe(true);
      expect(Array.isArray(transitions.killed)).toBe(true);
    });

    it("queued can transition to running or killed", () => {
      const transitions = getValidInstanceTransitions();
      expect(transitions.queued).toContain("running");
      expect(transitions.queued).toContain("killed");
    });

    it("running can transition to completed, error, or killed", () => {
      const transitions = getValidInstanceTransitions();
      expect(transitions.running).toContain("completed");
      expect(transitions.running).toContain("error");
      expect(transitions.running).toContain("killed");
    });

    it("completed has no valid transitions (terminal)", () => {
      const transitions = getValidInstanceTransitions();
      expect(transitions.completed).toEqual([]);
    });

    it("error has no valid transitions (terminal)", () => {
      const transitions = getValidInstanceTransitions();
      expect(transitions.error).toEqual([]);
    });

    it("killed has no valid transitions (terminal)", () => {
      const transitions = getValidInstanceTransitions();
      expect(transitions.killed).toEqual([]);
    });

    it("returns a copy — modifying it does not affect the module", () => {
      const t1 = getValidInstanceTransitions();
      const t2 = getValidInstanceTransitions();
      expect(t1).not.toBe(t2); // different object instances
    });
  });

  // ── getValidAgentTransitions ──────────────────────────────────────────────

  describe("getValidAgentTransitions()", () => {
    it("returns the valid agent state transitions map", () => {
      const transitions = getValidAgentTransitions();
      expect(typeof transitions).toBe("object");
      expect(Array.isArray(transitions.idle)).toBe(true);
      expect(Array.isArray(transitions.running)).toBe(true);
      expect(Array.isArray(transitions.building)).toBe(true);
      expect(Array.isArray(transitions.error)).toBe(true);
    });

    it("idle can transition to running, building, or error", () => {
      const transitions = getValidAgentTransitions();
      expect(transitions.idle).toContain("running");
      expect(transitions.idle).toContain("building");
      expect(transitions.idle).toContain("error");
    });

    it("error can recover to idle, building, or running", () => {
      const transitions = getValidAgentTransitions();
      expect(transitions.error).toContain("idle");
      expect(transitions.error).toContain("building");
      expect(transitions.error).toContain("running");
    });
  });

  // ── isTerminalInstanceState ───────────────────────────────────────────────

  describe("isTerminalInstanceState()", () => {
    it("returns true for 'completed' (terminal)", () => {
      expect(isTerminalInstanceState("completed")).toBe(true);
    });

    it("returns true for 'error' (terminal)", () => {
      expect(isTerminalInstanceState("error")).toBe(true);
    });

    it("returns true for 'killed' (terminal)", () => {
      expect(isTerminalInstanceState("killed")).toBe(true);
    });

    it("returns false for 'queued' (non-terminal)", () => {
      expect(isTerminalInstanceState("queued")).toBe(false);
    });

    it("returns false for 'running' (non-terminal)", () => {
      expect(isTerminalInstanceState("running")).toBe(false);
    });
  });

  // ── isTerminalAgentState ──────────────────────────────────────────────────

  describe("isTerminalAgentState()", () => {
    it("returns false for all agent states (none are terminal)", () => {
      for (const state of ["idle", "running", "building", "error"]) {
        expect(isTerminalAgentState(state)).toBe(false);
      }
    });
  });

  // ── BaseStateMachine ──────────────────────────────────────────────────────

  describe("BaseStateMachine", () => {
    it("getState() returns the initial state", () => {
      const machine = new TestInstanceMachine();
      expect(machine.getState()).toBe("queued");
    });

    it("canTransitionTo() returns true for a valid transition", () => {
      const machine = new TestInstanceMachine();
      // queued → running is valid
      expect(machine.canTransitionTo("running")).toBe(true);
    });

    it("canTransitionTo() returns false for an invalid transition", () => {
      const machine = new TestInstanceMachine();
      // queued → completed is not a valid transition
      expect(machine.canTransitionTo("completed")).toBe(false);
    });

    it("transition() changes state and emits 'transition' event", () => {
      const machine = new TestInstanceMachine();
      const events: unknown[] = [];
      machine.on("transition", (e) => events.push(e));

      machine.transitionToRunning("inst-1");

      expect(machine.getState()).toBe("running");
      expect(events.length).toBe(1);
      const event = events[0] as any;
      expect(event.fromState).toBe("queued");
      expect(event.toState).toBe("running");
      expect(event.timestamp instanceof Date).toBe(true);
      expect(event.instanceId).toBe("inst-1");
    });

    it("transition() also emits the specific event type", () => {
      const machine = new TestInstanceMachine();
      const runningEvents: unknown[] = [];
      machine.on("instance:running", (e) => runningEvents.push(e));

      machine.transitionToRunning("inst-2");

      expect(runningEvents.length).toBe(1);
    });

    it("transition() throws for invalid transition with descriptive message", () => {
      const machine = new TestInstanceMachine();
      // queued → completed is not valid (must go through running first)
      expect(() => machine.transitionToCompleted("inst-1")).toThrow("Invalid state transition");
      expect(() => machine.transitionToCompleted("inst-1")).toThrow("queued");
      expect(() => machine.transitionToCompleted("inst-1")).toThrow("completed");
    });

    it("valid state machine chain: queued → running → completed", () => {
      const machine = new TestInstanceMachine();
      machine.transitionToRunning("inst-3");
      expect(machine.getState()).toBe("running");
      machine.transitionToCompleted("inst-3");
      expect(machine.getState()).toBe("completed");
    });

    it("valid state machine chain: queued → killed", () => {
      const machine = new TestInstanceMachine();
      machine.transitionToKilled("inst-4");
      expect(machine.getState()).toBe("killed");
    });

    it("valid state machine chain: queued → running → error", () => {
      const machine = new TestInstanceMachine();
      machine.transitionToRunning("inst-5");
      machine.transitionToError("inst-5");
      expect(machine.getState()).toBe("error");
    });

    it("canTransitionTo() returns false when in terminal state (completed)", () => {
      const machine = new TestInstanceMachine();
      machine.transitionToRunning("inst-6");
      machine.transitionToCompleted("inst-6");
      // completed is terminal — no valid transitions
      expect(machine.canTransitionTo("queued")).toBe(false);
      expect(machine.canTransitionTo("running")).toBe(false);
      expect(machine.canTransitionTo("error")).toBe(false);
    });

    it("forceTransition() transitions without validation (even invalid)", () => {
      const machine = new TestInstanceMachine();
      // Force from queued directly to error (normally invalid without going through running)
      machine.forceToError("inst-7");
      expect(machine.getState()).toBe("error");
    });

    it("forceTransition() still emits transition events", () => {
      const machine = new TestInstanceMachine();
      const events: unknown[] = [];
      machine.on("transition", (e) => events.push(e));
      machine.forceToError("inst-8");
      expect(events.length).toBe(1);
    });
  });
});
