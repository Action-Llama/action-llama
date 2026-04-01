import { useEffect, useRef, useCallback, useSyncExternalStore } from "react";
import {
  registerQuery,
  unregisterQuery,
  fetchQuery,
  subscribeToQuery,
  getQuerySnapshot,
} from "../lib/query-cache";
import type { QuerySnapshot } from "../lib/query-cache";
import type { InvalidationSignal } from "../lib/api";

export interface UseQueryOptions<T> {
  key: string;
  fetcher: (signal: AbortSignal) => Promise<T>;
  invalidateOn?: InvalidationSignal["type"][];
  invalidateAgent?: string;
  pollIntervalMs?: number;
  debounceMs?: number;
  enabled?: boolean;
}

export interface UseQueryResult<T> {
  data: T | null;
  error: Error | null;
  isLoading: boolean;
  refetch: () => void;
}

export function useQuery<T>(options: UseQueryOptions<T>): UseQueryResult<T> {
  const {
    key,
    fetcher,
    invalidateOn,
    invalidateAgent,
    pollIntervalMs,
    debounceMs,
    enabled = true,
  } = options;

  // Keep fetcher ref stable (user may pass inline arrow)
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const stableFetcher = useCallback(
    (signal: AbortSignal) => fetcherRef.current(signal),
    [],
  );

  // Serialize invalidateOn to a stable string for dependency comparison
  const invalidateOnKey = invalidateOn?.join(",");

  useEffect(() => {
    registerQuery(key, {
      fetcher: stableFetcher,
      invalidateOn,
      invalidateAgent,
      pollIntervalMs,
      debounceMs,
      enabled,
    });
    return () => unregisterQuery(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, stableFetcher, invalidateOnKey, invalidateAgent, pollIntervalMs, debounceMs, enabled]);

  const sub = useCallback(
    (cb: () => void) => subscribeToQuery(key, cb),
    [key],
  );

  const getSnap = useCallback(
    () => getQuerySnapshot<T>(key),
    [key],
  );

  const snap = useSyncExternalStore(sub, getSnap);

  const refetch = useCallback(() => fetchQuery(key), [key]);

  return {
    data: snap.data,
    error: snap.error,
    isLoading: snap.isLoading,
    refetch,
  };
}
