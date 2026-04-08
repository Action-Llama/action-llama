/**
 * Integration tests: shared/persistence/migration.ts LegacyMigrator — no Docker required.
 *
 * LegacyMigrator provides utilities to migrate data from the legacy
 * StateStore/StatsStore approach to the new unified persistence layer.
 *
 * The migrator:
 *   - migrateStateStore(legacyStore) — reads from legacy namespaces, writes to
 *     new persistence KV store as events, optionally deletes legacy data
 *   - migrateStatsStore(legacyStore) — reads SQL tables, converts to events
 *   - migrateAll(stateStore?, statsStore?) — orchestrates both migrations
 *   - LegacyMigrator constructor — accepts PersistenceStore
 *
 * migrateFromLegacy() is a helper that wraps LegacyMigrator with progress logging.
 *
 * Tests exercise the migrator with an empty/mock legacy state store to cover
 * branches without needing Docker or real data. Since migrateStatsStore uses
 * SQL queries (requires SQLite backend), those tests use the SQLite backend.
 *
 * Covers:
 *   - shared/persistence/migration.ts: LegacyMigrator constructor
 *   - shared/persistence/migration.ts: migrateStateStore() empty store → no-op
 *   - shared/persistence/migration.ts: migrateStateStore() onProgress called on completion
 *   - shared/persistence/migration.ts: migrateStateStore() preserveOriginal=false deletes data
 *   - shared/persistence/migration.ts: migrateStatsStore() empty tables → runs 0 events
 *   - shared/persistence/migration.ts: migrateAll() no legacy stores → completes with marker event
 *   - shared/persistence/migration.ts: migrateAll() with legacy state store → migrates data
 *   - shared/persistence/migration.ts: migrateFromLegacy() calls migrator and logs progress
 */

import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const { createPersistenceStore } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/shared/persistence/index.js"
);

const { LegacyMigrator, migrateFromLegacy } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/shared/persistence/migration.js"
);

// ── Helpers ────────────────────────────────────────────────────────────────

const tmpDir = mkdtempSync(join(tmpdir(), "migration-test-"));

async function makeStore(name: string) {
  return createPersistenceStore({
    type: "sqlite",
    path: join(tmpDir, `${name}.db`),
  });
}

/** Create a minimal in-memory StateStore mock. */
function makeMockStateStore(data: Record<string, Array<{ key: string; value: any }>> = {}) {
  return {
    list: vi.fn(async (namespace: string) => data[namespace] || []),
    get: vi.fn(async () => null),
    set: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    deleteAll: vi.fn(async (namespace: string) => {
      delete data[namespace];
    }),
    close: vi.fn(async () => {}),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("integration: LegacyMigrator (no Docker required)", { timeout: 15_000 }, () => {
  it("constructor creates LegacyMigrator without error", async () => {
    const store = await makeStore("constructor-test");
    const migrator = new LegacyMigrator(store);
    expect(migrator).toBeDefined();
    expect(migrator).toBeInstanceOf(LegacyMigrator);
  });

  it("migrateStateStore() completes without error when legacy store is empty", async () => {
    const store = await makeStore("migrate-state-empty");
    const migrator = new LegacyMigrator(store);
    const legacyStore = makeMockStateStore();

    await expect(migrator.migrateStateStore(legacyStore)).resolves.toBeUndefined();
  });

  it("migrateStateStore() calls onProgress on completion", async () => {
    const store = await makeStore("migrate-state-progress");
    const migrator = new LegacyMigrator(store);
    const legacyStore = makeMockStateStore();
    const progressEvents: string[] = [];

    await migrator.migrateStateStore(legacyStore, {
      onProgress: (p) => progressEvents.push(p.step),
    });

    // Should report some progress (at least one event)
    expect(progressEvents.length).toBeGreaterThan(0);
  });

  it("migrateStateStore() migrates KV data from legacy store to new persistence", async () => {
    const store = await makeStore("migrate-state-data");
    const migrator = new LegacyMigrator(store);
    const legacyData = {
      locks: [
        { key: "lock-1", value: { holder: "agent-a", expires: Date.now() + 60000 } },
        { key: "lock-2", value: { holder: "agent-b", expires: Date.now() + 60000 } },
      ],
    };
    const legacyStore = makeMockStateStore(legacyData);

    await migrator.migrateStateStore(legacyStore);

    // Data should now be available in the new store
    const lock1 = await store.kv.get("locks", "lock-1");
    expect(lock1).toBeDefined();
    expect((lock1 as any)?.holder).toBe("agent-a");
  });

  it("migrateStateStore() with preserveOriginal=false deletes legacy data", async () => {
    const store = await makeStore("migrate-state-delete");
    const migrator = new LegacyMigrator(store);
    const legacyData = {
      sessions: [{ key: "sess-1", value: { userId: "u1" } }],
    };
    const legacyStore = makeMockStateStore(legacyData);

    await migrator.migrateStateStore(legacyStore, { preserveOriginal: false });

    // deleteAll should have been called for the "sessions" namespace
    expect(legacyStore.deleteAll).toHaveBeenCalledWith("sessions");
  });

  it("migrateStatsStore() completes without error on empty tables", async () => {
    const store = await makeStore("migrate-stats-empty");
    const migrator = new LegacyMigrator(store);
    const legacyStatsStore = {
      queryRuns: vi.fn(async () => []),
      queryCallEdges: vi.fn(async () => []),
    };

    await expect(migrator.migrateStatsStore(legacyStatsStore as any)).resolves.toBeUndefined();
  });

  it("migrateAll() with no legacy stores completes and writes migration marker event", async () => {
    const store = await makeStore("migrate-all-empty");
    const migrator = new LegacyMigrator(store);

    // No legacy stores provided
    await expect(migrator.migrateAll()).resolves.toBeUndefined();

    // Should have written a migration.completed event
    const events: any[] = [];
    for await (const event of store.events.stream("migration").replay()) {
      events.push(event);
    }
    expect(events.length).toBeGreaterThan(0);
    expect(events[events.length - 1].type).toBe("migration.completed");
  });

  it("migrateAll() with legacy state store migrates and writes completion event", async () => {
    const store = await makeStore("migrate-all-state");
    const migrator = new LegacyMigrator(store);
    const legacyStore = makeMockStateStore({
      calls: [{ key: "call-1", value: { status: "pending" } }],
    });

    await migrator.migrateAll(legacyStore);

    // Migration completion event should exist
    const events: any[] = [];
    for await (const event of store.events.stream("migration").replay()) {
      events.push(event);
    }
    const completedEvent = events.find((e: any) => e.type === "migration.completed");
    expect(completedEvent).toBeDefined();
  });

  it("migrateFromLegacy() runs migration and logs progress to console", async () => {
    const store = await makeStore("migrate-from-legacy");
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await migrateFromLegacy(store);

      // Should have logged progress
      expect(consoleSpy).toHaveBeenCalled();
      const loggedMessages = consoleSpy.mock.calls.map((c: any[]) => c.join(" "));
      const hasMigrationLog = loggedMessages.some((m) => m.includes("Migration:"));
      expect(hasMigrationLog).toBe(true);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("migrateFromLegacy() with empty legacy stores completes without throwing", async () => {
    const store = await makeStore("migrate-from-legacy-empty");
    const legacyStore = makeMockStateStore();
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await expect(migrateFromLegacy(store, legacyStore)).resolves.toBeUndefined();
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
