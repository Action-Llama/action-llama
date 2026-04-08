/**
 * Integration tests: shared/persistence/event-store.ts Projections namespace — no Docker required.
 *
 * The Projections namespace has two functions that were imported but never tested
 * in the existing persistence-layer.test.ts:
 *
 *   1. Projections.eventCounts(events: AsyncIterable<Event>) → Map<string, number>
 *      Counts events grouped by event type.
 *
 *   2. Projections.timeWindow(events: AsyncIterable<Event>, windowMs: number)
 *      → Map<number, Event[]>
 *      Groups events into time windows of windowMs milliseconds each.
 *
 * These are pure aggregate projection functions that work on AsyncIterable<Event>.
 * We test them by constructing async generators that yield mock Event objects.
 *
 * Covers:
 *   - shared/persistence/event-store.ts: Projections.eventCounts() — empty iterable → empty Map
 *   - shared/persistence/event-store.ts: Projections.eventCounts() — single event → Map with count 1
 *   - shared/persistence/event-store.ts: Projections.eventCounts() — multiple same type → count > 1
 *   - shared/persistence/event-store.ts: Projections.eventCounts() — multiple types counted independently
 *   - shared/persistence/event-store.ts: Projections.timeWindow() — empty iterable → empty Map
 *   - shared/persistence/event-store.ts: Projections.timeWindow() — single event placed in window
 *   - shared/persistence/event-store.ts: Projections.timeWindow() — events in same window grouped together
 *   - shared/persistence/event-store.ts: Projections.timeWindow() — events in different windows separated
 *   - shared/persistence/event-store.ts: Projections.timeWindow() — window boundaries respect windowMs
 *   - shared/persistence/event-store.ts: buildProjectionFromIterable (private, exercised via both functions)
 */

import { describe, it, expect } from "vitest";

const { Projections } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/shared/persistence/event-store.js"
);

// Helper: create a mock Event with required fields
function makeEvent(
  type: string,
  timestamp: number,
  id: string = type + "-" + timestamp,
): { id: string; type: string; timestamp: number; data: unknown; version: number } {
  return {
    id,
    type,
    timestamp,
    data: {},
    version: 1,
  };
}

// Helper: create an AsyncIterable from an array
async function* asyncFrom<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
}

// ─── Projections.eventCounts ──────────────────────────────────────────────────

describe(
  "integration: Projections.eventCounts() (no Docker required)",
  { timeout: 10_000 },
  () => {
    it("empty iterable returns empty Map", async () => {
      const result = await Projections.eventCounts(asyncFrom([]));
      expect(result instanceof Map).toBe(true);
      expect(result.size).toBe(0);
    });

    it("single event → Map has one entry with count 1", async () => {
      const events = [makeEvent("run.started", 1000)];
      const result = await Projections.eventCounts(asyncFrom(events));
      expect(result.size).toBe(1);
      expect(result.get("run.started")).toBe(1);
    });

    it("three events of same type → count is 3", async () => {
      const events = [
        makeEvent("run.completed", 1000, "e1"),
        makeEvent("run.completed", 2000, "e2"),
        makeEvent("run.completed", 3000, "e3"),
      ];
      const result = await Projections.eventCounts(asyncFrom(events));
      expect(result.size).toBe(1);
      expect(result.get("run.completed")).toBe(3);
    });

    it("mixed types counted independently", async () => {
      const events = [
        makeEvent("run.started", 1000, "e1"),
        makeEvent("run.completed", 2000, "e2"),
        makeEvent("run.started", 3000, "e3"),
        makeEvent("run.failed", 4000, "e4"),
      ];
      const result = await Projections.eventCounts(asyncFrom(events));
      expect(result.size).toBe(3);
      expect(result.get("run.started")).toBe(2);
      expect(result.get("run.completed")).toBe(1);
      expect(result.get("run.failed")).toBe(1);
    });

    it("returns a Map (not an object)", async () => {
      const events = [makeEvent("lock.acquired", 500)];
      const result = await Projections.eventCounts(asyncFrom(events));
      expect(result instanceof Map).toBe(true);
    });

    it("all EventTypes constants can be counted", async () => {
      const events = [
        makeEvent("run.started", 100, "e1"),
        makeEvent("call.initiated", 200, "e2"),
        makeEvent("work.queued", 300, "e3"),
        makeEvent("lock.acquired", 400, "e4"),
        makeEvent("session.created", 500, "e5"),
      ];
      const result = await Projections.eventCounts(asyncFrom(events));
      expect(result.size).toBe(5);
      expect(result.get("run.started")).toBe(1);
      expect(result.get("call.initiated")).toBe(1);
      expect(result.get("work.queued")).toBe(1);
    });
  },
);

