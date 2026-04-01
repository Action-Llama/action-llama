import { useSyncExternalStore } from "react";
import type { AgentStatus, SchedulerInfo, LogLine, AgentInstance, InvalidationSignal } from "./api";
import { SSEConnection } from "./sse";
import { dispatchSignals } from "./signal-bus";

export interface StatusSnapshot {
  agents: AgentStatus[];
  schedulerInfo: SchedulerInfo | null;
  recentLogs: LogLine[];
  instances: AgentInstance[];
  connected: boolean;
}

// Module-level singleton state
let snapshot: StatusSnapshot = {
  agents: [],
  schedulerInfo: null,
  recentLogs: [],
  instances: [],
  connected: false,
};
let listeners = new Set<() => void>();
let sseConnection: SSEConnection | null = null;
// Track latest invalidation signals for backward compat with useInvalidation
let latestInvalidated: InvalidationSignal[] = [];

function emit(): void {
  for (const cb of listeners) cb();
}

export function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => { listeners.delete(callback); };
}

export function getSnapshot(): StatusSnapshot {
  return snapshot;
}

export function getLatestInvalidated(): InvalidationSignal[] {
  return latestInvalidated;
}

/**
 * Initialize the SSE connection. Call once on app mount.
 * Returns a cleanup function to disconnect.
 */
export function initSSE(): () => void {
  if (sseConnection) return () => {};

  sseConnection = new SSEConnection({
    onMessage: (msg) => {
      const next: StatusSnapshot = {
        agents: msg.agents ?? snapshot.agents,
        schedulerInfo: msg.schedulerInfo !== undefined ? msg.schedulerInfo : snapshot.schedulerInfo,
        recentLogs: msg.recentLogs ?? snapshot.recentLogs,
        instances: msg.instances ?? snapshot.instances,
        connected: snapshot.connected,
      };
      snapshot = next;

      // Update invalidation signals for backward compat
      latestInvalidated = msg.invalidated ?? [];

      emit();

      // Dispatch to signal bus (separate from React re-renders)
      if (msg.invalidated && msg.invalidated.length > 0) {
        dispatchSignals(msg.invalidated);
      }
    },
    onConnectionChange: (state) => {
      const connected = state === "connected";
      if (connected !== snapshot.connected) {
        snapshot = { ...snapshot, connected };
        emit();
      }
    },
  });

  sseConnection.connect();

  return () => {
    sseConnection?.disconnect();
    sseConnection = null;
  };
}

// Selector hooks
export function useAgents(): AgentStatus[] {
  return useSyncExternalStore(subscribe, () => getSnapshot().agents);
}

export function useSchedulerInfo(): SchedulerInfo | null {
  return useSyncExternalStore(subscribe, () => getSnapshot().schedulerInfo);
}

export function useRecentLogs(): LogLine[] {
  return useSyncExternalStore(subscribe, () => getSnapshot().recentLogs);
}

export function useInstances(): AgentInstance[] {
  return useSyncExternalStore(subscribe, () => getSnapshot().instances);
}

export function useConnected(): boolean {
  return useSyncExternalStore(subscribe, () => getSnapshot().connected);
}
