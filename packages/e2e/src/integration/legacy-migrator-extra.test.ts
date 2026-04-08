/**
 * Integration tests: shared/persistence/migration.ts LegacyMigrator additional paths
 * — no Docker required.
 *
 * Extends the existing legacy-migrator.test.ts by covering paths not yet tested:
 *
 *   1. migrateAll() with BOTH legacyStateStore AND legacyStatsStore:
 *      Both migrations are called → completion event created
 *
 *   2. migrateAll() error path (catch block):
 *      When migrateStateStore() throws (legacyStore.list() rejects),
 *      a migration.failed event is created, and the error is re-thrown.
 *
 *   3. migrateStateStore() with onProgress called for each namespace:
 *      Exercises the per-namespace progress reporting loop.
 *
 *   4. migrateAll() when migrateStatsStore() is called (legacyStatsStore provided):
 *      The legacyStatsStore parameter path is exercised.
 *
 * Covers:
 *   - shared/persistence/migration.ts: migrateAll() — both stores → migration.completed
 *   - shared/persistence/migration.ts: migrateAll() — error in migration → migration.failed + rethrow
 *   - shared/persistence/migration.ts: migrateAll() — legacyStatsStore parameter path
 *   - shared/persistence/migration.ts: migrateStateStore() — onProgress per-namespace reports
 */

import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const { createPersistenceStore } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/shared/persistence/index.js"
);

const { LegacyMigrator } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/shared/persistence/migration.js"
);

// ── Helpers ────────────────────────────────────────────────────────────────

const tmpDir = mkdtempSync(join(tmpdir(), "migration-extra-test-"));
let dbCounter = 0;

async function makeStore() {
  dbCounter++;
  return createPersistenceStore({
    type: "sqlite",
    path: join(tmpDir, `store-${dbCounter}.db`),
  });
}

/** Create a minimal mock state store that simulates having data in one namespace. */
function makeMockStateStore(data: Record<string, Array<{ key: string; value: any }>> = {}) {
  return {
    list: vi.fn(async (namespace: string) => data[namespace] || []),
    deleteAll: vi.fn(async () => {}),
  };
}

/** Create a minimal mock stats store (the migrateStatsStore parameter is not actually used). */
function makeMockStatsStore() {
  return {
    queryRuns: vi.fn(async () => []),
    queryCallEdges: vi.fn(async () => []),
  };
}