// ─── Projections.timeWindow ───────────────────────────────────────────────────

describe(
  "integration: Projections.timeWindow() (no Docker required)",
  { timeout: 10_000 },
  () => {
    it("empty iterable returns empty Map", async () => {
      const result = await Projections.timeWindow(asyncFrom([]), 1000);
      expect(result instanceof Map).toBe(true);
      expect(result.size).toBe(0);
    });

    it("single event placed in correct window", async () => {
      const windowMs = 1000;
      // timestamp 1500 → floor(1500/1000)*1000 = 1000
      const events = [makeEvent("run.started", 1500)];
      const result = await Projections.timeWindow(asyncFrom(events), windowMs);
      expect(result.size).toBe(1);
      expect(result.has(1000)).toBe(true);
      expect(result.get(1000)!.length).toBe(1);
      expect(result.get(1000)![0].type).toBe("run.started");
    });

    it("two events in same window grouped together", async () => {
      const windowMs = 1000;
      // Both timestamps 1100 and 1800 → floor to window 1000
      const events = [
        makeEvent("run.started", 1100, "e1"),
        makeEvent("run.completed", 1800, "e2"),
      ];
      const result = await Projections.timeWindow(asyncFrom(events), windowMs);
      expect(result.size).toBe(1);
      expect(result.get(1000)!.length).toBe(2);
    });

    it("events in different windows separated correctly", async () => {
      const windowMs = 1000;
      // 500 → window 0; 1500 → window 1000; 2500 → window 2000
      const events = [
        makeEvent("run.started", 500, "e1"),
        makeEvent("run.completed", 1500, "e2"),
        makeEvent("run.failed", 2500, "e3"),
      ];
      const result = await Projections.timeWindow(asyncFrom(events), windowMs);
      expect(result.size).toBe(3);
      expect(result.has(0)).toBe(true);
      expect(result.has(1000)).toBe(true);
      expect(result.has(2000)).toBe(true);
      expect(result.get(0)![0].type).toBe("run.started");
      expect(result.get(1000)![0].type).toBe("run.completed");
      expect(result.get(2000)![0].type).toBe("run.failed");
    });

    it("window boundaries respect windowMs value", async () => {
      const windowMs = 5000;
      // 4999 → window 0; 5000 → window 5000; 9999 → window 5000
      const events = [
        makeEvent("e1", 4999, "e1"),
        makeEvent("e2", 5000, "e2"),
        makeEvent("e3", 9999, "e3"),
      ];
      const result = await Projections.timeWindow(asyncFrom(events), windowMs);
      expect(result.size).toBe(2);
      expect(result.get(0)!.length).toBe(1); // 4999 → floor(4999/5000)*5000=0
      expect(result.get(5000)!.length).toBe(2); // 5000 and 9999
    });

    it("multiple events in same window preserve insertion order", async () => {
      const windowMs = 10_000;
      const events = [
        makeEvent("first", 1000, "e1"),
        makeEvent("second", 2000, "e2"),
        makeEvent("third", 3000, "e3"),
      ];
      const result = await Projections.timeWindow(asyncFrom(events), windowMs);
      expect(result.size).toBe(1);
      const group = result.get(0)!;
      expect(group[0].type).toBe("first");
      expect(group[1].type).toBe("second");
      expect(group[2].type).toBe("third");
    });

    it("window key is a number (epoch ms floored to window)", async () => {
      const windowMs = 60_000; // 1 minute
      const timestamp = 75_000; // 1m 15s → window 60000
      const events = [makeEvent("run.started", timestamp)];
      const result = await Projections.timeWindow(asyncFrom(events), windowMs);
      const [key] = [...result.keys()];
      expect(typeof key).toBe("number");
      expect(key).toBe(60_000);
    });
  },
);
