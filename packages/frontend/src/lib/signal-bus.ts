import type { InvalidationSignal } from "./api";

interface Subscription {
  types: InvalidationSignal["type"][];
  agent: string | undefined;
  callback: () => void;
  debounceMs: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const subscriptions = new Set<Subscription>();

export function subscribeToSignals(
  types: InvalidationSignal["type"][],
  agent: string | undefined,
  callback: () => void,
  debounceMs = 500,
): () => void {
  const sub: Subscription = { types, agent, callback, debounceMs, timer: null };
  subscriptions.add(sub);
  return () => {
    if (sub.timer) clearTimeout(sub.timer);
    subscriptions.delete(sub);
  };
}

export function dispatchSignals(signals: InvalidationSignal[]): void {
  for (const sub of subscriptions) {
    const matched = signals.some(
      (s) =>
        sub.types.includes(s.type) &&
        (sub.agent === undefined || s.agent === sub.agent),
    );
    if (matched && !sub.timer) {
      sub.timer = setTimeout(() => {
        sub.timer = null;
        sub.callback();
      }, sub.debounceMs);
    }
  }
}
