/**
 * Typed event bus for scheduler lifecycle events.
 *
 * Used for test instrumentation — in production, no listeners are attached
 * and events are effectively no-ops. In integration tests, the harness
 * subscribes to events to wait for specific conditions without polling.
 */

import { EventEmitter } from "events";

export interface RunStartEvent {
  agentName: string;
  instanceId: string;
  trigger: string;
}

export interface RunEndEvent {
  agentName: string;
  instanceId: string;
  result: string;
  exitCode?: number;
  error?: string;
}

export interface LockEvent {
  agentName: string;
  instanceId: string;
  resourceKey: string;
  action: "acquire" | "release" | "heartbeat";
  ok: boolean;
  status: number;
  reason?: string;
}

export interface CallEvent {
  callerAgent: string;
  targetAgent: string;
  ok: boolean;
  callId?: string;
  reason?: string;
}

export interface SignalEvent {
  agentName: string;
  instanceId: string;
  signal: "rerun" | "status" | "trigger" | "return";
}

export interface WebhookReceivedEvent {
  source: string;
  event?: string;
}

export interface WebhookDispatchedEvent {
  source: string;
  agents: string[];
}

export interface SchedulerEventMap {
  "run:start": RunStartEvent;
  "run:end": RunEndEvent;
  "lock": LockEvent;
  "call": CallEvent;
  "signal": SignalEvent;
  "webhook:received": WebhookReceivedEvent;
  "webhook:dispatched": WebhookDispatchedEvent;
}

export class SchedulerEventBus {
  private emitter = new EventEmitter();

  emit<K extends keyof SchedulerEventMap>(event: K, data: SchedulerEventMap[K]): void {
    this.emitter.emit(event, data);
  }

  on<K extends keyof SchedulerEventMap>(event: K, listener: (data: SchedulerEventMap[K]) => void): this {
    this.emitter.on(event, listener as (...args: unknown[]) => void);
    return this;
  }

  once<K extends keyof SchedulerEventMap>(event: K, listener: (data: SchedulerEventMap[K]) => void): this {
    this.emitter.once(event, listener as (...args: unknown[]) => void);
    return this;
  }

  off<K extends keyof SchedulerEventMap>(event: K, listener: (data: SchedulerEventMap[K]) => void): this {
    this.emitter.off(event, listener as (...args: unknown[]) => void);
    return this;
  }

  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }

  /**
   * Wait for an event matching an optional predicate.
   * Rejects after timeoutMs. Used by test harness.
   */
  waitFor<K extends keyof SchedulerEventMap>(
    event: K,
    predicate?: (data: SchedulerEventMap[K]) => boolean,
    timeoutMs = 120_000,
  ): Promise<SchedulerEventMap[K]> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off(event, handler);
        reject(new Error(`Timed out waiting for "${event}" event after ${timeoutMs}ms`));
      }, timeoutMs);

      const handler = (data: SchedulerEventMap[K]) => {
        if (!predicate || predicate(data)) {
          clearTimeout(timer);
          this.off(event, handler);
          resolve(data);
        }
      };

      this.on(event, handler);
    });
  }

  /**
   * Collect all events of a given type into an array.
   * Returns a handle to stop collecting and retrieve results.
   */
  collect<K extends keyof SchedulerEventMap>(event: K): { stop: () => SchedulerEventMap[K][] } {
    const collected: SchedulerEventMap[K][] = [];
    const handler = (data: SchedulerEventMap[K]) => { collected.push(data); };
    this.on(event, handler);
    return {
      stop: () => {
        this.off(event, handler);
        return collected;
      },
    };
  }
}
