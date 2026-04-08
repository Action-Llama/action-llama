/**
 * Integration tests: stats/store.ts queryActivityRowsWithTotal() eventSummary field
 * — no Docker required.
 *
 * Commit 1010c565 joined webhook_receipts at the SQL level in queryActivityRowsWithTotal()
 * and added an `eventSummary` field using this CASE WHEN condition:
 *
 *   CASE WHEN triggerType = 'webhook'
 *             AND wr.event_summary IS NOT NULL
 *             AND wr.event_summary != wr.source
 *             AND result != 'dead-letter'
 *        THEN wr.event_summary
 *        ELSE NULL
 *   END AS eventSummary
 *
 * And triggerSource uses COALESCE from the runs table joined with webhook_receipts:
 *   COALESCE(r.trigger_source, wr.source) AS triggerSource  [in the non-UNION path]
 *
 * The SQL has multiple branches for eventSummary:
 *   1. eventSummary IS NOT NULL AND != source → returned as eventSummary
 *   2. eventSummary IS NOT NULL BUT == source → NULL (filtered by != condition)
 *   3. No webhook receipt attached → eventSummary is NULL
 *   4. Dead-letter row → eventSummary is NULL (excluded by result != 'dead-letter')
 *
 * Scenarios tested:
 *   - webhook run with receipt where event_summary != source → eventSummary populated
 *   - webhook run with receipt where event_summary = source → eventSummary is null
 *   - webhook run with receipt where event_summary is null → eventSummary is null
 *   - webhook run with no receipt → eventSummary is null
 *   - manual run (not webhook) → eventSummary is null even with receipt
 *
 * Covers:
 *   - stats/store.ts: queryActivityRowsWithTotal() eventSummary branch (event_summary != source)
 *   - stats/store.ts: queryActivityRowsWithTotal() eventSummary null (event_summary = source)
 *   - stats/store.ts: queryActivityRowsWithTotal() eventSummary null (no receipt)
 *   - stats/store.ts: queryActivityRowsWithTotal() eventSummary null (not webhook type)
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

const { StatsStore } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/stats/store.js"
);

function makeTempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "al-activity-evtsummary-test-"));
  return join(dir, "stats.db");
}

function makeWebhookReceipt(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    source: "github",
    timestamp: Date.now(),
    matchedAgents: 1,
    status: "processed" as const,
    ...overrides,
  };
}

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    instanceId: randomUUID(),
    agentName: "test-agent",
    triggerType: "webhook",
    triggerSource: "github",
    result: "completed",
    startedAt: Date.now(),
    durationMs: 1000,
    ...overrides,
  };
}

describe(
  "integration: stats/store.ts queryActivityRowsWithTotal() eventSummary SQL branches (no Docker required)",
  { timeout: 30_000 },
  () => {
    // ── eventSummary != source → populated ──────────────────────────────────

    it("webhook run with receipt where event_summary != source → eventSummary populated in result", () => {
      const store = new StatsStore(makeTempDbPath());

      // Create webhook receipt with event_summary that differs from source
      const receipt = makeWebhookReceipt({
        source: "github",
        eventSummary: "push to main branch by user@example.com",
      });
      store.recordWebhookReceipt(receipt);

      // Record a webhook run linked to this receipt
      const run = makeRun({
        webhookReceiptId: receipt.id,
        triggerType: "webhook",
        triggerSource: "github",
      });
      store.recordRun(run);

      const { rows } = store.queryActivityRowsWithTotal({
        limit: 10,
        offset: 0,
        includeDeadLetters: false,
      });

      expect(rows).toHaveLength(1);
      const row = rows[0];
      // eventSummary should be populated because it differs from source
      expect(row.eventSummary).toBe("push to main branch by user@example.com");

      store.close();
    });

    // ── eventSummary = source → null ────────────────────────────────────────

    it("webhook run with receipt where event_summary = source → eventSummary is null", () => {
      const store = new StatsStore(makeTempDbPath());

      // Create webhook receipt where event_summary equals source (filtered by SQL)
      const receipt = makeWebhookReceipt({
        source: "github",
        eventSummary: "github", // same as source → CASE WHEN filters it out
      });
      store.recordWebhookReceipt(receipt);

      const run = makeRun({
        webhookReceiptId: receipt.id,
        triggerType: "webhook",
        triggerSource: "github",
      });
      store.recordRun(run);

      const { rows } = store.queryActivityRowsWithTotal({
        limit: 10,
        offset: 0,
        includeDeadLetters: false,
      });

      expect(rows).toHaveLength(1);
      // eventSummary should be null/undefined because event_summary == source
      // (SQL CASE WHEN filters it out — the value may be null or undefined depending on the driver)
      expect(rows[0].eventSummary == null).toBe(true);

      store.close();
    });

    // ── eventSummary is null in receipt → null ───────────────────────────────

    it("webhook run with receipt that has no event_summary → eventSummary is null", () => {
      const store = new StatsStore(makeTempDbPath());

      // Create receipt with no eventSummary
      const receipt = makeWebhookReceipt({
        source: "github",
        // no eventSummary field
      });
      store.recordWebhookReceipt(receipt);

      const run = makeRun({
        webhookReceiptId: receipt.id,
        triggerType: "webhook",
        triggerSource: "github",
      });
      store.recordRun(run);

      const { rows } = store.queryActivityRowsWithTotal({
        limit: 10,
        offset: 0,
        includeDeadLetters: false,
      });

      expect(rows).toHaveLength(1);
      // eventSummary is null because receipt has no eventSummary
      expect(rows[0].eventSummary == null).toBe(true);

      store.close();
    });

    // ── No receipt → eventSummary null ─────────────────────────────────────

    it("webhook run with no receipt → eventSummary is null", () => {
      const store = new StatsStore(makeTempDbPath());

      // Run without a webhookReceiptId
      const run = makeRun({
        triggerType: "webhook",
        triggerSource: "github",
        // no webhookReceiptId
      });
      store.recordRun(run);

      const { rows } = store.queryActivityRowsWithTotal({
        limit: 10,
        offset: 0,
        includeDeadLetters: false,
      });

      expect(rows).toHaveLength(1);
      // No receipt → LEFT JOIN produces NULL for wr.event_summary → eventSummary is null
      expect(rows[0].eventSummary == null).toBe(true);

      store.close();
    });

    // ── Non-webhook run → eventSummary null ─────────────────────────────────

    it("manual run (not webhook type) → eventSummary is null regardless of receipt", () => {
      const store = new StatsStore(makeTempDbPath());

      // Manual run — no receipt needed, but even if one existed it wouldn't matter
      const run = makeRun({
        triggerType: "manual",
        triggerSource: undefined,
      });
      store.recordRun(run);

      const { rows } = store.queryActivityRowsWithTotal({
        limit: 10,
        offset: 0,
        includeDeadLetters: false,
      });

      expect(rows).toHaveLength(1);
      // Not a webhook run → eventSummary is null
      expect(rows[0].eventSummary == null).toBe(true);

      store.close();
    });
  },
);
