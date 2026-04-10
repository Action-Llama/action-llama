import {
  BaseStateMachine,
  type SessionState,
  type SessionTransitionEvent,
  getValidSessionTransitions,
} from "./index.js";

export interface SessionInfo {
  sessionId: string;
  agentName: string;
  startedAt: Date | null;
  endedAt: Date | null;
  trigger: string;
  error?: string;
}

export interface SessionStartEvent extends SessionTransitionEvent {
  trigger: string;
}

export interface SessionCompleteEvent extends SessionTransitionEvent {
  durationMs: number;
}

export interface SessionErrorEvent extends SessionTransitionEvent {
  error: string;
  durationMs: number;
}

export interface SessionWaitEvent extends SessionTransitionEvent {
  filter: Record<string, unknown>;
}

export interface SessionResumeEvent extends SessionTransitionEvent {
  triggerPayload?: unknown;
}

export interface SessionKillEvent extends SessionTransitionEvent {
  reason?: string;
  durationMs?: number;
}

/**
 * SessionLifecycle manages the state of a single agent instance run.
 * 
 * State transitions:
 * - queued → running (via start())
 * - queued → killed (via kill())
 * - running → waiting (via wait())
 * - running → completed (via complete())
 * - running → error (via fail())
 * - running → killed (via kill())
 * - waiting → running (via resume())
 * - waiting → error (timeout)
 * - waiting → killed (via kill())
 */
export class SessionLifecycle extends BaseStateMachine<SessionState> {
  private info: SessionInfo;

  constructor(sessionId: string, agentName: string, trigger: string) {
    super("queued", getValidSessionTransitions());
    this.info = {
      sessionId,
      agentName,
      startedAt: null,
      endedAt: null,
      trigger,
    };
  }

  /**
   * Get instance information
   */
  getInfo(): Readonly<SessionInfo> {
    return { ...this.info };
  }

  /**
   * Get instance ID
   */
  get sessionId(): string {
    return this.info.sessionId;
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
    this.transition<SessionStartEvent>(
      "running",
      "session:start",
      {
        sessionId: this.info.sessionId,
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
      throw new Error(`Cannot complete session in state '${this.currentState}'. Must be 'running'.`);
    }
    
    this.info.endedAt = new Date();
    const durationMs = this.durationMs!;

    this.transition<SessionCompleteEvent>(
      "completed",
      "session:complete",
      {
        sessionId: this.info.sessionId,
        agentName: this.info.agentName,
        durationMs,
      }
    );
  }

  /**
   * Transition from running to waiting (agent called wait_for_trigger)
   * @param filter The wait filter describing what trigger to wait for
   */
  wait(filter: Record<string, unknown>): void {
    if (this.currentState !== "running") {
      throw new Error(`Cannot wait in state '${this.currentState}'. Must be 'running'.`);
    }

    this.transition<SessionWaitEvent>(
      "waiting",
      "session:wait",
      {
        sessionId: this.info.sessionId,
        agentName: this.info.agentName,
        filter,
      }
    );
  }

  /**
   * Transition from waiting back to running (trigger matched)
   * @param triggerPayload The payload from the matched trigger
   */
  resume(triggerPayload?: unknown): void {
    if (this.currentState !== "waiting") {
      throw new Error(`Cannot resume session in state '${this.currentState}'. Must be 'waiting'.`);
    }

    this.transition<SessionResumeEvent>(
      "running",
      "session:resume",
      {
        sessionId: this.info.sessionId,
        agentName: this.info.agentName,
        triggerPayload,
      }
    );
  }

  /**
   * Transition from running to error
   * @param error Error message or reason for failure
   */
  fail(error: string): void {
    if (this.currentState !== "running" && this.currentState !== "waiting") {
      throw new Error(`Cannot fail session in state '${this.currentState}'. Must be 'running' or 'waiting'.`);
    }

    this.info.endedAt = new Date();
    this.info.error = error;
    const durationMs = this.durationMs!;

    this.transition<SessionErrorEvent>(
      "error",
      "session:error",
      {
        sessionId: this.info.sessionId,
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
    const validKillStates: SessionState[] = ["queued", "running", "waiting"];
    if (!validKillStates.includes(this.currentState)) {
      throw new Error(
        `Cannot kill session in terminal state '${this.currentState}'. ` +
        `Can only kill from: ${validKillStates.join(', ')}`
      );
    }

    // Set endedAt if not already set (for running instances)
    if (!this.info.endedAt) {
      this.info.endedAt = new Date();
    }

    // Only calculate duration if the instance was actually started
    const durationMs = this.info.startedAt ? this.durationMs ?? undefined : undefined;

    this.transition<SessionKillEvent>(
      "killed",
      "session:kill",
      {
        sessionId: this.info.sessionId,
        agentName: this.info.agentName,
        reason,
        durationMs,
      }
    );
  }

  /**
   * Check if the session is in a terminal state
   */
  isTerminal(): boolean {
    return ["completed", "error", "killed"].includes(this.currentState);
  }

  /**
   * Check if the session is currently running
   */
  isRunning(): boolean {
    return this.currentState === "running";
  }

  /**
   * Check if the session is waiting for a trigger
   */
  isWaiting(): boolean {
    return this.currentState === "waiting";
  }

  /**
   * Check if the session is queued
   */
  isQueued(): boolean {
    return this.currentState === "queued";
  }
}