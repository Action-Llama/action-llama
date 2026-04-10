import {
  BaseStateMachine,
  type AgentState,
  type AgentTransitionEvent,
  getValidAgentTransitions,
} from "./index.js";
import type { SessionLifecycle } from "./session-lifecycle.js";

export interface AgentInfo {
  name: string;
  runningSessionCount: number;
  waitingSessionCount: number;
  totalSessionCount: number;
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

export interface AgentSessionStartEvent extends AgentTransitionEvent {
  sessionId: string;
  runningCount: number;
}

export interface AgentSessionEndEvent extends AgentTransitionEvent {
  sessionId: string;
  runningCount: number;
  reason: 'completed' | 'error' | 'killed';
}

export interface AgentErrorEvent extends AgentTransitionEvent {
  error: string;
}

/**
 * AgentLifecycle manages the state of an agent type across all its sessions.
 * 
 * State transitions:
 * - idle ⟷ running (based on instance count)
 * - idle → building (via startBuild())
 * - building → idle (via completeBuild())
 * - any → error (via setError())
 * - error → any (via recovery methods)
 * 
 * The 'running' state is automatically managed based on the count of running sessions.
 */
export class AgentLifecycle extends BaseStateMachine<AgentState> {
  private info: AgentInfo;
  private buildStartedAt: Date | null = null;
  private instances = new Map<string, SessionLifecycle>();

  constructor(agentName: string) {
    super("idle", getValidAgentTransitions());
    this.info = {
      name: agentName,
      runningSessionCount: 0,
      waitingSessionCount: 0,
      totalSessionCount: 0,
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
  get runningSessionCount(): number {
    return this.info.runningSessionCount;
  }

  /**
   * Get total instance count
   */
  get totalSessionCount(): number {
    return this.info.totalSessionCount;
  }

  /**
   * Get all managed instances
   */
  getSessions(): ReadonlyMap<string, SessionLifecycle> {
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
    const targetState = this.info.runningSessionCount > 0 ? "running" : "idle";

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
   * Register a new session and update state accordingly
   * @param instance The session lifecycle to track
   */
  addSession(instance: SessionLifecycle): void {
    this.instances.set(instance.sessionId, instance);
    this.info.totalSessionCount++;

    // Listen to instance state changes
    instance.on("session:start", () => {
      this._handleSessionStart(instance);
    });

    instance.on("session:complete", () => {
      this._handleSessionEnd(instance, "completed");
    });

    instance.on("session:error", () => {
      this._handleSessionEnd(instance, "error");
    });

    instance.on("session:kill", () => {
      this._handleSessionEnd(instance, "killed");
    });

    instance.on("session:wait", () => {
      this._handleSessionWait(instance);
    });

    instance.on("session:resume", () => {
      this._handleSessionResume(instance);
    });
  }

  /**
   * Remove a session from tracking
   * @param sessionId The session ID to remove
   */
  removeSession(sessionId: string): boolean {
    const instance = this.instances.get(sessionId);
    if (!instance) return false;

    // Remove all listeners
    instance.removeAllListeners();
    this.instances.delete(sessionId);

    // Update counts if it was running or waiting
    if (instance.isRunning()) {
      this.info.runningSessionCount = Math.max(0, this.info.runningSessionCount - 1);
      this._updateStateFromSessionCount();
    } else if (instance.isWaiting()) {
      this.info.waitingSessionCount = Math.max(0, this.info.waitingSessionCount - 1);
      this._updateStateFromSessionCount();
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
   * Clear error state and return to appropriate state based on running sessions
   */
  clearError(): void {
    if (this.currentState !== "error") {
      throw new Error(`Cannot clear error in state '${this.currentState}'. Must be 'error'.`);
    }

    this.info.error = undefined;
    const targetState = this.info.runningSessionCount > 0 ? "running" : "idle";

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
   * Check if agent has any running sessions
   */
  hasRunningSessions(): boolean {
    return this.info.runningSessionCount > 0;
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

  private _handleSessionStart(instance: SessionLifecycle): void {
    this.info.runningSessionCount++;
    this.info.lastRunAt = new Date();

    // Only transition to running if not in error or building state
    if (this.currentState === "idle") {
      this.transition<AgentSessionStartEvent>(
        "running",
        "agent:session-start",
        {
          agentName: this.info.name,
          sessionId: instance.sessionId,
          runningCount: this.info.runningSessionCount,
        }
      );
    } else {
      // Emit event without state transition for other states
      this.emit("agent:session-start", {
        agentName: this.info.name,
        sessionId: instance.sessionId,
        runningCount: this.info.runningSessionCount,
        fromState: this.currentState,
        toState: this.currentState,
        timestamp: new Date(),
      });
    }
  }

  private _handleSessionEnd(instance: SessionLifecycle, reason: 'completed' | 'error' | 'killed'): void {
    // A waiting instance that ends needs waitingCount decremented, not runningCount
    if (instance.isWaiting?.() || (reason === 'killed' && this.info.waitingSessionCount > 0 && this.info.runningSessionCount === 0)) {
      this.info.waitingSessionCount = Math.max(0, this.info.waitingSessionCount - 1);
    } else {
      this.info.runningSessionCount = Math.max(0, this.info.runningSessionCount - 1);
    }

    // Only transition states if not in error or building state
    if (this.currentState === "running" || this.currentState === "waiting") {
      const targetState = this._computeAgentState();

      this.transition<AgentSessionEndEvent>(
        targetState,
        "agent:session-end",
        {
          agentName: this.info.name,
          sessionId: instance.sessionId,
          runningCount: this.info.runningSessionCount,
          reason,
        }
      );
    } else {
      // Emit event without state transition for other states
      this.emit("agent:session-end", {
        agentName: this.info.name,
        sessionId: instance.sessionId,
        runningCount: this.info.runningSessionCount,
        reason,
        fromState: this.currentState,
        toState: this.currentState,
        timestamp: new Date(),
      });
    }
  }

  private _handleSessionWait(_instance: SessionLifecycle): void {
    this.info.runningSessionCount = Math.max(0, this.info.runningSessionCount - 1);
    this.info.waitingSessionCount++;

    if (this.currentState === "running") {
      const targetState = this._computeAgentState();
      if (targetState !== this.currentState) {
        this.transition<AgentTransitionEvent>(
          targetState,
          "agent:session-wait",
          { agentName: this.info.name }
        );
      } else {
        this.emit("agent:session-wait", {
          agentName: this.info.name,
          fromState: this.currentState,
          toState: this.currentState,
          timestamp: new Date(),
        });
      }
    }
  }

  private _handleSessionResume(_instance: SessionLifecycle): void {
    this.info.waitingSessionCount = Math.max(0, this.info.waitingSessionCount - 1);
    this.info.runningSessionCount++;

    if (this.currentState === "waiting") {
      this.transition<AgentTransitionEvent>(
        "running",
        "agent:session-resume",
        { agentName: this.info.name }
      );
    } else {
      this.emit("agent:session-resume", {
        agentName: this.info.name,
        fromState: this.currentState,
        toState: this.currentState,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Compute the appropriate agent state from instance counts.
   */
  private _computeAgentState(): AgentState {
    if (this.info.runningSessionCount > 0) return "running";
    if (this.info.waitingSessionCount > 0) return "waiting";
    return "idle";
  }

  private _updateStateFromSessionCount(): void {
    // Only update if we're not in building or error state
    if (this.currentState === "building" || this.currentState === "error") {
      return;
    }

    const targetState = this._computeAgentState();
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