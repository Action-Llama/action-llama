import { useEffect, useRef, useState, useCallback, useSyncExternalStore } from "react";
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
  /** Debounce key changes to coalesce rapid filter updates (ms). First load is always immediate. */
  keyChangeDebounceMs?: number;
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
    keyChangeDebounceMs,
  } = options;

  // Keep fetcher ref stable (user may pass inline arrow)
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const stableFetcher = useCallback(
    (signal: AbortSignal) => fetcherRef.current(signal),
    [],
  );

  // Debounce key changes: first load is immediate, subsequent changes are debounced.
  // During debounce, the old query stays active so stale data remains visible.
  const activeKeyRef = useRef(key);
  const [activeKey, setActiveKey] = useState(key);

  useEffect(() => {
    if (key === activeKeyRef.current) return;
    activeKeyRef.current = key;

    if (!keyChangeDebounceMs) {
      setActiveKey(key);
      return;
    }

    const t = setTimeout(() => setActiveKey(key), keyChangeDebounceMs);
    return () => clearTimeout(t);
  }, [key, keyChangeDebounceMs]);

  // Serialize invalidateOn to a stable string for dependency comparison
  const invalidateOnKey = invalidateOn?.join(",");

  useEffect(() => {
    registerQuery(activeKey, {
      fetcher: stableFetcher,
      invalidateOn,
      invalidateAgent,
      pollIntervalMs,
      debounceMs,
      enabled,
    });
    return () => unregisterQuery(activeKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, stableFetcher, invalidateOnKey, invalidateAgent, pollIntervalMs, debounceMs, enabled]);

  const sub = useCallback(
    (cb: () => void) => subscribeToQuery(activeKey, cb),
    [activeKey],
  );

  const getSnap = useCallback(
    () => getQuerySnapshot<T>(activeKey),
    [activeKey],
  );

  const snap = useSyncExternalStore(sub, getSnap);

  const refetch = useCallback(() => fetchQuery(activeKey), [activeKey]);

  return {
    data: snap.data,
    error: snap.error,
    isLoading: snap.isLoading,
    refetch,
  };
}
