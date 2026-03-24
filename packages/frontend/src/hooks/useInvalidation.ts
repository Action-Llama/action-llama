import { useEffect, useRef } from "react";
import { useStatusStream } from "./StatusStreamContext";
import type { InvalidationSignal } from "../lib/api";

/**
 * Fires `callback` whenever an invalidation signal matching `type` (and
 * optionally `agent`) arrives via the SSE status stream.
 */
export function useInvalidation(
  type: InvalidationSignal["type"],
  agent: string | undefined,
  callback: () => void,
): void {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  const { invalidated } = useStatusStream();

  useEffect(() => {
    if (invalidated.length === 0) return;

    const matched = invalidated.some(
      (s) => s.type === type && (agent === undefined || s.agent === agent),
    );
    if (matched) {
      cbRef.current();
    }
  }, [invalidated, type, agent]);
}
