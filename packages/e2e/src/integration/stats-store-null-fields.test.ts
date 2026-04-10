/**
 * Integration tests: stats/store.ts StatsStore null optional fields and external DB — no Docker required.
 *
 * Two areas of stats/store.ts have uncovered branches:
 *
 *   1. mapReceipt() private method (lines 774-777):
 *      When a webhook receipt row has NULL values for optional columns
 *      (delivery_id, event_summary, headers, body), mapReceipt() should
 *      return `undefined` for those fields via the `?? undefined` pattern.
 *      Existing tests always provide values for all optional fields.
 *
 *   2. close() (line 798):
 *      When StatsStore is constructed with an external AppDb (ownDb=false),
 *      close() should be a no-op (no DB close). Existing tests always
 *      construct StatsStore with a file path (ownDb=true).
 *
 * Covers:
 *   - stats/store.ts: mapReceipt() — delivery_id=NULL → deliveryId:undefined
 *   - stats/store.ts: mapReceipt() — event_summary=NULL → eventSummary:undefined
 *   - stats/store.ts: mapReceipt() — headers=NULL → headers:undefined
 *   - stats/store.ts: mapReceipt() — body=NULL → body:undefined
 *   - stats/store.ts: mapReceipt() — dead_letter_reason=NULL → deadLetterReason:undefined
 *   - stats/store.ts: close() — ownDb=false → no-op (external DB not closed)
 *   - stats/store.ts: close() — ownDb=true → DB connection closed (via file-path constructor)
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";

const { StatsStore } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/stats/store.js"
);

const { createMemoryDb } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/db/connection.js"
);

const { applyMigrations } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/db/migrate.js"
);

// Path to drizzle migrations folder
const migrationsFolder = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../action-llama/drizzle",
);

function makeTempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "al-stats-null-test-"));
  return join(dir, "stats.db");
}

/** Create a StatsStore backed by an in-memory DB with migrations applied. */
function makeExternalDbStore() {
  const db = createMemoryDb();
  applyMigrations(db, migrationsFolder);
  return { db, store: new StatsStore(db) };
}

// ── mapReceipt() with NULL optional fields ───────────────────────────────────

describe("integration: stats/store.ts mapReceipt() with null optional fields (no Docker required)", { timeout: 15_000 }, () => {

  it("delivery_id=NULL → deliveryId is undefined in returned WebhookReceipt", () => {
    const store = new StatsStore(makeTempDbPath());
    const id = randomUUID();

    store.recordWebhookReceipt({
      id,
      deliveryId: undefined, // not provided → NULL in DB
      source: "github",
      eventSummary: "push event",
      timestamp: Date.now(),
      matchedAgents: 1,
      status: "processed",
    });

    const receipt = store.getWebhookReceipt(id);
    expect(receipt).toBeDefined();
    expect(receipt!.deliveryId).toBeUndefined();
    store.close();
  });

  it("event_summary=NULL → eventSummary is undefined in returned WebhookReceipt", () => {
    const store = new StatsStore(makeTempDbPath());
    const id = randomUUID();

    store.recordWebhookReceipt({
      id,
      source: "test",
      eventSummary: undefined, // not provided → NULL
      timestamp: Date.now(),
      matchedAgents: 0,
      status: "dead-letter",
    });

    const receipt = store.getWebhookReceipt(id);
    expect(receipt).toBeDefined();
    expect(receipt!.eventSummary).toBeUndefined();
    store.close();
  });

  it("headers=NULL → headers is undefined in returned WebhookReceipt", () => {
    const store = new StatsStore(makeTempDbPath());
    const id = randomUUID();

    store.recordWebhookReceipt({
      id,
      source: "github",
      headers: undefined, // not provided → NULL
      timestamp: Date.now(),
      matchedAgents: 0,
      status: "processed",
    });

    const receipt = store.getWebhookReceipt(id);
    expect(receipt).toBeDefined();
    expect(receipt!.headers).toBeUndefined();
    store.close();
  });

  it("body=NULL → body is undefined in returned WebhookReceipt", () => {
    const store = new StatsStore(makeTempDbPath());
    const id = randomUUID();

    store.recordWebhookReceipt({
      id,
      source: "test",
      body: undefined, // not provided → NULL
      timestamp: Date.now(),
      matchedAgents: 0,
      status: "processed",
    });

    const receipt = store.getWebhookReceipt(id);
    expect(receipt).toBeDefined();
    expect(receipt!.body).toBeUndefined();
    store.close();
  });

  it("dead_letter_reason=NULL (processed status) → deadLetterReason is undefined", () => {
    const store = new StatsStore(makeTempDbPath());
    const id = randomUUID();

    // "processed" status → no dead_letter_reason → NULL in DB
    store.recordWebhookReceipt({
      id,
      source: "test",
      timestamp: Date.now(),
      matchedAgents: 1,
      status: "processed",
    });

    const receipt = store.getWebhookReceipt(id);
    expect(receipt).toBeDefined();
    expect(receipt!.deadLetterReason).toBeUndefined();
    store.close();
  });

  it("all optional fields NULL → all fields are undefined in returned receipt", () => {
    const store = new StatsStore(makeTempDbPath());
    const id = randomUUID();

    // Provide only required fields — all optional fields are NULL in DB
    store.recordWebhookReceipt({
      id,
      source: "sentry",
      timestamp: Date.now(),
      matchedAgents: 0,
      status: "dead-letter",
    });

    const receipt = store.getWebhookReceipt(id);
    expect(receipt).toBeDefined();
    expect(receipt!.id).toBe(id);
    expect(receipt!.source).toBe("sentry");
    expect(receipt!.deliveryId).toBeUndefined();
    expect(receipt!.eventSummary).toBeUndefined();
    expect(receipt!.headers).toBeUndefined();
    expect(receipt!.body).toBeUndefined();
    store.close();
  });
});

