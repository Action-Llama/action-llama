import { useEffect } from "react";
import {
  initSSE,
  getLatestInvalidated,
  useAgents,
  useSchedulerInfo,
  useRecentLogs,
  useInstances,
  useConnected,
} from "../lib/status-store";
import type { StatusSnapshot } from "../lib/status-store";
import type { InvalidationSignal } from "../lib/api";

// Re-export selector hooks for convenience
export { useAgents, useSchedulerInfo, useRecentLogs, useInstances, useConnected };

// Full status stream return type (backward compat)
type StatusStreamReturn = StatusSnapshot & { invalidated: InvalidationSignal[] };

export function StatusStreamProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const cleanup = initSSE();
    return cleanup;
  }, []);
  return <>{children}</>;
}

export function useStatusStream(): StatusStreamReturn {
  const agents = useAgents();
  const schedulerInfo = useSchedulerInfo();
  const recentLogs = useRecentLogs();
  const instances = useInstances();
  const connected = useConnected();
  // For backward compat, expose latest invalidated from the store
  // This will be removed once all pages migrate to useQuery
  const invalidated = getLatestInvalidated();

  return { agents, schedulerInfo, recentLogs, instances, connected, invalidated };
}
