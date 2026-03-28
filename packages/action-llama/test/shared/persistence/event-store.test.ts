/**
 * Tests for EventMigrator, EventStreamWrapper, and Projections in event-store.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createEvent,
  EventMigrator,
  EventStreamWrapper,
  Projections,
  EventTypes,
} from "../../../src/shared/persistence/event-store.js";
import type { Event, EventStream, EventQuery } from "../../../src/shared/persistence/index.js";

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: "evt-1",
    type: "test.event",
    data: { value: 42 },
    metadata: {},
    timestamp: 1_000_000,
    version: 1,
    ...overrides,
  };
}

/** Creates a mock EventStream backed by an in-memory array. */
function makeMemoryStream(events: Event[] = []): EventStream {
  const stored: Event[] = [...events];
  let counter = 0;

  return {
    async append(partial) {
      const event: Event = {
        id: `auto-${++counter}`,
        timestamp: Date.now(),
        ...partial,
        version: partial.version ?? 1,
      };
      stored.push(event);
      return event;
    },

    async *replay(query?: EventQuery): AsyncIterable<Event> {
      for (const event of stored) {
        if (query?.type && event.type !== query.type) continue;
        if (query?.from !== undefined && event.timestamp < query.from) continue;
        if (query?.to !== undefined && event.timestamp >= query.to) continue;
        yield event;
      }
    },

    async getSnapshot<T>(type: string): Promise<T | null> {
      const key = `snapshot:${type}`;
      const snap = (makeMemoryStream as any).__snapshots?.[key];
      return snap ?? null;
    },

    async saveSnapshot<T>(type: string, data: T): Promise<void> {
      // no-op for basic tests
    },
  };
}

// ─── EventMigrator ─────────────────────────────────────────────────────────

describe("EventMigrator", () => {
  let migrator: EventMigrator;

  beforeEach(() => {
    migrator = new EventMigrator();
  });

  it("returns the event unchanged when version already meets target", () => {
    const event = makeEvent({ version: 2 });
    const result = migrator.migrate(event, 2);
    expect(result).toEqual(event);
  });

  it("applies a single migration to advance version by one", () => {
    migrator.addMigration("test.event", {
      fromVersion: 1,
      toVersion: 2,
      migrate: (e) => ({ ...e, data: { ...e.data, migrated: true }, version: 2 }),
    });

    const event = makeEvent({ version: 1 });
    const result = migrator.migrate(event, 2);

    expect(result.version).toBe(2);
    expect(result.data.migrated).toBe(true);
  });

  it("chains multiple migrations to advance version by multiple steps", () => {
    migrator.addMigration("test.event", {
      fromVersion: 1,
      toVersion: 2,
      migrate: (e) => ({ ...e, data: { step: "v2" }, version: 2 }),
    });
    migrator.addMigration("test.event", {
      fromVersion: 2,
      toVersion: 3,
      migrate: (e) => ({ ...e, data: { step: "v3" }, version: 3 }),
    });

    const event = makeEvent({ version: 1 });
    const result = migrator.migrate(event, 3);

    expect(result.version).toBe(3);
    expect(result.data.step).toBe("v3");
  });

  it("throws when no migration is registered for the event type", () => {
    const event = makeEvent({ type: "other.event", version: 1 });
    expect(() => migrator.migrate(event, 2)).toThrow(
      /No migration found for other.event from version 1/
    );
  });

  it("throws when migration is missing for an intermediate version", () => {
    migrator.addMigration("test.event", {
      fromVersion: 1,
      toVersion: 2,
      migrate: (e) => ({ ...e, version: 2 }),
    });
    // No v2 -> v3 migration registered
    const event = makeEvent({ version: 1 });
    expect(() => migrator.migrate(event, 3)).toThrow(
      /No migration found for test.event from version 2/
    );
  });

  it("handles multiple event types independently", () => {
    migrator.addMigration("type.a", {
      fromVersion: 1,
      toVersion: 2,
      migrate: (e) => ({ ...e, data: "a-migrated", version: 2 }),
    });
    migrator.addMigration("type.b", {
      fromVersion: 1,
      toVersion: 2,
      migrate: (e) => ({ ...e, data: "b-migrated", version: 2 }),
    });

    const a = migrator.migrate(makeEvent({ type: "type.a", version: 1 }), 2);
    const b = migrator.migrate(makeEvent({ type: "type.b", version: 1 }), 2);

    expect(a.data).toBe("a-migrated");
    expect(b.data).toBe("b-migrated");
  });
});

// ─── EventStreamWrapper ────────────────────────────────────────────────────

