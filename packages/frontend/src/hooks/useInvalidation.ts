import { useEffect, useRef } from "react";
import { useStatusStream } from "./StatusStreamContext";
import type { InvalidationSignal } from "../lib/api";

/**
 * Fires `callback` whenever an invalidation signal matching `type` (and
 * optionally `agent`) arrives via the SSE status stream.
 *
 * Debounced: rapid-fire signals are coalesced so the callback fires at most
 * once per second.
 */
export function useInvalidation(
  type: InvalidationSignal["type"],
  agent: string | undefined,
  callback: () => void,
): void {
  const cbRef = useRef(callback);
  cbRef.current = callback;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { invalidated } = useStatusStream();

  useEffect(() => {
    if (invalidated.length === 0) return;

    const matched = invalidated.some(
      (s) => s.type === type && (agent === undefined || s.agent === agent),
    );
    if (matched && !timerRef.current) {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        cbRef.current();
      }, 1000);
    }
  }, [invalidated, type, agent]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);
}
