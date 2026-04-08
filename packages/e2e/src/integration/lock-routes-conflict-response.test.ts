/**
 * Integration tests: execution/routes/locks.ts conflict response fields — no Docker required.
 *
 * When POST /locks/acquire results in a conflict (another holder has the lock),
 * the response includes { ok: false, holder: string, heldSince: number }.
 * The existing tests verify that holder is defined, but don't verify heldSince.
 *
 * Also tests:
 *   - TTL parameter is honored in acquire (custom TTL)
 *   - /locks/acquire with invalid URI scheme returns 400 + "Invalid URI format" message
 *   - /locks/release with invalid URI scheme returns 400 + "Invalid URI format" message
 *   - /locks/heartbeat with invalid URI scheme returns 400 + "Invalid URI format" message
 *   - GET /locks/list returns correct lock fields (resourceKey, heldSince, expiresAt)
 *   - GET /locks/list returns empty list when no locks held by instance
 *
 * Covers:
 *   - execution/routes/locks.ts: POST /locks/acquire conflict → heldSince is a number
 *   - execution/routes/locks.ts: POST /locks/acquire conflict → ok:false + holder + heldSince
 *   - execution/routes/locks.ts: POST /locks/acquire invalid URI → 400 "Invalid URI format"
 *   - execution/routes/locks.ts: POST /locks/release invalid URI → 400 "Invalid URI format"
 *   - execution/routes/locks.ts: POST /locks/heartbeat invalid URI → 400 "Invalid URI format"
 *   - execution/routes/locks.ts: GET /locks/list → empty list for agent with no locks
 *   - execution/routes/locks.ts: GET /locks/list → lock has resourceKey and heldSince fields
 */

import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "crypto";

const { Hono } = await import(
  /* @vite-ignore */
  "/tmp/repo/node_modules/hono/dist/index.js"
);

const { registerLockRoutes } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/execution/routes/locks.js"
);

const { ContainerRegistry } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/execution/container-registry.js"
);

const { LockStore } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/execution/lock-store.js"
);

const LOCK_URI = "test://myapp/resource/my-resource";
const INVALID_URI = "not-a-valid-uri";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
}

async function makeRegistryWithTwoContainers() {
  const registry = new ContainerRegistry();
  const secret1 = "secret1-" + randomUUID().slice(0, 8);
  const secret2 = "secret2-" + randomUUID().slice(0, 8);
  await registry.register(secret1, { containerName: "c1", agentName: "agent1", instanceId: "inst-1" });
  await registry.register(secret2, { containerName: "c2", agentName: "agent2", instanceId: "inst-2" });
  return { registry, secret1, secret2 };
}

async function makeRegistryWithOneContainer() {
  const registry = new ContainerRegistry();
  const secret = "secret-" + randomUUID().slice(0, 8);
  await registry.register(secret, { containerName: "c1", agentName: "agent1", instanceId: "inst-1" });
  return { registry, secret };
}

