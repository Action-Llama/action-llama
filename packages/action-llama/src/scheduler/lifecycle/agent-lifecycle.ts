import {
  BaseStateMachine,
  type AgentState,
  type AgentTransitionEvent,
  getValidAgentTransitions,
} from "./index.js";
import type { InstanceLifecycle } from "./instance-lifecycle.js";

export interface AgentInfo {
  name: string;
  runningInstanceCount: number;
  totalInstanceCount: number;
  lastRunAt: Date | null;
  lastBuildAt: Date | null;
  error?: string;
}

export interface AgentBuildStartEvent extends AgentTransitionEvent {
  reason?: string;
}

export interface AgentBuildCompleteEvent extends AgentTransitionEvent {
  durationMs: number;
}

export interface AgentInstanceStartEvent extends AgentTransitionEvent {
  instanceId: string;
  runningCount: number;
}

export interface AgentInstanceEndEvent extends AgentTransitionEvent {
  instanceId: string;
  runningCount: number;
  reason: 'completed' | 'error' | 'killed';
}

export interface AgentErrorEvent extends AgentTransitionEvent {
  error: string;
}

/**
 * AgentLifecycle manages the state of an agent type across all its instances.
 * 
 * State transitions:
 * - idle ⟷ running (based on instance count)
 * - idle → building (via startBuild())
 * - building → idle (via completeBuild())
 * - any → error (via setError())
 * - error → any (via recovery methods)
 * 
 * The 'running' state is automatically managed based on the count of running instances.
 */
export class AgentLifecycle extends BaseStateMachine<AgentState> {
  private info: AgentInfo;
  private buildStartedAt: Date | null = null;
  private instances = new Map<string, InstanceLifecycle>();

  constructor(agentName: string) {
    super("idle", getValidAgentTransitions());
    this.info = {
      name: agentName,
      runningInstanceCount: 0,
      totalInstanceCount: 0,
      lastRunAt: null,
      lastBuildAt: null,
    };
  }

  /**
   * Get agent information
   */
  getInfo(): Readonly<AgentInfo> {
    return { ...this.info };
  }

  /**
   * Get agent name
   */
  get agentName(): string {
    return this.info.name;
  }

  /**
   * Get running instance count
   */
  get runningInstanceCount(): number {
    return this.info.runningInstanceCount;
  }

  /**
   * Get total instance count
   */
  get totalInstanceCount(): number {
    return this.info.totalInstanceCount;
  }

  /**
   * Get all managed instances
   */
  getInstances(): ReadonlyMap<string, InstanceLifecycle> {
    return this.instances;
  }

  /**
   * Start building process (e.g., Docker image build)
   * @param reason Optional reason for the build
   */
  startBuild(reason?: string): void {
    this.buildStartedAt = new Date();
    this.transition<AgentBuildStartEvent>(
      "building",
      "agent:build-start",
      {
        agentName: this.info.name,
        reason,
      }
    );
  }

  /**
   * Complete building process
   */
  completeBuild(): void {
    if (this.currentState !== "building") {
      throw new Error(`Cannot complete build in state '${this.currentState}'. Must be 'building'.`);
    }

    this.info.lastBuildAt = new Date();
    const durationMs = this.buildStartedAt
      ? this.info.lastBuildAt.getTime() - this.buildStartedAt.getTime()
      : 0;

    this.buildStartedAt = null;

    // Transition to idle if no instances running, otherwise to running
    const targetState = this.info.runningInstanceCount > 0 ? "running" : "idle";

    this.transition<AgentBuildCompleteEvent>(
      targetState,
      "agent:build-complete",
      {
        agentName: this.info.name,
        durationMs,
      }
    );
  }

  /**
   * Register a new instance and update state accordingly
   * @param instance The instance lifecycle to track
   */
  addInstance(instance: InstanceLifecycle): void {
    this.instances.set(instance.instanceId, instance);
    this.info.totalInstanceCount++;

    // Listen to instance state changes
    instance.on("instance:start", () => {
      this._handleInstanceStart(instance);
    });

    instance.on("instance:complete", () => {
      this._handleInstanceEnd(instance, "completed");
    });

    instance.on("instance:error", () => {
      this._handleInstanceEnd(instance, "error");
    });

    instance.on("instance:kill", () => {
      this._handleInstanceEnd(instance, "killed");
    });
  }

