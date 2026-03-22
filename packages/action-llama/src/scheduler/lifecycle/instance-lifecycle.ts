import {
  BaseStateMachine,
  type InstanceState,
  type InstanceTransitionEvent,
  getValidInstanceTransitions,
} from "./index.js";

export interface InstanceInfo {
  instanceId: string;
  agentName: string;
  startedAt: Date | null;
  endedAt: Date | null;
  trigger: string;
  error?: string;
}

export interface InstanceStartEvent extends InstanceTransitionEvent {
  trigger: string;
}

export interface InstanceCompleteEvent extends InstanceTransitionEvent {
  durationMs: number;
}

export interface InstanceErrorEvent extends InstanceTransitionEvent {
  error: string;
  durationMs: number;
}

export interface InstanceKillEvent extends InstanceTransitionEvent {
  reason?: string;
  durationMs?: number;
}

/**
 * InstanceLifecycle manages the state of a single agent instance run.
 * 
 * State transitions:
 * - queued → running (via start())
 * - queued → killed (via kill())
 * - running → completed (via complete())
 * - running → error (via fail())
 * - running → killed (via kill())
 */
export class InstanceLifecycle extends BaseStateMachine<InstanceState> {
  private info: InstanceInfo;

  constructor(instanceId: string, agentName: string, trigger: string) {
    super("queued", getValidInstanceTransitions());
    this.info = {
      instanceId,
      agentName,
      startedAt: null,
      endedAt: null,
      trigger,
    };
  }

  /**
   * Get instance information
   */
  getInfo(): Readonly<InstanceInfo> {
    return { ...this.info };
  }

  /**
   * Get instance ID
   */
  get instanceId(): string {
    return this.info.instanceId;
  }

  /**
   * Get agent name
   */
  get agentName(): string {
    return this.info.agentName;
  }

  /**
   * Get trigger information
   */
  get trigger(): string {
    return this.info.trigger;
  }

  /**
   * Get duration in milliseconds (only available after completion)
   */
  get durationMs(): number | null {
    if (!this.info.startedAt || !this.info.endedAt) return null;
    return this.info.endedAt.getTime() - this.info.startedAt.getTime();
  }

  /**
   * Transition from queued to running
   */
  start(): void {
    this.info.startedAt = new Date();
    this.transition<InstanceStartEvent>(
      "running",
      "instance:start",
      {
        instanceId: this.info.instanceId,
        agentName: this.info.agentName,
        trigger: this.info.trigger,
      }
    );
  }

  /**
   * Transition from running to completed
   */
  complete(): void {
    if (this.currentState !== "running") {
      throw new Error(`Cannot complete instance in state '${this.currentState}'. Must be 'running'.`);
    }
    
    this.info.endedAt = new Date();
    const durationMs = this.durationMs!;

    this.transition<InstanceCompleteEvent>(
      "completed",
      "instance:complete",
      {
        instanceId: this.info.instanceId,
        agentName: this.info.agentName,
        durationMs,
      }
    );
  }

  /**
   * Transition from running to error
   * @param error Error message or reason for failure
   */
  fail(error: string): void {
    if (this.currentState !== "running") {
      throw new Error(`Cannot fail instance in state '${this.currentState}'. Must be 'running'.`);
    }

    this.info.endedAt = new Date();
    this.info.error = error;
    const durationMs = this.durationMs!;

    this.transition<InstanceErrorEvent>(
      "error",
      "instance:error",
      {
        instanceId: this.info.instanceId,
        agentName: this.info.agentName,
        error,
        durationMs,
      }
    );
  }

  /**
   * Transition to killed from any non-terminal state
   * @param reason Optional reason for killing
   */
  kill(reason?: string): void {
    const validKillStates: InstanceState[] = ["queued", "running"];
    if (!validKillStates.includes(this.currentState)) {
      throw new Error(
        `Cannot kill instance in terminal state '${this.currentState}'. ` +
        `Can only kill from: ${validKillStates.join(', ')}`
      );
    }

    // Set endedAt if not already set (for running instances)
    if (!this.info.endedAt) {
      this.info.endedAt = new Date();
    }

    // Only calculate duration if the instance was actually started
    const durationMs = this.info.startedAt ? this.durationMs : undefined;

    this.transition<InstanceKillEvent>(
      "killed",
      "instance:kill",
      {
        instanceId: this.info.instanceId,
        agentName: this.info.agentName,
        reason,
        durationMs,
      }
    );
  }

  /**
   * Check if the instance is in a terminal state
   */
  isTerminal(): boolean {
    return ["completed", "error", "killed"].includes(this.currentState);
  }

  /**
   * Check if the instance is currently running
   */
  isRunning(): boolean {
    return this.currentState === "running";
  }

  /**
   * Check if the instance is queued
   */
  isQueued(): boolean {
    return this.currentState === "queued";
  }
}