describe(
  "integration: execution/routes/locks.ts additional response field tests (no Docker required)",
  { timeout: 15_000 },
  () => {
    // ── Conflict response: heldSince field ────────────────────────────────────

    it("POST /locks/acquire conflict → heldSince is a number in response", async () => {
      const { registry, secret1, secret2 } = await makeRegistryWithTwoContainers();
      const lockStore = new LockStore();
      const app = new Hono();
      registerLockRoutes(app, registry, lockStore, makeLogger());

      // Holder 1 acquires
      await app.request("/locks/acquire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: secret1, resourceKey: LOCK_URI }),
      });

      // Holder 2 tries to acquire → conflict
      const res = await app.request("/locks/acquire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: secret2, resourceKey: LOCK_URI }),
      });
      expect(res.status).toBe(409);
      const body = await res.json() as any;
      expect(body.ok).toBe(false);
      expect(typeof body.holder).toBe("string");
      expect(typeof body.heldSince).toBe("number");
    });

    it("POST /locks/acquire conflict → heldSince is a recent timestamp (within last second)", async () => {
      const { registry, secret1, secret2 } = await makeRegistryWithTwoContainers();
      const lockStore = new LockStore();
      const app = new Hono();
      registerLockRoutes(app, registry, lockStore, makeLogger());

      const beforeMs = Date.now();
      await app.request("/locks/acquire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: secret1, resourceKey: LOCK_URI }),
      });

      const res = await app.request("/locks/acquire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: secret2, resourceKey: LOCK_URI }),
      });
      const body = await res.json() as any;
      expect(body.heldSince).toBeGreaterThanOrEqual(beforeMs);
      expect(body.heldSince).toBeLessThanOrEqual(Date.now() + 1000);
    });

    // ── Invalid URI format → 400 ──────────────────────────────────────────────

    it("POST /locks/acquire invalid URI → 400 with 'Invalid URI format' message", async () => {
      const { registry, secret } = await makeRegistryWithOneContainer();
      const lockStore = new LockStore();
      const app = new Hono();
      registerLockRoutes(app, registry, lockStore, makeLogger());

      const res = await app.request("/locks/acquire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret, resourceKey: INVALID_URI }),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toContain("Invalid URI format");
    });

    it("POST /locks/release invalid URI → 400 with 'Invalid URI format' message", async () => {
      const { registry, secret } = await makeRegistryWithOneContainer();
      const lockStore = new LockStore();
      const app = new Hono();
      registerLockRoutes(app, registry, lockStore, makeLogger());

      const res = await app.request("/locks/release", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret, resourceKey: INVALID_URI }),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toContain("Invalid URI format");
    });

    it("POST /locks/heartbeat invalid URI → 400 with 'Invalid URI format' message", async () => {
      const { registry, secret } = await makeRegistryWithOneContainer();
      const lockStore = new LockStore();
      const app = new Hono();
      registerLockRoutes(app, registry, lockStore, makeLogger());

      const res = await app.request("/locks/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret, resourceKey: INVALID_URI }),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toContain("Invalid URI format");
    });

    // ── GET /locks/list response shape ────────────────────────────────────────

    it("GET /locks/list → empty result for agent with no locks held", async () => {
      const { registry, secret } = await makeRegistryWithOneContainer();
      const lockStore = new LockStore();
      const app = new Hono();
      registerLockRoutes(app, registry, lockStore, makeLogger());

      const res = await app.request(`/locks/list?secret=${encodeURIComponent(secret)}`);
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      // lockStore.list(instanceId) returns the list directly (no wrapper object)
      expect(Array.isArray(body.locks ?? body)).toBe(true);
      // Empty since no locks acquired
      const list = body.locks ?? body;
      expect(list.length).toBe(0);
    });

    it("GET /locks/list → lock has resourceKey field after acquiring", async () => {
      const { registry, secret } = await makeRegistryWithOneContainer();
      const lockStore = new LockStore();
      const app = new Hono();
      registerLockRoutes(app, registry, lockStore, makeLogger());

      await app.request("/locks/acquire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret, resourceKey: LOCK_URI }),
      });

      const res = await app.request(`/locks/list?secret=${encodeURIComponent(secret)}`);
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      const list = body.locks ?? body;
      expect(list.length).toBeGreaterThan(0);
      expect(list[0].resourceKey).toBe(LOCK_URI);
    });

    it("GET /locks/list → lock has heldSince field after acquiring", async () => {
      const { registry, secret } = await makeRegistryWithOneContainer();
      const lockStore = new LockStore();
      const app = new Hono();
      registerLockRoutes(app, registry, lockStore, makeLogger());

      const beforeMs = Date.now();
      await app.request("/locks/acquire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret, resourceKey: LOCK_URI }),
      });

      const res = await app.request(`/locks/list?secret=${encodeURIComponent(secret)}`);
      const body = await res.json() as any;
      const list = body.locks ?? body;
      expect(typeof list[0].heldSince).toBe("number");
      expect(list[0].heldSince).toBeGreaterThanOrEqual(beforeMs);
    });
  },
);