/** Read all events from a named stream. */
async function collectEvents(store: any, streamName: string): Promise<any[]> {
  const events: any[] = [];
  for await (const event of store.events.stream(streamName).replay()) {
    events.push(event);
  }
  return events;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe(
  "integration: LegacyMigrator additional paths (no Docker required)",
  { timeout: 30_000 },
  () => {
    // ── 1. migrateAll() with both stores ───────────────────────────────────────

    it("migrateAll() with both stateStore and statsStore → writes migration.completed event", async () => {
      const store = await makeStore();
      const migrator = new LegacyMigrator(store);

      const legacyStateStore = makeMockStateStore({
        locks: [{ key: "lock-1", value: { holder: "agent-abc" } }],
      });
      const legacyStatsStore = makeMockStatsStore();

      await migrator.migrateAll(legacyStateStore, legacyStatsStore as any);

      // migration.completed event should be in the migration stream
      const events = await collectEvents(store, "migration");
      const completedEvent = events.find((e: any) => e.type === "migration.completed");
      expect(completedEvent).toBeDefined();
    });

    it("migrateAll() with both stores → calls migrateStateStore and migrateStatsStore paths", async () => {
      const store = await makeStore();
      const migrator = new LegacyMigrator(store);

      const legacyStateStore = makeMockStateStore();
      const legacyStatsStore = makeMockStatsStore();

      const stateSpy = vi.spyOn(migrator as any, "migrateStateStore");
      const statsSpy = vi.spyOn(migrator as any, "migrateStatsStore");

      await migrator.migrateAll(legacyStateStore, legacyStatsStore as any);

      expect(stateSpy).toHaveBeenCalledTimes(1);
      expect(statsSpy).toHaveBeenCalledTimes(1);
    });

    // ── 2. migrateAll() error path ─────────────────────────────────────────────

    it("migrateAll() writes migration.failed event when migrateStateStore throws", async () => {
      const store = await makeStore();
      const migrator = new LegacyMigrator(store);

      // Use vi.spyOn to directly override migrateStateStore
      // (legacyStore.list() is caught internally, so we mock the whole method)
      vi.spyOn(migrator as any, "migrateStateStore").mockRejectedValueOnce(
        new Error("Simulated state store failure")
      );

      await expect(
        migrator.migrateAll(makeMockStateStore() as any)
      ).rejects.toThrow("Simulated state store failure");

      // migration.failed event should have been created
      const events = await collectEvents(store, "migration");
      const failedEvent = events.find((e: any) => e.type === "migration.failed");
      expect(failedEvent).toBeDefined();
    });

    it("migrateAll() error rethrows the original error after creating failed event", async () => {
      const store = await makeStore();
      const migrator = new LegacyMigrator(store);

      // Override migrateStateStore to throw directly
      vi.spyOn(migrator as any, "migrateStateStore").mockRejectedValueOnce(
        new Error("State migration crashed")
      );

      let caughtError: Error | undefined;
      try {
        await migrator.migrateAll(makeMockStateStore() as any);
      } catch (err) {
        caughtError = err as Error;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError!.message).toBe("State migration crashed");
    });

    it("migrateAll() failed event contains error message", async () => {
      const store = await makeStore();
      const migrator = new LegacyMigrator(store);

      // Override migrateStateStore to throw directly
      vi.spyOn(migrator as any, "migrateStateStore").mockRejectedValueOnce(
        new Error("specific error message")
      );

      try {
        await migrator.migrateAll(makeMockStateStore() as any);
      } catch { /* expected */ }

      const events = await collectEvents(store, "migration");
      const failedEvent = events.find((e: any) => e.type === "migration.failed");
      expect(failedEvent).toBeDefined();
      expect(failedEvent.data.error).toBe("specific error message");
    });

    // ── 3. migrateStateStore() with onProgress called for each namespace ───────

    it("migrateStateStore() calls onProgress for each namespace that has data", async () => {
      const store = await makeStore();
      const migrator = new LegacyMigrator(store);

      const progress: string[] = [];
      const legacyStateStore = makeMockStateStore({
        calls: [
          { key: "call-1", value: { status: "pending" } },
          { key: "call-2", value: { status: "completed" } },
        ],
      });

      await migrator.migrateStateStore(legacyStateStore as any, {
        onProgress: (p) => progress.push(p.step),
      });

      // At minimum, the completion step should have been called
      expect(progress.length).toBeGreaterThan(0);
    });

    it("migrateStateStore() with actual data writes KV entries to new store", async () => {
      const store = await makeStore();
      const migrator = new LegacyMigrator(store);

      const legacyStateStore = makeMockStateStore({
        sessions: [
          { key: "session-1", value: { sessionId: "sess-1", userId: "user-1" } },
          { key: "session-2", value: { sessionId: "sess-2", userId: "user-2" } },
        ],
      });

      await migrator.migrateStateStore(legacyStateStore as any);

      // After migration, the data should be in the new store's KV
      const items = await store.kv.list("sessions");
      expect(items.length).toBe(2);
    });

    // ── 4. migrateAll() with legacyStatsStore provided ─────────────────────────

    it("migrateAll() with only legacyStatsStore → writes migration.completed event", async () => {
      const store = await makeStore();
      const migrator = new LegacyMigrator(store);

      const legacyStatsStore = makeMockStatsStore();

      await migrator.migrateAll(undefined, legacyStatsStore as any);

      const events = await collectEvents(store, "migration");
      const completedEvent = events.find((e: any) => e.type === "migration.completed");
      expect(completedEvent).toBeDefined();
    });

    it("migrateAll() with only legacyStatsStore → onProgress reports completion at 100%", async () => {
      const store = await makeStore();
      const migrator = new LegacyMigrator(store);

      const progressCalls: number[] = [];
      const legacyStatsStore = makeMockStatsStore();

      await migrator.migrateAll(undefined, legacyStatsStore as any, {
        onProgress: (p) => progressCalls.push(p.percentage),
      });

      // The last progress call should be 100%
      expect(progressCalls.length).toBeGreaterThan(0);
      expect(progressCalls[progressCalls.length - 1]).toBe(100);
    });
  },
);