describe("EventStreamWrapper", () => {
  let innerStream: EventStream & { stored: Event[] };
  let wrapper: EventStreamWrapper;

  beforeEach(() => {
    const mem = makeMemoryStream() as any;
    mem.stored = [];
    // Keep a reference to stored items
    const originalAppend = mem.append.bind(mem);
    mem.append = async (partial: any) => {
      const evt = await originalAppend(partial);
      mem.stored.push(evt);
      return evt;
    };
    innerStream = mem;
    wrapper = new EventStreamWrapper(innerStream);
  });

  describe("appendTyped", () => {
    it("appends a typed event with the given type and data", async () => {
      const event = await wrapper.appendTyped("user.created", { name: "Alice" });
      expect(event.type).toBe("user.created");
      expect(event.data.name).toBe("Alice");
      expect(event.version).toBe(1);
    });

    it("passes metadata to the underlying stream", async () => {
      const event = await wrapper.appendTyped(
        "user.created",
        { name: "Bob" },
        { actor: "system" }
      );
      expect(event.metadata?.actor).toBe("system");
    });

    it("overrides version when explicitly provided", async () => {
      const event = await wrapper.appendTyped("versioned.event", {}, undefined, 3);
      expect(event.version).toBe(3);
    });
  });

  describe("replay", () => {
    it("delegates to the inner stream replay", async () => {
      await wrapper.appendTyped("a", {});
      await wrapper.appendTyped("b", {});

      const events: Event[] = [];
      for await (const e of wrapper.replay()) {
        events.push(e);
      }
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe("a");
      expect(events[1].type).toBe("b");
    });

    it("forwards query filters to the inner stream", async () => {
      await wrapper.appendTyped("type.x", {});
      await wrapper.appendTyped("type.y", {});

      const events: Event[] = [];
      for await (const e of wrapper.replay({ type: "type.x" })) {
        events.push(e);
      }
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("type.x");
    });
  });

  describe("replayType", () => {
    it("yields only events matching the given type", async () => {
      await wrapper.appendTyped("run.started", { id: 1 });
      await wrapper.appendTyped("run.completed", { id: 1 });
      await wrapper.appendTyped("run.started", { id: 2 });

      const events: Event[] = [];
      for await (const e of wrapper.replayType("run.started")) {
        events.push(e);
      }
      expect(events).toHaveLength(2);
      expect(events[0].data.id).toBe(1);
      expect(events[1].data.id).toBe(2);
    });

    it("yields no events when none match the type", async () => {
      await wrapper.appendTyped("other.event", {});

      const events: Event[] = [];
      for await (const e of wrapper.replayType("not.found")) {
        events.push(e);
      }
      expect(events).toHaveLength(0);
    });
  });

  describe("buildProjection", () => {
    it("reduces all events into a cumulative state", async () => {
      await wrapper.appendTyped("counter.incremented", { delta: 1 });
      await wrapper.appendTyped("counter.incremented", { delta: 5 });
      await wrapper.appendTyped("counter.incremented", { delta: 3 });

      const total = await wrapper.buildProjection(
        0,
        (state, event) => state + event.data.delta
      );
      expect(total).toBe(9);
    });

    it("returns the initial state when there are no events", async () => {
      const result = await wrapper.buildProjection({ count: 0 }, (s) => s);
      expect(result).toEqual({ count: 0 });
    });
  });

  describe("getLatestEvent", () => {
    it("returns the first matching event of the given type", async () => {
      await wrapper.appendTyped("status.changed", { status: "running" });
      await wrapper.appendTyped("unrelated.event", {});

      const latest = await wrapper.getLatestEvent("status.changed");
      expect(latest).not.toBeNull();
      expect(latest!.type).toBe("status.changed");
      expect(latest!.data.status).toBe("running");
    });

    it("returns null when no event of the given type exists", async () => {
      await wrapper.appendTyped("other.event", {});

      const latest = await wrapper.getLatestEvent("not.here");
      expect(latest).toBeNull();
    });
  });

  describe("getSnapshot / saveSnapshot", () => {
    it("delegates getSnapshot to the inner stream", async () => {
      const mockGetSnapshot = vi.fn().mockResolvedValue({ cached: true });
      (innerStream as any).getSnapshot = mockGetSnapshot;

      const result = await wrapper.getSnapshot("my-type");
      expect(mockGetSnapshot).toHaveBeenCalledWith("my-type");
      expect(result).toEqual({ cached: true });
    });

    it("delegates saveSnapshot to the inner stream", async () => {
      const mockSaveSnapshot = vi.fn().mockResolvedValue(undefined);
      (innerStream as any).saveSnapshot = mockSaveSnapshot;

      await wrapper.saveSnapshot("my-type", { data: 1 }, "evt-123");
      expect(mockSaveSnapshot).toHaveBeenCalledWith("my-type", { data: 1 }, "evt-123");
    });
  });
});

