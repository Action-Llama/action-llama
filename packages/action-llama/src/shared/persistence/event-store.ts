/**
 * Event sourcing utilities and helpers.
 * 
 * Provides event versioning, schema evolution helpers, and common event patterns
 * used throughout the Action Llama system.
 */

import type { Event, EventStream } from "./index.js";

/** Common event types used across the system */
export namespace EventTypes {
  // Run lifecycle events
  export const RUN_STARTED = "run.started";
  export const RUN_COMPLETED = "run.completed";
  export const RUN_FAILED = "run.failed";
  
  // Call events 
  export const CALL_INITIATED = "call.initiated";
  export const CALL_COMPLETED = "call.completed";
  export const CALL_FAILED = "call.failed";
  
  // Work queue events
  export const WORK_QUEUED = "work.queued";
  export const WORK_DEQUEUED = "work.dequeued";
  export const WORK_DROPPED = "work.dropped";
  
  // Lock events
  export const LOCK_ACQUIRED = "lock.acquired";
  export const LOCK_RELEASED = "lock.released";
  export const LOCK_EXPIRED = "lock.expired";
  
  // Session events
  export const SESSION_CREATED = "session.created";
  export const SESSION_EXPIRED = "session.expired";
}

/** Event metadata standard fields */
export interface EventMetadata {
  /** Source system/component that generated the event */
  source?: string;
  /** Correlation ID for tracing related events */
  correlationId?: string;
  /** User or system that triggered the event */
  actor?: string;
  /** Additional tags for filtering/grouping */
  tags?: string[];
}

/** Helper for creating events with proper defaults */
export function createEvent(
  type: string,
  data: any,
  metadata?: EventMetadata,
  version: number = 1
): Omit<Event, 'id' | 'timestamp'> {
  return {
    type,
    data,
    metadata: {
      ...metadata,
      source: "action-llama", // Always use consistent source for audit purposes
    },
    version,
  };
}

/** Schema evolution helper */
export interface EventMigration {
  fromVersion: number;
  toVersion: number;
  migrate: (event: Event) => Event;
}

export class EventMigrator {
  private migrations = new Map<string, EventMigration[]>();
  
  addMigration(eventType: string, migration: EventMigration): void {
    if (!this.migrations.has(eventType)) {
      this.migrations.set(eventType, []);
    }
    this.migrations.get(eventType)!.push(migration);
  }
  
  migrate(event: Event, targetVersion: number): Event {
    const migrations = this.migrations.get(event.type) || [];
    let currentEvent = { ...event };
    
    while (currentEvent.version < targetVersion) {
      const migration = migrations.find(m => m.fromVersion === currentEvent.version);
      if (!migration) {
        throw new Error(`No migration found for ${event.type} from version ${currentEvent.version}`);
      }
      currentEvent = migration.migrate(currentEvent);
    }
    
    return currentEvent;
  }
}

/** Event stream wrapper with additional utilities */
export class EventStreamWrapper {
  constructor(private stream: EventStream) {}
  
  /** Append a typed event */
  async appendTyped<T>(
    type: string,
    data: T,
    metadata?: EventMetadata,
    version: number = 1
  ): Promise<Event> {
    return this.stream.append(createEvent(type, data, metadata, version));
  }
  
  /** Replay events of a specific type */
  async *replayType<T>(
    type: string,
    from?: number,
    to?: number
  ): AsyncIterable<Event & { data: T }> {
    for await (const event of this.stream.replay({ type, from, to })) {
      yield event as Event & { data: T };
    }
  }
  
  /** Build a projection from events */
  async buildProjection<T>(
    initialState: T,
    reducer: (state: T, event: Event) => T,
    from?: number
  ): Promise<T> {
    let state = initialState;
    for await (const event of this.stream.replay({ from })) {
      state = reducer(state, event);
    }
    return state;
  }
  
  /** Get the latest event of a specific type */
  async getLatestEvent(type: string): Promise<Event | null> {
    const events = [];
    for await (const event of this.stream.replay({ type, limit: 1 })) {
      events.push(event);
    }
    return events[0] || null;
  }
}

/** Common projection builders */
export namespace Projections {
  /** Count events by type */
  export function eventCounts(events: AsyncIterable<Event>): Promise<Map<string, number>> {
    return buildProjectionFromIterable(
      events,
      new Map<string, number>(),
      (counts, event) => {
        counts.set(event.type, (counts.get(event.type) || 0) + 1);
        return counts;
      }
    );
  }
  
  /** Group events by time window */
  export function timeWindow(
    events: AsyncIterable<Event>,
    windowMs: number
  ): Promise<Map<number, Event[]>> {
    return buildProjectionFromIterable(
      events,
      new Map<number, Event[]>(),
      (windows, event) => {
        const window = Math.floor(event.timestamp / windowMs) * windowMs;
        if (!windows.has(window)) {
          windows.set(window, []);
        }
        windows.get(window)!.push(event);
        return windows;
      }
    );
  }
}

async function buildProjectionFromIterable<T, E>(
  events: AsyncIterable<E>,
  initialState: T,
  reducer: (state: T, event: E) => T
): Promise<T> {
  let state = initialState;
  for await (const event of events) {
    state = reducer(state, event);
  }
  return state;
}