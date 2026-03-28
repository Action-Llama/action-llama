/**
 * Tests for LegacyMigrator and migrateFromLegacy helper in migration.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  LegacyMigrator,
  migrateFromLegacy,
  type MigrationProgress,
} from "../../../src/shared/persistence/migration.js";
import {
  createPersistenceStore,
  type PersistenceStore,
} from "../../../src/shared/persistence/index.js";
import type { StateStore } from "../../../src/shared/state-store.js";

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeMockStateStore(
  data: Record<string, Array<{ key: string; value: any }>> = {}
): StateStore {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    deleteAll: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockImplementation(async (ns: string) => data[ns] ?? []),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

async function collectMigrationEvents(store: PersistenceStore) {
  const events: any[] = [];
  for await (const event of store.events.stream("migration").replay()) {
    events.push(event);
  }
  return events;
}

// ─── LegacyMigrator.migrateStateStore ─────────────────────────────────────

describe("LegacyMigrator.migrateStateStore", () => {
  let store: PersistenceStore;
  let migrator: LegacyMigrator;

  beforeEach(async () => {
    store = await createPersistenceStore({ type: "memory" });
    migrator = new LegacyMigrator(store);
  });

  afterEach(async () => {
    await store.close();
  });

  it("reports 100% immediately when the legacy store has no data", async () => {
    const legacyStore = makeMockStateStore();
    const progress: MigrationProgress[] = [];

    await migrator.migrateStateStore(legacyStore, {
      onProgress: (p) => progress.push(p),
    });

    expect(progress).toHaveLength(1);
    expect(progress[0].percentage).toBe(100);
    expect(progress[0].processed).toBe(0);
    expect(progress[0].total).toBe(0);
  });

  it("migrates key-value items from the legacy state store into the new persistence KV", async () => {
    const legacyStore = makeMockStateStore({
      locks: [
        { key: "resource-1", value: { holder: "agent-a" } },
        { key: "resource-2", value: { holder: "agent-b" } },
      ],
    });

    await migrator.migrateStateStore(legacyStore);

    const v1 = await store.kv.get("locks", "resource-1");
    const v2 = await store.kv.get("locks", "resource-2");
    expect(v1).toEqual({ holder: "agent-a" });
    expect(v2).toEqual({ holder: "agent-b" });
  });

  it("migrates items across multiple namespaces", async () => {
    const legacyStore = makeMockStateStore({
      sessions: [{ key: "sess-1", value: { token: "abc" } }],
      calls: [{ key: "call-1", value: { result: "ok" } }],
    });

    await migrator.migrateStateStore(legacyStore);

    const session = await store.kv.get("sessions", "sess-1");
    const call = await store.kv.get("calls", "call-1");
    expect(session).toEqual({ token: "abc" });
    expect(call).toEqual({ result: "ok" });
  });

  it("creates a state.migrated audit event for each migrated item", async () => {
    const legacyStore = makeMockStateStore({
      containers: [{ key: "c-1", value: { name: "container-one" } }],
    });

    await migrator.migrateStateStore(legacyStore);

    const events = await collectMigrationEvents(store);
    expect(events.length).toBeGreaterThan(0);

    const migratedEvent = events.find((e) => e.type === "state.migrated");
    expect(migratedEvent).toBeDefined();
    expect(migratedEvent.data.namespace).toBe("containers");
    expect(migratedEvent.data.key).toBe("c-1");
    expect(migratedEvent.data.source).toBe("legacy-state-store");
  });

  it("preserves original data in the legacy store by default", async () => {
    const legacyStore = makeMockStateStore({
      locks: [{ key: "lock-1", value: { holder: "agent-x" } }],
    });

    await migrator.migrateStateStore(legacyStore);

    expect(legacyStore.deleteAll).not.toHaveBeenCalled();
  });

  it("deletes original namespaces from legacy store when preserveOriginal=false", async () => {
    const legacyStore = makeMockStateStore({
      locks: [{ key: "lock-1", value: { holder: "agent-x" } }],
    });

    await migrator.migrateStateStore(legacyStore, { preserveOriginal: false });

    expect(legacyStore.deleteAll).toHaveBeenCalledWith("locks");
  });

  it("reports progress during migration with correct totals", async () => {
    const legacyStore = makeMockStateStore({
      calls: [
        { key: "call-1", value: { result: "ok" } },
        { key: "call-2", value: { result: "err" } },
      ],
    });
    const progress: MigrationProgress[] = [];

    await migrator.migrateStateStore(legacyStore, {
      onProgress: (p) => progress.push(p),
    });

    expect(progress.length).toBeGreaterThanOrEqual(2);
    // One of the progress steps should reference the "calls" namespace
    const callsStep = progress.find((p) => p.step.includes("calls"));
    expect(callsStep).toBeDefined();
    // Final progress should be 100%
    const last = progress[progress.length - 1];
    expect(last.percentage).toBe(100);
    expect(last.processed).toBe(2);
    expect(last.total).toBe(2);
  });

  it("calls onProgress without crashing when no callback is provided", async () => {
    const legacyStore = makeMockStateStore({
      locks: [{ key: "lock-1", value: { holder: "agent-a" } }],
    });

    await expect(migrator.migrateStateStore(legacyStore)).resolves.not.toThrow();
  });
});

// ─── LegacyMigrator.migrateStatsStore ─────────────────────────────────────

describe("LegacyMigrator.migrateStatsStore", () => {
  let store: PersistenceStore;
  let migrator: LegacyMigrator;

  beforeEach(async () => {
    store = await createPersistenceStore({ type: "memory" });
    migrator = new LegacyMigrator(store);
  });

  afterEach(async () => {
    await store.close();
  });

  it("reports no stats data to migrate when SQL queries return empty results", async () => {
    // The memory backend does not support SQL; migration catches the error and
    // falls back to an empty array, resulting in a "no data" early return.
    const progress: MigrationProgress[] = [];

    // legacyStore is not actually used in migrateStatsStore implementation
    await migrator.migrateStatsStore({} as any, {
      onProgress: (p) => progress.push(p),
    });

    const noDataStep = progress.find((p) => p.step.includes("No stats data"));
    expect(noDataStep).toBeDefined();
    expect(noDataStep?.percentage).toBe(100);
  });

  it("first reports counting step before the early-return step", async () => {
    const progress: MigrationProgress[] = [];

    await migrator.migrateStatsStore({} as any, {
      onProgress: (p) => progress.push(p),
    });

    expect(progress[0].step).toContain("Counting historical data");
    expect(progress[0].percentage).toBe(0);
  });

  it("completes without error when no options are provided", async () => {
    await expect(migrator.migrateStatsStore({} as any)).resolves.not.toThrow();
  });
});

// ─── LegacyMigrator.migrateAll ─────────────────────────────────────────────

describe("LegacyMigrator.migrateAll", () => {
  let store: PersistenceStore;
  let migrator: LegacyMigrator;

  beforeEach(async () => {
    store = await createPersistenceStore({ type: "memory" });
    migrator = new LegacyMigrator(store);
  });

  afterEach(async () => {
    await store.close();
  });

  it("completes without error when no legacy stores are provided", async () => {
    await expect(migrator.migrateAll()).resolves.not.toThrow();
  });

  it("appends migration.completed event to the migration stream", async () => {
    await migrator.migrateAll();

    const events = await collectMigrationEvents(store);
    const completedEvent = events.find((e) => e.type === "migration.completed");
    expect(completedEvent).toBeDefined();
    expect(completedEvent.data.version).toBe("1.0.0");
  });

  it("migrates the state store when provided", async () => {
    const legacyStore = makeMockStateStore({
      containers: [{ key: "container-1", value: { name: "c1" } }],
    });

    await migrator.migrateAll(legacyStore);

    const migratedValue = await store.kv.get("containers", "container-1");
    expect(migratedValue).toEqual({ name: "c1" });
  });

  it("reports starting and completion progress callbacks", async () => {
    const progress: MigrationProgress[] = [];

    await migrator.migrateAll(undefined, undefined, {
      onProgress: (p) => progress.push(p),
    });

    expect(progress[0].step).toContain("Starting complete migration");
    expect(progress[0].percentage).toBe(0);

    const last = progress[progress.length - 1];
    expect(last.percentage).toBe(100);
    expect(last.step).toContain("All migrations completed");
  });

  it("reports migrating state store step when state store is provided", async () => {
    const legacyStore = makeMockStateStore();
    const progress: MigrationProgress[] = [];

    await migrator.migrateAll(legacyStore, undefined, {
      onProgress: (p) => progress.push(p),
    });

    const stateStep = progress.find((p) => p.step.includes("Migrating state store"));
    expect(stateStep).toBeDefined();
    expect(stateStep?.percentage).toBe(25);
  });

  it("appends migration.failed event and rethrows when a transaction fails", async () => {
    const badStore = await createPersistenceStore({ type: "memory" });
    const transactionError = new Error("transaction failed during test");
    vi.spyOn(badStore, "transaction").mockRejectedValue(transactionError);

    const badMigrator = new LegacyMigrator(badStore);
    const legacyStore = makeMockStateStore({
      locks: [{ key: "lock-1", value: { holder: "agent-x" } }],
    });

    await expect(badMigrator.migrateAll(legacyStore)).rejects.toThrow(
      "transaction failed during test"
    );

    const events = await collectMigrationEvents(badStore);
    const failedEvent = events.find((e) => e.type === "migration.failed");
    expect(failedEvent).toBeDefined();
    expect(failedEvent.data.error).toBe("transaction failed during test");

    await badStore.close();
  });

  it("includes timestamp in migration.completed event data", async () => {
    const before = Date.now();
    await migrator.migrateAll();
    const after = Date.now();

    const events = await collectMigrationEvents(store);
    const completedEvent = events.find((e) => e.type === "migration.completed");
    expect(completedEvent.data.timestamp).toBeGreaterThanOrEqual(before);
    expect(completedEvent.data.timestamp).toBeLessThanOrEqual(after);
  });
});

// ─── migrateFromLegacy ─────────────────────────────────────────────────────

describe("migrateFromLegacy", () => {
  it("completes without error when no legacy stores are provided", async () => {
    const store = await createPersistenceStore({ type: "memory" });
    try {
      await expect(migrateFromLegacy(store)).resolves.not.toThrow();
    } finally {
      await store.close();
    }
  });

  it("logs migration progress to console.log", async () => {
    const store = await createPersistenceStore({ type: "memory" });
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await migrateFromLegacy(store);
      expect(consoleSpy).toHaveBeenCalled();
      const firstCallArg = consoleSpy.mock.calls[0][0] as string;
      expect(firstCallArg).toMatch(/^Migration:/);
      expect(firstCallArg).toMatch(/\d+%/);
    } finally {
      consoleSpy.mockRestore();
      await store.close();
    }
  });

  it("migrates state store data when a legacy state store is provided", async () => {
    const store = await createPersistenceStore({ type: "memory" });
    const legacyStore = makeMockStateStore({
      sessions: [{ key: "session-1", value: { userId: "u1" } }],
    });

    try {
      await migrateFromLegacy(store, legacyStore);
      const value = await store.kv.get("sessions", "session-1");
      expect(value).toEqual({ userId: "u1" });
    } finally {
      await store.close();
    }
  });

  it("respects options passed through to the migrator", async () => {
    const store = await createPersistenceStore({ type: "memory" });
    const legacyStore = makeMockStateStore({
      locks: [{ key: "lock-x", value: { holder: "a" } }],
    });

    try {
      await migrateFromLegacy(store, legacyStore, undefined, {
        preserveOriginal: false,
      });
      expect(legacyStore.deleteAll).toHaveBeenCalledWith("locks");
    } finally {
      await store.close();
    }
  });
});

// ─── Additional coverage tests ─────────────────────────────────────────────

describe("LegacyMigrator.migrateStateStore — catch branch", () => {
  it("skips namespaces that throw during list and still migrates valid ones", async () => {
    const store = await createPersistenceStore({ type: "memory" });
    const migrator = new LegacyMigrator(store);

    // Make list throw for "locks" but return data for "sessions"
    const legacyStore: StateStore = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      deleteAll: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockImplementation(async (ns: string) => {
        if (ns === "locks") throw new Error("namespace not found");
        if (ns === "sessions") return [{ key: "sess-1", value: { token: "abc" } }];
        return [];
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };

    await migrator.migrateStateStore(legacyStore);

    // sessions should still be migrated
    const val = await store.kv.get("sessions", "sess-1");
    expect(val).toEqual({ token: "abc" });

    await store.close();
  });
});

describe("LegacyMigrator.migrateStatsStore — with actual run and call data", () => {
  it("creates run started and completed events for each run record", async () => {
    const store = await createPersistenceStore({ type: "memory" });
    const migrator = new LegacyMigrator(store);

    const mockRun = {
      instance_id: "inst-1",
      agent_name: "test-agent",
      trigger_type: "schedule",
      trigger_source: null,
      result: "completed",
      exit_code: 0,
      duration_ms: 1200,
      input_tokens: 100,
      output_tokens: 50,
      cache_read_tokens: 10,
      cache_write_tokens: 5,
      total_tokens: 165,
      cost_usd: 0.001,
      turn_count: 3,
      error_message: null,
      pre_hook_ms: null,
      post_hook_ms: null,
    };

    // Mock query.sql to return the run
    vi.spyOn(store, "query", "get").mockReturnValue({
      sql: vi.fn().mockImplementation(async (q: string) => {
        if (q.includes("runs")) return [mockRun];
        return [];
      }),
    });

    await migrator.migrateStatsStore({} as any);

    const statsEvents: any[] = [];
    for await (const event of store.events.stream("stats").replay()) {
      statsEvents.push(event);
    }

    const runStarted = statsEvents.find((e) => e.type === "run.started");
    expect(runStarted).toBeDefined();
    expect(runStarted.data.instanceId).toBe("inst-1");
    expect(runStarted.data.agentName).toBe("test-agent");

    const runCompleted = statsEvents.find((e) => e.type === "run.completed");
    expect(runCompleted).toBeDefined();
    expect(runCompleted.data.result).toBe("completed");

    await store.close();
  });

  it("creates run.failed event when run result is error", async () => {
    const store = await createPersistenceStore({ type: "memory" });
    const migrator = new LegacyMigrator(store);

    const mockRun = {
      instance_id: "inst-fail",
      agent_name: "failing-agent",
      trigger_type: "manual",
      trigger_source: null,
      result: "error",
      exit_code: 1,
      duration_ms: 500,
      input_tokens: 20,
      output_tokens: 5,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      total_tokens: 25,
      cost_usd: 0.0001,
      turn_count: 1,
      error_message: "Something went wrong",
      pre_hook_ms: null,
      post_hook_ms: null,
    };

    vi.spyOn(store, "query", "get").mockReturnValue({
      sql: vi.fn().mockImplementation(async (q: string) => {
        if (q.includes("runs")) return [mockRun];
        return [];
      }),
    });

    await migrator.migrateStatsStore({} as any);

    const statsEvents: any[] = [];
    for await (const event of store.events.stream("stats").replay()) {
      statsEvents.push(event);
    }

    const runFailed = statsEvents.find((e) => e.type === "run.failed");
    expect(runFailed).toBeDefined();
    expect(runFailed.data.result).toBe("error");
    expect(runFailed.data.errorMessage).toBe("Something went wrong");

    await store.close();
  });

  it("creates call initiated and completed events for each call edge record", async () => {
    const store = await createPersistenceStore({ type: "memory" });
    const migrator = new LegacyMigrator(store);

    const mockCall = {
      caller_agent: "agent-a",
      caller_instance: "inst-a-1",
      target_agent: "agent-b",
      target_instance: "inst-b-1",
      depth: 1,
      duration_ms: 800,
      status: "completed",
    };

    vi.spyOn(store, "query", "get").mockReturnValue({
      sql: vi.fn().mockImplementation(async (q: string) => {
        if (q.includes("call_edges")) return [mockCall];
        return [];
      }),
    });

    await migrator.migrateStatsStore({} as any);

    const statsEvents: any[] = [];
    for await (const event of store.events.stream("stats").replay()) {
      statsEvents.push(event);
    }

    const callInitiated = statsEvents.find((e) => e.type === "call.initiated");
    expect(callInitiated).toBeDefined();
    expect(callInitiated.data.callerAgent).toBe("agent-a");
    expect(callInitiated.data.targetAgent).toBe("agent-b");

    const callCompleted = statsEvents.find((e) => e.type === "call.completed");
    expect(callCompleted).toBeDefined();
    expect(callCompleted.data.durationMs).toBe(800);

    await store.close();
  });

  it("creates call.failed event when call status is error", async () => {
    const store = await createPersistenceStore({ type: "memory" });
    const migrator = new LegacyMigrator(store);

    const mockCall = {
      caller_agent: "agent-a",
      caller_instance: "inst-a-1",
      target_agent: "agent-b",
      target_instance: "inst-b-1",
      depth: 1,
      duration_ms: 300,
      status: "error",
    };

    vi.spyOn(store, "query", "get").mockReturnValue({
      sql: vi.fn().mockImplementation(async (q: string) => {
        if (q.includes("call_edges")) return [mockCall];
        return [];
      }),
    });

    await migrator.migrateStatsStore({} as any);

    const statsEvents: any[] = [];
    for await (const event of store.events.stream("stats").replay()) {
      statsEvents.push(event);
    }

    const callFailed = statsEvents.find((e) => e.type === "call.failed");
    expect(callFailed).toBeDefined();
    expect(callFailed.data.status).toBe("error");

    await store.close();
  });

  it("does not create call completed/failed event when duration_ms is null", async () => {
    const store = await createPersistenceStore({ type: "memory" });
    const migrator = new LegacyMigrator(store);

    const mockCall = {
      caller_agent: "agent-a",
      caller_instance: "inst-a-1",
      target_agent: "agent-b",
      target_instance: "inst-b-1",
      depth: 1,
      duration_ms: null,
      status: null,
    };

    vi.spyOn(store, "query", "get").mockReturnValue({
      sql: vi.fn().mockImplementation(async (q: string) => {
        if (q.includes("call_edges")) return [mockCall];
        return [];
      }),
    });

    await migrator.migrateStatsStore({} as any);

    const statsEvents: any[] = [];
    for await (const event of store.events.stream("stats").replay()) {
      statsEvents.push(event);
    }

    const callInitiated = statsEvents.find((e) => e.type === "call.initiated");
    expect(callInitiated).toBeDefined();
    // No completion event when duration_ms is null
    const callCompleted = statsEvents.find((e) => e.type === "call.completed");
    expect(callCompleted).toBeUndefined();
    const callFailed = statsEvents.find((e) => e.type === "call.failed");
    expect(callFailed).toBeUndefined();

    await store.close();
  });

  it("appends stats.migrated event with run and call counts", async () => {
    const store = await createPersistenceStore({ type: "memory" });
    const migrator = new LegacyMigrator(store);

    vi.spyOn(store, "query", "get").mockReturnValue({
      sql: vi.fn().mockImplementation(async (q: string) => {
        if (q.includes("runs")) return [{ instance_id: "r1", agent_name: "a", trigger_type: "schedule", trigger_source: null, result: "completed", exit_code: 0, duration_ms: 100, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, total_tokens: 0, cost_usd: 0, turn_count: 1, error_message: null, pre_hook_ms: null, post_hook_ms: null }];
        if (q.includes("call_edges")) return [];
        return [];
      }),
    });

    const progress: MigrationProgress[] = [];
    await migrator.migrateStatsStore({} as any, { onProgress: (p) => progress.push(p) });

    const migrationEvents: any[] = [];
    for await (const event of store.events.stream("migration").replay()) {
      migrationEvents.push(event);
    }

    const statsMigrated = migrationEvents.find((e) => e.type === "stats.migrated");
    expect(statsMigrated).toBeDefined();
    expect(statsMigrated.data.runsCount).toBe(1);
    expect(statsMigrated.data.callEdgesCount).toBe(0);

    // Final progress should be 100%
    const lastProgress = progress[progress.length - 1];
    expect(lastProgress.percentage).toBe(100);
    expect(lastProgress.step).toContain("Migration completed");

    await store.close();
  });
});

describe("LegacyMigrator.migrateAll — with legacyStatsStore", () => {
  it("reports migrating stats store step when stats store is provided", async () => {
    const store = await createPersistenceStore({ type: "memory" });
    const migrator = new LegacyMigrator(store);
    const progress: MigrationProgress[] = [];

    // migrateStatsStore uses newStore.query.sql, not legacyStatsStore
    await migrator.migrateAll(undefined, {} as any, {
      onProgress: (p) => progress.push(p),
    });

    const statsStep = progress.find((p) => p.step.includes("Migrating stats store"));
    expect(statsStep).toBeDefined();
    expect(statsStep?.percentage).toBe(50);

    await store.close();
  });

  it("completes successfully when both state and stats stores are provided", async () => {
    const store = await createPersistenceStore({ type: "memory" });
    const migrator = new LegacyMigrator(store);
    const legacyStore = makeMockStateStore({
      locks: [{ key: "lock-1", value: { holder: "a" } }],
    });

    await expect(migrator.migrateAll(legacyStore, {} as any)).resolves.not.toThrow();

    const events: any[] = [];
    for await (const event of store.events.stream("migration").replay()) {
      events.push(event);
    }
    const completedEvent = events.find((e) => e.type === "migration.completed");
    expect(completedEvent).toBeDefined();

    await store.close();
  });
});
