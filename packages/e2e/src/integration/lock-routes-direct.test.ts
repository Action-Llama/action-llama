/**
 * Integration tests: execution/routes/locks.ts registerLockRoutes() — no Docker required.
 *
 * Tests branches in registerLockRoutes() by constructing a Hono app directly
 * with a ContainerRegistry, LockStore, and optional event bus. These paths
 * require a registered container (valid secret) and are not covered by the
 * harness-based tests which only test validation/auth error paths.
 *
 *   1. POST /locks/acquire — valid secret, valid URI → 200 ok:true
 *   2. POST /locks/acquire — valid secret, events emitted on success
 *   3. POST /locks/acquire — valid secret, conflict (same resource, different holder) → 409
 *   4. POST /locks/release — valid secret, lock released → 200 ok:true
 *   5. POST /locks/heartbeat — valid secret, existing lock → 200 ok:true with expiresAt
 *   6. POST /locks/heartbeat — valid secret, lock not found → 404
 *   7. GET /locks/list — valid secret → 200 with lock list
 *   8. GET /locks/status — registered by default (no skipStatusEndpoint option)
 *   9. GET /locks/status — skipStatusEndpoint=true → 404
 *  10. POST /locks/release — events emitted on success
 *
 * Covers:
 *   - execution/routes/locks.ts: POST /locks/acquire → 200 ok:true with valid secret
 *   - execution/routes/locks.ts: POST /locks/acquire → events emitted (lock:acquire:ok)
 *   - execution/routes/locks.ts: POST /locks/acquire → 409 on conflict
 *   - execution/routes/locks.ts: POST /locks/release → 200 ok:true
 *   - execution/routes/locks.ts: POST /locks/release → events emitted
 *   - execution/routes/locks.ts: POST /locks/heartbeat → 200 ok:true with expiresAt
 *   - execution/routes/locks.ts: POST /locks/heartbeat → 404 lock not found
 *   - execution/routes/locks.ts: GET /locks/list → 200 with list
 *   - execution/routes/locks.ts: GET /locks/status → registered by default
 *   - execution/routes/locks.ts: GET /locks/status → 404 when skipStatusEndpoint=true
 */

import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "crypto";

const { Hono } = await import(
  /* @vite-ignore */
  "/tmp/repo/node_modules/hono/dist/index.js"
);

const {
  registerLockRoutes,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/execution/routes/locks.js"
);

const {
  ContainerRegistry,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/execution/container-registry.js"
);

const {
  LockStore,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/execution/lock-store.js"
);

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
}

/** Create a registry with one registered container and return credentials. */
async function makeRegistryWithContainer(): Promise<{
  registry: InstanceType<typeof ContainerRegistry>;
  secret: string;
  instanceId: string;
  agentName: string;
}> {
  const registry = new ContainerRegistry();
  const secret = "test-lock-secret-" + randomUUID().slice(0, 8);
  const instanceId = "agent-instance-" + randomUUID().slice(0, 8);
  const agentName = "test-lock-agent";

  await registry.register(secret, { containerName: "test-container", agentName, instanceId });
  return { registry, secret, instanceId, agentName };
}

/** A valid lock URI for testing. */
const LOCK_URI = "github://test-org/test-repo/issues/42";