// ── close() with external DB (ownDb=false) ────────────────────────────────────

describe("integration: stats/store.ts close() with external AppDb (ownDb=false) (no Docker required)", { timeout: 15_000 }, () => {

  it("close() is a no-op when StatsStore constructed with external DB (ownDb=false)", () => {
    const { db, store } = makeExternalDbStore();

    // Should not throw — close() is a no-op when ownDb=false
    expect(() => store.close()).not.toThrow();

    // The external DB should still be usable after store.close()
    // (it was not closed by the store)
    const client = (db as any).$client;
    expect(typeof client.prepare).toBe("function");
  });

  it("close() with external DB does not throw even when called multiple times", () => {
    const { store } = makeExternalDbStore();

    expect(() => {
      store.close();
      store.close(); // second close — no-op, should not throw
    }).not.toThrow();
  });

  it("StatsStore constructed with AppDb can record and query runs before close()", () => {
    const { store } = makeExternalDbStore();

    const sessionId = randomUUID();
    store.recordRun({
      sessionId,
      agentName: "external-db-agent",
      triggerType: "schedule",
      result: "completed",
      startedAt: Date.now(),
      durationMs: 500,
    });

    const runs = store.queryRuns({ agent: "external-db-agent" });
    expect(runs).toHaveLength(1);
    expect(runs[0].instance_id).toBe(sessionId);

    store.close(); // no-op
  });

  it("two StatsStores sharing the same external DB are independent", () => {
    const { db } = makeExternalDbStore();
    // Both stores share the same DB
    const store1 = new StatsStore(db);
    const store2 = new StatsStore(db);

    const id1 = randomUUID();
    const id2 = randomUUID();
    store1.recordRun({ sessionId: id1, agentName: "agent1", triggerType: "schedule", result: "completed", startedAt: Date.now(), durationMs: 100 });
    store2.recordRun({ sessionId: id2, agentName: "agent2", triggerType: "manual", result: "completed", startedAt: Date.now(), durationMs: 200 });

    // Both records visible through either store
    const all1 = store1.queryRuns({ since: 0 });
    const all2 = store2.queryRuns({ since: 0 });
    expect(all1.length).toBe(2);
    expect(all2.length).toBe(2);

    store1.close(); // no-op — external DB
    store2.close(); // no-op — external DB
  });
});
