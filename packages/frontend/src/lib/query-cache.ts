import { subscribeToSignals } from "./signal-bus";
import type { InvalidationSignal } from "./api";

export interface QuerySnapshot<T = unknown> {
  data: T | null;
  error: Error | null;
  isLoading: boolean;
}

interface CacheEntry {
  data: unknown;
  error: Error | null;
  status: "idle" | "loading" | "success" | "error";
  refCount: number;
  fetcher: ((signal: AbortSignal) => Promise<unknown>) | null;
  abortController: AbortController | null;
  inFlight: boolean;
  dirty: boolean;
  pollTimer: ReturnType<typeof setInterval> | null;
  signalUnsubscribe: (() => void) | null;
  listeners: Set<() => void>;
  /** Cached snapshot object for useSyncExternalStore referential stability */
  lastSnapshot: QuerySnapshot | null;
}

const cache = new Map<string, CacheEntry>();

function emitEntry(key: string): void {
  const entry = cache.get(key);
  if (!entry) return;
  for (const cb of entry.listeners) cb();
}

export interface RegisterOptions {
  fetcher: (signal: AbortSignal) => Promise<unknown>;
  invalidateOn?: InvalidationSignal["type"][];
  invalidateAgent?: string;
  pollIntervalMs?: number;
  debounceMs?: number;
  enabled?: boolean;
}

export function registerQuery(key: string, options: RegisterOptions): void {
  const existing = cache.get(key);
  if (existing) {
    existing.refCount++;
    // Update fetcher reference (user may pass new inline arrow)
    existing.fetcher = options.fetcher;
    return;
  }

  const entry: CacheEntry = {
    data: null,
    error: null,
    status: "idle",
    refCount: 1,
    fetcher: options.fetcher,
    abortController: null,
    inFlight: false,
    dirty: false,
    pollTimer: null,
    signalUnsubscribe: null,
    listeners: new Set(),
    lastSnapshot: null,
  };
  cache.set(key, entry);

  // Subscribe to invalidation signals
  if (options.invalidateOn && options.invalidateOn.length > 0) {
    entry.signalUnsubscribe = subscribeToSignals(
      options.invalidateOn,
      options.invalidateAgent,
      () => fetchQuery(key),
      options.debounceMs ?? 500,
    );
  }

  // Start polling if configured
  if (options.pollIntervalMs && options.enabled !== false) {
    entry.pollTimer = setInterval(() => fetchQuery(key), options.pollIntervalMs);
  }

  // Initial fetch
  if (options.enabled !== false) {
    fetchQuery(key);
  }
}

export function unregisterQuery(key: string): void {
  const entry = cache.get(key);
  if (!entry) return;
  entry.refCount--;
  if (entry.refCount <= 0) {
    if (entry.abortController) entry.abortController.abort();
    if (entry.pollTimer) clearInterval(entry.pollTimer);
    if (entry.signalUnsubscribe) entry.signalUnsubscribe();
    cache.delete(key);
  }
}

export function fetchQuery(key: string): void {
  const entry = cache.get(key);
  if (!entry || !entry.fetcher) return;

  if (entry.inFlight) {
    entry.dirty = true;
    return;
  }

  entry.inFlight = true;
  entry.dirty = false;
  const controller = new AbortController();
  entry.abortController = controller;

  if (entry.status === "idle") {
    entry.status = "loading";
    emitEntry(key);
  }

  entry.fetcher(controller.signal)
    .then((data) => {
      if (controller.signal.aborted) return;
      entry.data = data;
      entry.error = null;
      entry.status = "success";
    })
    .catch((err) => {
      if (controller.signal.aborted) return;
      entry.error = err instanceof Error ? err : new Error(String(err));
      entry.status = "error";
    })
    .finally(() => {
      if (controller.signal.aborted) return;
      entry.inFlight = false;
      entry.abortController = null;
      emitEntry(key);
      if (entry.dirty) {
        fetchQuery(key);
      }
    });
}

export function subscribeToQuery(key: string, callback: () => void): () => void {
  const entry = cache.get(key);
  if (!entry) return () => {};
  entry.listeners.add(callback);
  return () => { entry.listeners.delete(callback); };
}

const EMPTY_SNAPSHOT: QuerySnapshot = { data: null, error: null, isLoading: false };

export function getQuerySnapshot<T>(key: string): QuerySnapshot<T> {
  const entry = cache.get(key);
  if (!entry) return EMPTY_SNAPSHOT as QuerySnapshot<T>;
  const isLoading = entry.status === "loading" || (entry.status === "idle" && entry.inFlight);
  const last = entry.lastSnapshot;
  if (last && last.data === entry.data && last.error === entry.error && last.isLoading === isLoading) {
    return last as QuerySnapshot<T>;
  }
  const snap: QuerySnapshot<T> = { data: entry.data as T | null, error: entry.error, isLoading };
  entry.lastSnapshot = snap as QuerySnapshot;
  return snap;
}