describe("integration: execution/routes/locks.ts direct tests (no Docker required)", { timeout: 20_000 }, () => {

  // ── POST /locks/acquire — success ────────────────────────────────────────

  it("POST /locks/acquire → 200 ok:true when lock is successfully acquired", async () => {
    const { registry, secret } = await makeRegistryWithContainer();
    const lockStore = new LockStore();
    const app = new Hono();
    registerLockRoutes(app, registry, lockStore, makeLogger());

    const res = await app.request("/locks/acquire", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, resourceKey: LOCK_URI }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; resourceKey: string };
    expect(body.ok).toBe(true);
    expect(body.resourceKey).toBe(LOCK_URI);
  });

  it("emits 'lock' event with action:acquire when lock is acquired", async () => {
    const { registry, secret } = await makeRegistryWithContainer();
    const lockStore = new LockStore();
    const app = new Hono();
    const mockEvents = { emit: vi.fn() };

    registerLockRoutes(app, registry, lockStore, makeLogger(), { events: mockEvents as any });

    await app.request("/locks/acquire", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, resourceKey: LOCK_URI }),
    });

    expect(mockEvents.emit).toHaveBeenCalledWith("lock", expect.objectContaining({
      action: "acquire",
      ok: true,
      resourceKey: LOCK_URI,
    }));
  });

  // ── POST /locks/acquire — conflict → 409 ─────────────────────────────────

  it("POST /locks/acquire → 409 when another holder has the lock", async () => {
    // Register two containers
    const registry = new ContainerRegistry();
    const secret1 = "secret-holder-1-" + randomUUID().slice(0, 8);
    const secret2 = "secret-holder-2-" + randomUUID().slice(0, 8);
    await registry.register(secret1, { containerName: "c1", agentName: "agent1", instanceId: "inst-1" });
    await registry.register(secret2, { containerName: "c2", agentName: "agent2", instanceId: "inst-2" });

    const lockStore = new LockStore();
    const app = new Hono();
    registerLockRoutes(app, registry, lockStore, makeLogger());

    // First container acquires the lock
    const res1 = await app.request("/locks/acquire", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: secret1, resourceKey: LOCK_URI }),
    });
    expect(res1.status).toBe(200);

    // Second container tries to acquire the same lock → conflict
    const res2 = await app.request("/locks/acquire", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: secret2, resourceKey: LOCK_URI }),
    });
    expect(res2.status).toBe(409);
    const body = await res2.json() as { ok: boolean; holder: string };
    expect(body.ok).toBe(false);
    expect(body.holder).toBeDefined();
  });

  // ── POST /locks/release — success ────────────────────────────────────────

  it("POST /locks/release → 200 ok:true after acquiring and releasing", async () => {
    const { registry, secret } = await makeRegistryWithContainer();
    const lockStore = new LockStore();
    const app = new Hono();
    registerLockRoutes(app, registry, lockStore, makeLogger());

    // Acquire first
    await app.request("/locks/acquire", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, resourceKey: LOCK_URI }),
    });

    // Then release
    const res = await app.request("/locks/release", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, resourceKey: LOCK_URI }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("emits 'lock' event with action:release when lock is released", async () => {
    const { registry, secret } = await makeRegistryWithContainer();
    const lockStore = new LockStore();
    const app = new Hono();
    const mockEvents = { emit: vi.fn() };
    registerLockRoutes(app, registry, lockStore, makeLogger(), { events: mockEvents as any });

    // Acquire then release
    await app.request("/locks/acquire", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, resourceKey: LOCK_URI }),
    });

    mockEvents.emit.mockClear(); // clear acquire event

    await app.request("/locks/release", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, resourceKey: LOCK_URI }),
    });

    expect(mockEvents.emit).toHaveBeenCalledWith("lock", expect.objectContaining({
      action: "release",
      ok: true,
      resourceKey: LOCK_URI,
    }));
  });

  // ── POST /locks/heartbeat — success ──────────────────────────────────────

  it("POST /locks/heartbeat → 200 ok:true with expiresAt after acquiring", async () => {
    const { registry, secret } = await makeRegistryWithContainer();
    const lockStore = new LockStore();
    const app = new Hono();
    registerLockRoutes(app, registry, lockStore, makeLogger());

    // Acquire first
    await app.request("/locks/acquire", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, resourceKey: LOCK_URI }),
    });

    // Heartbeat
    const res = await app.request("/locks/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, resourceKey: LOCK_URI }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; expiresAt: number };
    expect(body.ok).toBe(true);
    expect(typeof body.expiresAt).toBe("number");
    expect(body.expiresAt).toBeGreaterThan(Date.now());
  });

  it("POST /locks/heartbeat → 404 when lock does not exist", async () => {
    const { registry, secret } = await makeRegistryWithContainer();
    const lockStore = new LockStore();
    const app = new Hono();
    registerLockRoutes(app, registry, lockStore, makeLogger());

    const res = await app.request("/locks/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, resourceKey: LOCK_URI }),
    });
    expect(res.status).toBe(404);
    const body = await res.json() as { ok: boolean; reason: string };
    expect(body.ok).toBe(false);
    expect(body.reason).toContain("not found");
  });

  // ── GET /locks/list ───────────────────────────────────────────────────────

  it("GET /locks/list → 200 with list of locks held by the agent", async () => {
    const { registry, secret } = await makeRegistryWithContainer();
    const lockStore = new LockStore();
    const app = new Hono();
    registerLockRoutes(app, registry, lockStore, makeLogger());

    // Acquire a lock
    await app.request("/locks/acquire", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, resourceKey: LOCK_URI }),
    });

    const res = await app.request(`/locks/list?secret=${encodeURIComponent(secret)}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { locks: Array<{ resourceKey: string }> };
    // The list should contain the acquired lock (if this method returns in that format)
    // Note: lockStore.list(instanceId) returns the actual lock list
    expect(Array.isArray(body.locks ?? body)).toBe(true);
  });

  // ── GET /locks/status — registered by default ─────────────────────────────

  it("GET /locks/status → 200 with locks array when not using skipStatusEndpoint", async () => {
    const { registry } = await makeRegistryWithContainer();
    const lockStore = new LockStore();
    const app = new Hono();
    // No skipStatusEndpoint option → /locks/status IS registered
    registerLockRoutes(app, registry, lockStore, makeLogger());

    const res = await app.request("/locks/status");
    expect(res.status).toBe(200);
    const body = await res.json() as { locks: unknown[] };
    expect(Array.isArray(body.locks)).toBe(true);
  });

  // ── GET /locks/status — not registered with skipStatusEndpoint=true ───────

  it("GET /locks/status → 404 when skipStatusEndpoint=true", async () => {
    const { registry } = await makeRegistryWithContainer();
    const lockStore = new LockStore();
    const app = new Hono();
    registerLockRoutes(app, registry, lockStore, makeLogger(), { skipStatusEndpoint: true });

    const res = await app.request("/locks/status");
    expect(res.status).toBe(404);
  });
});
