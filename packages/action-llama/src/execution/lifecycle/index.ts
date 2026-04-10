import { EventEmitter } from "events";

// Session states for individual agent runs
export type SessionState = "queued" | "running" | "waiting" | "completed" | "error" | "killed";

// Agent states for agent type-level state
export type AgentState = "idle" | "running" | "waiting" | "building" | "error";

// Base event types for state machine transitions
export interface StateTransitionEvent<T extends string> {
  fromState: T;
  toState: T;
  timestamp: Date;
}

// Session-specific events
export interface SessionTransitionEvent extends StateTransitionEvent<SessionState> {
  sessionId: string;
  agentName: string;
}

// Agent-specific events
export interface AgentTransitionEvent extends StateTransitionEvent<AgentState> {
  agentName: string;
}

// Validation for valid state transitions
const VALID_SESSION_TRANSITIONS: Record<SessionState, SessionState[]> = {
  queued: ["running", "killed"], // can start running or be killed while queued
  running: ["waiting", "completed", "error", "killed"], // can wait, complete, error, or be killed
  waiting: ["running", "error", "killed"], // can resume, timeout (error), or be killed
  completed: [], // terminal state
  error: [], // terminal state
  killed: [], // terminal state
};

const VALID_AGENT_TRANSITIONS: Record<AgentState, AgentState[]> = {
  idle: ["running", "building", "error"], // can start running, start building, or error
  running: ["idle", "running", "waiting", "error"], // can return to idle, stay running, wait, or error
  waiting: ["idle", "running", "waiting", "error"], // can resume, timeout, or be killed
  building: ["idle", "running", "error"], // build can complete (idle/running) or fail (error)
  error: ["idle", "building", "running"], // can recover to any other state
};

/**
 * Base state machine class with transition validation logic.
 * Emits events on state transitions for external listeners.
 */
export abstract class BaseStateMachine<T extends string> extends EventEmitter {
  protected currentState: T;
  protected validTransitions: Record<T, T[]>;

  constructor(initialState: T, validTransitions: Record<T, T[]>) {
    super();
    this.currentState = initialState;
    this.validTransitions = validTransitions;
  }

  /**
   * Get the current state
   */
  getState(): T {
    return this.currentState;
  }

  /**
   * Check if a transition from current state to target state is valid
   */
  canTransitionTo(targetState: T): boolean {
    const allowedStates = this.validTransitions[this.currentState] as T[];
    return allowedStates.includes(targetState);
  }

  /**
   * Transition to a new state with validation
   * @param targetState The state to transition to
   * @param eventType The event type to emit
   * @param eventData Additional data to include in the event
   */
  protected transition<E extends StateTransitionEvent<T>>(
    targetState: T,
    eventType: string,
    eventData: Omit<E, 'fromState' | 'toState' | 'timestamp'>
  ): void {
    if (!this.canTransitionTo(targetState)) {
      throw new Error(
        `Invalid state transition from '${this.currentState}' to '${targetState}'. ` +
        `Valid transitions are: ${this.validTransitions[this.currentState].join(', ')}`
      );
    }

    const fromState = this.currentState;
    this.currentState = targetState;

    const event: E = {
      ...eventData,
      fromState,
      toState: targetState,
      timestamp: new Date(),
    } as E;

    this.emit(eventType, event);
    this.emit('transition', event);
  }

  /**
   * Force transition to a state without validation (for error recovery)
   */
  protected forceTransition<E extends StateTransitionEvent<T>>(
    targetState: T,
    eventType: string,
    eventData: Omit<E, 'fromState' | 'toState' | 'timestamp'>
  ): void {
    const fromState = this.currentState;
    this.currentState = targetState;

    const event: E = {
      ...eventData,
      fromState,
      toState: targetState,
      timestamp: new Date(),
    } as E;

    this.emit(eventType, event);
    this.emit('transition', event);
  }
}

/**
 * Get the valid instance state transitions map
 */
export function getValidSessionTransitions(): Record<SessionState, SessionState[]> {
  return { ...VALID_SESSION_TRANSITIONS };
}

/**
 * Get the valid agent state transitions map
 */
export function getValidAgentTransitions(): Record<AgentState, AgentState[]> {
  return { ...VALID_AGENT_TRANSITIONS };
}

/**
 * Check if an instance state is terminal (no further transitions allowed)
 */
export function isTerminalSessionState(state: SessionState): boolean {
  return VALID_SESSION_TRANSITIONS[state].length === 0;
}

/**
 * Check if an agent state is terminal (no further transitions allowed)
 */
export function isTerminalAgentState(state: AgentState): boolean {
  return VALID_AGENT_TRANSITIONS[state].length === 0;
}