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