  /**
   * Remove an instance from tracking
   * @param instanceId The instance ID to remove
   */
  removeInstance(instanceId: string): boolean {
    const instance = this.instances.get(instanceId);
    if (!instance) return false;

    // Remove all listeners
    instance.removeAllListeners();
    this.instances.delete(instanceId);

    // Update running count if it was running
    if (instance.isRunning()) {
      this.info.runningInstanceCount = Math.max(0, this.info.runningInstanceCount - 1);
      this._updateStateFromInstanceCount();
    }

    return true;
  }

  /**
   * Set agent to error state
   * @param error Error message
   */
  setError(error: string): void {
    this.info.error = error;
    this.transition<AgentErrorEvent>(
      "error",
      "agent:error",
      {
        agentName: this.info.name,
        error,
      }
    );
  }

  /**
   * Clear error state and return to appropriate state based on running instances
   */
  clearError(): void {
    if (this.currentState !== "error") {
      throw new Error(`Cannot clear error in state '${this.currentState}'. Must be 'error'.`);
    }

    this.info.error = undefined;
    const targetState = this.info.runningInstanceCount > 0 ? "running" : "idle";

    this.forceTransition<AgentTransitionEvent>(
      targetState,
      "agent:error-cleared",
      {
        agentName: this.info.name,
      }
    );
  }

  /**
   * Get current error (if any)
   */
  getError(): string | undefined {
    return this.info.error;
  }

  /**
   * Check if agent has any running instances
   */
  hasRunningInstances(): boolean {
    return this.info.runningInstanceCount > 0;
  }

  /**
   * Check if agent is currently building
   */
  isBuilding(): boolean {
    return this.currentState === "building";
  }

  /**
   * Check if agent is in error state
   */
  hasError(): boolean {
    return this.currentState === "error";
  }

  private _handleInstanceStart(instance: InstanceLifecycle): void {
    this.info.runningInstanceCount++;
    this.info.lastRunAt = new Date();

    // Only transition to running if not in error or building state
    if (this.currentState === "idle") {
      this.transition<AgentInstanceStartEvent>(
        "running",
        "agent:instance-start",
        {
          agentName: this.info.name,
          instanceId: instance.instanceId,
          runningCount: this.info.runningInstanceCount,
        }
      );
    } else {
      // Emit event without state transition for other states
      this.emit("agent:instance-start", {
        agentName: this.info.name,
        instanceId: instance.instanceId,
        runningCount: this.info.runningInstanceCount,
        fromState: this.currentState,
        toState: this.currentState,
        timestamp: new Date(),
      });
    }
  }

  private _handleInstanceEnd(instance: InstanceLifecycle, reason: 'completed' | 'error' | 'killed'): void {
    this.info.runningInstanceCount = Math.max(0, this.info.runningInstanceCount - 1);

    // Only transition states if not in error or building state
    if (this.currentState === "running") {
      const targetState = this.info.runningInstanceCount > 0 ? "running" : "idle";

      this.transition<AgentInstanceEndEvent>(
        targetState,
        "agent:instance-end",
        {
          agentName: this.info.name,
          instanceId: instance.instanceId,
          runningCount: this.info.runningInstanceCount,
          reason,
        }
      );
    } else {
      // Emit event without state transition for other states
      this.emit("agent:instance-end", {
        agentName: this.info.name,
        instanceId: instance.instanceId,
        runningCount: this.info.runningInstanceCount,
        reason,
        fromState: this.currentState,
        toState: this.currentState,
        timestamp: new Date(),
      });
    }
  }

  private _updateStateFromInstanceCount(): void {
    // Only update if we're not in building or error state
    if (this.currentState === "building" || this.currentState === "error") {
      return;
    }

    const targetState = this.info.runningInstanceCount > 0 ? "running" : "idle";
    if (targetState !== this.currentState) {
      this.forceTransition<AgentTransitionEvent>(
        targetState,
        "agent:auto-transition",
        {
          agentName: this.info.name,
        }
      );
    }
  }
}