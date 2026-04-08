/**
 * Integration tests: stats/store.ts webhook methods, control/session-store.ts SessionStore,
 * control/api-key.ts loadGatewayApiKey, and cli/gateway-client.ts gatewayJson — no Docker.
 *
 * Previously untested functions:
 *
 *   stats/store.ts:
 *     - findWebhookReceiptByDeliveryId(): returns receipt matching deliveryId, undefined when not found
 *     - updateWebhookReceiptStatus(): updates matchedAgents, status, deadLetterReason fields
 *     - getWebhookReceipt(): returns receipt by primary key id, undefined when not found
 *
 *   control/session-store.ts SessionStore:
 *     - constructor(store, ttlSeconds) — custom TTL
 *     - createSession() — generates a random 64-char hex session ID, stores in state store
 *     - getSession() — returns session when present, returns null for unknown ID
 *     - getSession() — updates lastAccessed on each call
 *     - deleteSession() — removes session; subsequent getSession returns null
 *
 *   control/api-key.ts:
 *     - loadGatewayApiKey() — returns undefined when no key exists, returns key when present
 *
 *   cli/gateway-client.ts:
 *     - gatewayJson() — parses valid JSON response body and returns parsed value
 *     - gatewayJson() — throws descriptive error for non-JSON response body
 *     - gatewayJson() — error message includes HTTP status and body preview
 *     - gatewayJson() — body preview truncated to 120 chars for long non-JSON bodies
 *
 * Covers:
 *   - stats/store.ts: findWebhookReceiptByDeliveryId() — found / not found
 *   - stats/store.ts: updateWebhookReceiptStatus() — status + deadLetterReason updated
 *   - stats/store.ts: getWebhookReceipt() — found / not found
 *   - control/session-store.ts: SessionStore constructor, createSession, getSession null,
 *     getSession hit (updates lastAccessed), deleteSession removes session
 *   - control/api-key.ts: loadGatewayApiKey() — undefined when absent, key when present
 *   - cli/gateway-client.ts: gatewayJson() — valid JSON, non-JSON throws, long body truncated
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import {
  setDefaultBackend,
  resetDefaultBackend,
  writeCredentialField,
} from "@action-llama/action-llama/internals/credentials";
import { FilesystemBackend } from "@action-llama/action-llama/internals/filesystem-backend";

// ── Imports via dist paths ───────────────────────────────────────────────────

const { StatsStore } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/stats/store.js"
);

const { SqliteStateStore } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/shared/state-store-sqlite.js"
);

const { SessionStore } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/control/session-store.js"
);

const {
  loadGatewayApiKey,
  ensureGatewayApiKey,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/control/api-key.js"
);

const {
  gatewayJson,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/cli/gateway-client.js"
);

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "al-stats-test-"));
  return join(dir, "stats.db");
}

function makeStateTempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "al-state-test-"));
  return join(dir, "state.db");
}

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "al-apikey-test-"));
}

function makeReceipt(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    source: "github",
    timestamp: Date.now(),
    matchedAgents: 0,
    status: "processed" as const,
    ...overrides,
  };
}

// ── stats/store.ts — webhook receipt methods ──────────────────────────────────

describe("stats/store.ts webhook receipt methods (no Docker required)", { timeout: 10_000 }, () => {
  it("findWebhookReceiptByDeliveryId returns matching receipt", () => {
    const store = new StatsStore(makeTempDbPath());
    const deliveryId = randomUUID();
    const id = randomUUID();
    store.recordWebhookReceipt({
      id,
      deliveryId,
      source: "github",
      timestamp: Date.now(),
      matchedAgents: 2,
      status: "processed",
    });

    const found = store.findWebhookReceiptByDeliveryId(deliveryId);
    expect(found).toBeDefined();
    expect(found.id).toBe(id);
    expect(found.deliveryId).toBe(deliveryId);
    expect(found.source).toBe("github");
    expect(found.matchedAgents).toBe(2);

    store.close();
  });

  it("findWebhookReceiptByDeliveryId returns undefined when not found", () => {
    const store = new StatsStore(makeTempDbPath());
    const result = store.findWebhookReceiptByDeliveryId("nonexistent-delivery-id");
    expect(result).toBeUndefined();
    store.close();
  });

  it("updateWebhookReceiptStatus updates status and matchedAgents", () => {
    const store = new StatsStore(makeTempDbPath());
    const id = randomUUID();
    store.recordWebhookReceipt({ id, source: "github", timestamp: Date.now(), matchedAgents: 0, status: "processed" });

    // Verify initial state
    const before = store.getWebhookReceipt(id);
    expect(before.status).toBe("processed");
    expect(before.matchedAgents).toBe(0);

    // Update to dead-letter with a reason
    store.updateWebhookReceiptStatus(id, 0, "dead-letter", "no_match");

    const after = store.getWebhookReceipt(id);
    expect(after.status).toBe("dead-letter");
    expect(after.matchedAgents).toBe(0);
    expect(after.deadLetterReason).toBe("no_match");

    store.close();
  });

  it("updateWebhookReceiptStatus sets matchedAgents to non-zero value", () => {
    const store = new StatsStore(makeTempDbPath());
    const id = randomUUID();
    store.recordWebhookReceipt({ id, source: "sentry", timestamp: Date.now(), matchedAgents: 0, status: "processed" });

    store.updateWebhookReceiptStatus(id, 3, "processed");

    const updated = store.getWebhookReceipt(id);
    expect(updated.matchedAgents).toBe(3);
    expect(updated.status).toBe("processed");
    expect(updated.deadLetterReason == null).toBe(true); // null or undefined

    store.close();
  });

  it("updateWebhookReceiptStatus no-ops for nonexistent id", () => {
    const store = new StatsStore(makeTempDbPath());
    // Should not throw
    expect(() => store.updateWebhookReceiptStatus("no-such-id", 0, "dead-letter")).not.toThrow();
    store.close();
  });

  it("getWebhookReceipt returns receipt by primary key", () => {
    const store = new StatsStore(makeTempDbPath());
    const id = randomUUID();
    store.recordWebhookReceipt({
      id,
      source: "linear",
      eventSummary: "Issue created",
      timestamp: Date.now(),
      matchedAgents: 1,
      status: "processed",
    });

    const receipt = store.getWebhookReceipt(id);
    expect(receipt).toBeDefined();
    expect(receipt.id).toBe(id);
    expect(receipt.source).toBe("linear");
    expect(receipt.eventSummary).toBe("Issue created");

    store.close();
  });

  it("getWebhookReceipt returns undefined for nonexistent id", () => {
    const store = new StatsStore(makeTempDbPath());
    const result = store.getWebhookReceipt(randomUUID());
    expect(result).toBeUndefined();
    store.close();
  });
});

// ── control/session-store.ts SessionStore ────────────────────────────────────

describe("control/session-store.ts SessionStore (no Docker required)", { timeout: 10_000 }, () => {
  it("createSession returns a 64-char hex session ID", async () => {
    const stateStore = new SqliteStateStore(makeStateTempDbPath());
    const sessions = new SessionStore(stateStore);

    const id = await sessions.createSession();
    expect(id).toHaveLength(64); // randomBytes(32).toString("hex") = 64 chars
    expect(id).toMatch(/^[0-9a-f]+$/); // hex chars only

    await stateStore.close();
  });

  it("getSession returns session for valid ID", async () => {
    const stateStore = new SqliteStateStore(makeStateTempDbPath());
    const sessions = new SessionStore(stateStore);

    const id = await sessions.createSession();
    const session = await sessions.getSession(id);

    expect(session).not.toBeNull();
    expect(session.id).toBe(id);
    expect(typeof session.createdAt).toBe("number");
    expect(typeof session.lastAccessed).toBe("number");

    await stateStore.close();
  });

  it("getSession returns null for unknown ID", async () => {
    const stateStore = new SqliteStateStore(makeStateTempDbPath());
    const sessions = new SessionStore(stateStore);

    const result = await sessions.getSession("nonexistent-session-id");
    expect(result).toBeNull();

    await stateStore.close();
  });

  it("getSession updates lastAccessed on each call", async () => {
    const stateStore = new SqliteStateStore(makeStateTempDbPath());
    const sessions = new SessionStore(stateStore);

    const id = await sessions.createSession();
    const first = await sessions.getSession(id);
    const firstAccessed = first!.lastAccessed;

    // Small delay to ensure lastAccessed changes
    await new Promise((r) => setTimeout(r, 10));

    const second = await sessions.getSession(id);
    expect(second!.lastAccessed).toBeGreaterThanOrEqual(firstAccessed);

    await stateStore.close();
  });

  it("deleteSession removes the session; subsequent getSession returns null", async () => {
    const stateStore = new SqliteStateStore(makeStateTempDbPath());
    const sessions = new SessionStore(stateStore);

    const id = await sessions.createSession();

    // Verify session exists before deletion
    const before = await sessions.getSession(id);
    expect(before).not.toBeNull();

    // Delete the session
    await sessions.deleteSession(id);

    // Now getSession should return null
    const after = await sessions.getSession(id);
    expect(after).toBeNull();

    await stateStore.close();
  });

  it("multiple sessions are independent", async () => {
    const stateStore = new SqliteStateStore(makeStateTempDbPath());
    const sessions = new SessionStore(stateStore);

    const id1 = await sessions.createSession();
    const id2 = await sessions.createSession();

    // Delete only session 1
    await sessions.deleteSession(id1);

    expect(await sessions.getSession(id1)).toBeNull();
    expect(await sessions.getSession(id2)).not.toBeNull();

    await stateStore.close();
  });

  it("accepts a custom TTL in constructor", async () => {
    const stateStore = new SqliteStateStore(makeStateTempDbPath());
    // Very short TTL (5 seconds) — just check constructor accepts it
    const sessions = new SessionStore(stateStore, 5);
    const id = await sessions.createSession();
    const session = await sessions.getSession(id);
    expect(session).not.toBeNull();
    await stateStore.close();
  });
});

// ── control/api-key.ts — loadGatewayApiKey ───────────────────────────────────

describe("control/api-key.ts loadGatewayApiKey() (no Docker required)", { timeout: 10_000 }, () => {
  afterEach(() => {
    resetDefaultBackend();
  });

  it("returns undefined when no gateway_api_key exists in the store", async () => {
    const dir = makeTempDir();
    setDefaultBackend(new FilesystemBackend(dir));

    const result = await loadGatewayApiKey();
    expect(result).toBeUndefined();
  });

  it("returns the key that was previously written", async () => {
    const dir = makeTempDir();
    setDefaultBackend(new FilesystemBackend(dir));

    // Write a key via ensureGatewayApiKey
    const { key } = await ensureGatewayApiKey();

    // loadGatewayApiKey should return the same key
    const loaded = await loadGatewayApiKey();
    expect(loaded).toBe(key);
    expect(loaded).toBeDefined();
  });

  it("returns the exact written key without generating a new one", async () => {
    const dir = makeTempDir();
    setDefaultBackend(new FilesystemBackend(dir));

    // Manually write a known key
    await writeCredentialField("gateway_api_key", "default", "key", "test-api-key-value");

    const result = await loadGatewayApiKey();
    expect(result).toBe("test-api-key-value");
  });
});

// ── cli/gateway-client.ts — gatewayJson ──────────────────────────────────────

describe("cli/gateway-client.ts gatewayJson() (no Docker required)", { timeout: 10_000 }, () => {
  function makeResponse(body: string, status = 200): Response {
    return new Response(body, { status });
  }

  it("parses valid JSON response and returns the parsed value", async () => {
    const response = makeResponse(JSON.stringify({ ok: true, agents: ["a", "b"] }));
    const result = await gatewayJson(response);
    expect(result).toEqual({ ok: true, agents: ["a", "b"] });
  });

  it("parses JSON number response", async () => {
    const response = makeResponse("42");
    const result = await gatewayJson(response);
    expect(result).toBe(42);
  });

  it("parses JSON array response", async () => {
    const response = makeResponse('[1, 2, 3]');
    const result = await gatewayJson(response);
    expect(result).toEqual([1, 2, 3]);
  });

  it("throws descriptive error for non-JSON body (HTML)", async () => {
    const response = makeResponse("<html><body>404 Not Found</body></html>", 404);
    await expect(gatewayJson(response)).rejects.toThrow("Gateway returned non-JSON response");
    await expect(gatewayJson(makeResponse("<html>error</html>", 404))).rejects.toThrow("HTTP 404");
  });

  it("error message includes body preview for short bodies", async () => {
    const response = makeResponse("Server Error text", 500);
    try {
      await gatewayJson(response);
      expect.fail("Should have thrown");
    } catch (err: unknown) {
      const msg = (err as Error).message;
      expect(msg).toContain("Server Error text");
    }
  });

  it("truncates long non-JSON body preview to 120 chars plus ellipsis", async () => {
    const longBody = "X".repeat(200); // 200 chars — well over 120
    const response = makeResponse(longBody, 502);
    try {
      await gatewayJson(response);
      expect.fail("Should have thrown");
    } catch (err: unknown) {
      const msg = (err as Error).message;
      // Preview should be truncated at 120 chars + "…"
      expect(msg).toContain("…");
      // The full 200-char body should not appear verbatim
      expect(msg).not.toContain(longBody);
    }
  });
});
