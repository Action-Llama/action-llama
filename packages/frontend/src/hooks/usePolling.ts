import { useEffect, useRef } from "react";

export interface UsePollingOptions {
  /** Polling interval in milliseconds. */
  intervalMs: number;
  /** If true, polling is active. Defaults to true. */
  enabled?: boolean;
}

/**
 * Centralized polling hook. Handles:
 * - Immediate first poll on mount / when enabled
 * - Fixed-interval subsequent polls via setInterval
 * - In-flight guard (skips tick if previous request still pending)
 * - AbortController passed to the callback for fetch cancellation
 * - Automatic cleanup (clearInterval + abort) on unmount or dependency change
 *
 * Usage:
 *   usePolling((signal) => fetchSomething(signal), { intervalMs: 4000 }, [dep]);
 */
export function usePolling(
  /** Async callback that performs the poll. Receives an AbortSignal. */
  callback: (signal: AbortSignal) => Promise<void>,
  options: UsePollingOptions,
  /** Extra dependencies that should restart the polling cycle. */
  deps: readonly unknown[] = [],
): void {
  // Keep callback ref stable so interval always calls latest version
  const cbRef = useRef(callback);
  cbRef.current = callback;

  const { intervalMs, enabled = true } = options;

  useEffect(() => {
    if (!enabled) return;

    const controller = new AbortController();
    let inFlight = false;

    const poll = () => {
      if (inFlight) return;
      inFlight = true;
      cbRef.current(controller.signal)
        .catch(() => {})
        .finally(() => {
          inFlight = false;
        });
    };

    poll();
    const id = setInterval(poll, intervalMs);
    return () => {
      clearInterval(id);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, enabled, ...deps]);
}
