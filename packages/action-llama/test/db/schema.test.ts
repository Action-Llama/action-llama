import { describe, it, expect } from "vitest";
import { createMemoryDb } from "../../src/db/connection.js";
import { applyMigrations } from "../../src/db/migrate.js";
import {
  stateTable,
  runsTable,
  webhookReceiptsTable,
  callEdgesTable,
  workQueueTable,
  queueTable,
  kvStoreTable,
  eventsTable,
  snapshotsTable,
} from "../../src/db/schema.js";

describe("Drizzle schema", () => {
  function createMigratedDb() {
    const db = createMemoryDb();
    applyMigrations(db);
    return db;
  }

  it("creates all 9 tables after migrations", () => {
    const db = createMigratedDb();
    const client = (db as any).$client;
    const tables = client
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations'")
      .all()
      .map((r: any) => r.name)
      .sort();
    expect(tables).toEqual([
      "call_edges",
      "events",
      "kv_store",
      "queue",
      "runs",
      "snapshots",
      "state",
      "webhook_receipts",
      "work_queue",
    ]);
    client.close();
  });

  it("state table has expected columns", () => {
    const db = createMigratedDb();
    const client = (db as any).$client;
    const cols = client.pragma("table_info(state)").map((c: any) => c.name);
    expect(cols).toContain("ns");
    expect(cols).toContain("key");
    expect(cols).toContain("value");
    expect(cols).toContain("expires_at");
    client.close();
  });

  it("runs table has expected columns including webhook_receipt_id", () => {
    const db = createMigratedDb();
    const client = (db as any).$client;
    const cols = client.pragma("table_info(runs)").map((c: any) => c.name);
    expect(cols).toContain("id");
    expect(cols).toContain("instance_id");
    expect(cols).toContain("agent_name");
    expect(cols).toContain("webhook_receipt_id");
    client.close();
  });

  it("kv_store table has expires_at for TTL support", () => {
    const db = createMigratedDb();
    const client = (db as any).$client;
    const cols = client.pragma("table_info(kv_store)").map((c: any) => c.name);
    expect(cols).toContain("expires_at");
    expect(cols).toContain("created_at");
    expect(cols).toContain("updated_at");
    client.close();
  });

  it("work_queue and queue tables are separate", () => {
    const db = createMigratedDb();
    const client = (db as any).$client;
    const wqCols = client.pragma("table_info(work_queue)").map((c: any) => c.name);
    const qCols = client.pragma("table_info(queue)").map((c: any) => c.name);
    expect(wqCols).toContain("agent");
    expect(qCols).toContain("name");
    client.close();
  });
});