// ─── Projections ───────────────────────────────────────────────────────────

describe("Projections", () => {
  async function* eventsIterable(events: Event[]): AsyncIterable<Event> {
    for (const e of events) yield e;
  }

  describe("eventCounts", () => {
    it("counts each event type", async () => {
      const events = [
        makeEvent({ type: "a" }),
        makeEvent({ type: "b" }),
        makeEvent({ type: "a" }),
        makeEvent({ type: "a" }),
      ];

      const counts = await Projections.eventCounts(eventsIterable(events));
      expect(counts.get("a")).toBe(3);
      expect(counts.get("b")).toBe(1);
    });

    it("returns an empty map for no events", async () => {
      const counts = await Projections.eventCounts(eventsIterable([]));
      expect(counts.size).toBe(0);
    });
  });

  describe("timeWindow", () => {
    it("groups events into fixed time windows", async () => {
      const windowMs = 1000;
      const base = 0;
      const events = [
        makeEvent({ timestamp: base + 100 }),       // window 0
        makeEvent({ timestamp: base + 500 }),       // window 0
        makeEvent({ timestamp: base + 1100 }),      // window 1000
        makeEvent({ timestamp: base + 2500 }),      // window 2000
      ];

      const windows = await Projections.timeWindow(eventsIterable(events), windowMs);
      expect(windows.get(0)).toHaveLength(2);
      expect(windows.get(1000)).toHaveLength(1);
      expect(windows.get(2000)).toHaveLength(1);
    });

    it("returns an empty map for no events", async () => {
      const windows = await Projections.timeWindow(eventsIterable([]), 1000);
      expect(windows.size).toBe(0);
    });

    it("places all events in the same window when timestamps are close", async () => {
      const events = [
        makeEvent({ timestamp: 100 }),
        makeEvent({ timestamp: 200 }),
        makeEvent({ timestamp: 999 }),
      ];
      const windows = await Projections.timeWindow(eventsIterable(events), 1000);
      expect(windows.size).toBe(1);
      expect(windows.get(0)).toHaveLength(3);
    });
  });
});

// ─── createEvent ───────────────────────────────────────────────────────────

describe("createEvent", () => {
  it("always sets metadata.source to action-llama", () => {
    const event = createEvent("test.action", {}, { source: "custom", actor: "user" });
    expect(event.metadata?.source).toBe("action-llama");
    expect(event.metadata?.actor).toBe("user");
  });

  it("defaults version to 1", () => {
    const event = createEvent("test.action", {});
    expect(event.version).toBe(1);
  });

  it("uses the provided version", () => {
    const event = createEvent("test.action", {}, undefined, 3);
    expect(event.version).toBe(3);
  });

  it("does not include id or timestamp fields", () => {
    const event = createEvent("test.action", {});
    expect("id" in event).toBe(false);
    expect("timestamp" in event).toBe(false);
  });
});

// ─── EventTypes constants ──────────────────────────────────────────────────

describe("EventTypes", () => {
  it("exports run lifecycle constants", () => {
    expect(EventTypes.RUN_STARTED).toBe("run.started");
    expect(EventTypes.RUN_COMPLETED).toBe("run.completed");
    expect(EventTypes.RUN_FAILED).toBe("run.failed");
  });

  it("exports call constants", () => {
    expect(EventTypes.CALL_INITIATED).toBe("call.initiated");
    expect(EventTypes.CALL_COMPLETED).toBe("call.completed");
    expect(EventTypes.CALL_FAILED).toBe("call.failed");
  });

  it("exports work queue constants", () => {
    expect(EventTypes.WORK_QUEUED).toBe("work.queued");
    expect(EventTypes.WORK_DEQUEUED).toBe("work.dequeued");
    expect(EventTypes.WORK_DROPPED).toBe("work.dropped");
  });

  it("exports lock constants", () => {
    expect(EventTypes.LOCK_ACQUIRED).toBe("lock.acquired");
    expect(EventTypes.LOCK_RELEASED).toBe("lock.released");
    expect(EventTypes.LOCK_EXPIRED).toBe("lock.expired");
  });

  it("exports session constants", () => {
    expect(EventTypes.SESSION_CREATED).toBe("session.created");
    expect(EventTypes.SESSION_EXPIRED).toBe("session.expired");
  });
});
