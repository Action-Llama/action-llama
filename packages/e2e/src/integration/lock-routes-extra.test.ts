/**
 * Integration tests: execution/routes/locks.ts — additional uncovered paths — no Docker required.
 *
 * The existing lock-routes-direct.test.ts covers acquire/release/heartbeat success paths and
 * some error paths. This test file covers the remaining branches:
 *
 *   1. POST /locks/acquire — deadlock detected → 409 with ok:false + reason + deadlock:true + cycle
 *   2. POST /locks/acquire — deadlock path logs warning (not debug)
 *   3. POST /locks/release — lock not found → 404 with ok:false + reason
 *   4. POST /locks/release — wrong holder → 409 with ok:false + reason
 *   5. POST /locks/release — events emitted on failure (lock not found)
 *   6. POST /locks/heartbeat — wrong holder → 409 with ok:false + reason
 *   7. POST /locks/heartbeat — events emitted on failure
 *
 * Covers:
 *   - execution/routes/locks.ts: POST /locks/acquire → deadlock path (reason + deadlock:true + cycle)
 *   - execution/routes/locks.ts: POST /locks/acquire → deadlock logs warn (not debug)
 *   - execution/routes/locks.ts: POST /locks/release → lock not found → 404
 *   - execution/routes/locks.ts: POST /locks/release → wrong holder → 409
 *   - execution/routes/locks.ts: POST /locks/release → failure events emitted
 *   - execution/routes/locks.ts: POST /locks/heartbeat → wrong holder → 409
 *   - execution/routes/locks.ts: POST /locks/heartbeat → failure events emitted
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  };
}

async function makeRegistryWithContainer(): Promise<{
  registry: InstanceType<typeof ContainerRegistry>;
  secret: string;
  instanceId: string;
  agentName: string;
}> {
  const registry = new ContainerRegistry();
  const secret = "lock-extra-secret-" + randomUUID().slice(0, 8);
  const instanceId = "lock-extra-inst-" + randomUUID().slice(0, 8);
  const agentName = "lock-extra-agent";
  await registry.register(secret, { containerName: "test-container", agentName, instanceId });
  return { registry, secret, instanceId, agentName };
}

// A valid URI for lock testing
const LOCK_A = "test://lock-extra/resource-a";
const LOCK_B = "test://lock-extra/resource-b";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe(
  "integration: execution/routes/locks.ts extra branches (no Docker required)",
  { timeout: 20_000 },
  () => {
    // ── POST /locks/acquire → deadlock path ───────────────────────────────────

    it("POST /locks/acquire → 409 with deadlock:true and cycle when deadlock detected", async () => {
      const logger = makeLogger();

      // Register two containers (two different "holders")
      const registryA = new ContainerRegistry();
      const secretA = "lock-deadlock-a-" + randomUUID().slice(0, 8);
      const instanceA = "inst-a-" + randomUUID().slice(0, 8);
      await registryA.register(secretA, { containerName: "container-a", agentName: "agent-a", instanceId: instanceA });

      const secretB = "lock-deadlock-b-" + randomUUID().slice(0, 8);
      const instanceB = "inst-b-" + randomUUID().slice(0, 8);
      await registryA.register(secretB, { containerName: "container-b", agentName: "agent-b", instanceId: instanceB });

      const lockStore = new LockStore();
      const app = new Hono();
      registerLockRoutes(app, registryA, lockStore, logger);

      // Agent A acquires LOCK_A
      await app.request("/locks/acquire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: secretA, resourceKey: LOCK_A }),
      });

      // Agent B acquires LOCK_B
      await app.request("/locks/acquire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: secretB, resourceKey: LOCK_B }),
      });

      // Agent A tries to acquire LOCK_B (held by B) → conflict, A waits for B
      await app.request("/locks/acquire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: secretA, resourceKey: LOCK_B }),
      });

      // Agent B tries to acquire LOCK_A (held by A, A waits for B) → deadlock!
      const res = await app.request("/locks/acquire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: secretB, resourceKey: LOCK_A }),
      });

      expect(res.status).toBe(409);
      const body = await res.json() as {
        ok: boolean;
        reason: string;
        deadlock: boolean;
        cycle: string[];
      };
      expect(body.ok).toBe(false);
      expect(body.deadlock).toBe(true);
      expect(body.reason).toBeDefined();
      expect(Array.isArray(body.cycle)).toBe(true);
      expect(body.cycle.length).toBeGreaterThan(0);
    });

    it("POST /locks/acquire deadlock path logs warn not debug", async () => {
      const logger = makeLogger();

      const registry = new ContainerRegistry();
      const secretA = "dl-warn-a-" + randomUUID().slice(0, 8);
      const secretB = "dl-warn-b-" + randomUUID().slice(0, 8);
      const instanceA = "inst-dl-warn-a-" + randomUUID().slice(0, 8);
      const instanceB = "inst-dl-warn-b-" + randomUUID().slice(0, 8);
      await registry.register(secretA, { containerName: "ca", agentName: "agent-a", instanceId: instanceA });
      await registry.register(secretB, { containerName: "cb", agentName: "agent-b", instanceId: instanceB });

      const lockStore = new LockStore();
      const app = new Hono();
      registerLockRoutes(app, registry, lockStore, logger);

      const R1 = "test://warn-test/r1";
      const R2 = "test://warn-test/r2";

      // A acquires R1, B acquires R2
      await app.request("/locks/acquire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: secretA, resourceKey: R1 }),
      });
      await app.request("/locks/acquire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: secretB, resourceKey: R2 }),
      });

      // A tries R2 (held by B) → conflict, A waits for B
      await app.request("/locks/acquire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: secretA, resourceKey: R2 }),
      });

      logger.warn.mockClear();

      // B tries R1 (held by A, A waits for B) → deadlock → logs warn
      await app.request("/locks/acquire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: secretB, resourceKey: R1 }),
      });

      // Should have logged warn with "deadlock" or "possible deadlock"
      const warnCalls = logger.warn.mock.calls;
      const hasDeadlockWarn = warnCalls.some((args: any[]) => {
        const obj = args[0];
        return (typeof obj === "object" && obj !== null) && JSON.stringify(args).toLowerCase().includes("deadlock");
      });
      expect(hasDeadlockWarn).toBe(true);
    });

    // ── POST /locks/release → failure paths ───────────────────────────────────

    it("POST /locks/release → 404 when lock not found", async () => {
      const { registry, secret } = await makeRegistryWithContainer();
      const lockStore = new LockStore();
      const logger = makeLogger();
      const app = new Hono();
      registerLockRoutes(app, registry, lockStore, logger);

      // Try to release a lock that was never acquired
      const res = await app.request("/locks/release", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret, resourceKey: LOCK_A }),
      });

      expect(res.status).toBe(404);
      const body = await res.json() as { ok: boolean; reason: string };
      expect(body.ok).toBe(false);
      expect(body.reason).toContain("not found");
    });

    it("POST /locks/release → 409 when wrong holder tries to release", async () => {
      const logger = makeLogger();

      // Register two containers
      const registry = new ContainerRegistry();
      const secretA = "rel-wrong-a-" + randomUUID().slice(0, 8);
      const secretB = "rel-wrong-b-" + randomUUID().slice(0, 8);
      const instanceA = "inst-rel-a-" + randomUUID().slice(0, 8);
      const instanceB = "inst-rel-b-" + randomUUID().slice(0, 8);
      await registry.register(secretA, { containerName: "ca", agentName: "agent-a", instanceId: instanceA });
      await registry.register(secretB, { containerName: "cb", agentName: "agent-b", instanceId: instanceB });

      const lockStore = new LockStore();
      const app = new Hono();
      registerLockRoutes(app, registry, lockStore, logger);

      // Agent A acquires LOCK_A
      await app.request("/locks/acquire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: secretA, resourceKey: LOCK_A }),
      });

      // Agent B tries to release A's lock → wrong holder → 409
      const res = await app.request("/locks/release", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: secretB, resourceKey: LOCK_A }),
      });

      expect(res.status).toBe(409);
      const body = await res.json() as { ok: boolean; reason: string };
      expect(body.ok).toBe(false);
      expect(body.reason).toBeDefined();
    });

    it("POST /locks/release → events emitted on failure (lock not found)", async () => {
      const { registry, secret } = await makeRegistryWithContainer();
      const lockStore = new LockStore();
      const logger = makeLogger();
      const events = { emit: vi.fn() };
      const app = new Hono();
      registerLockRoutes(app, registry, lockStore, logger, { events: events as any });

      // Try to release a lock that was never acquired → failure events
      await app.request("/locks/release", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret, resourceKey: LOCK_A }),
      });

      // Event should have been emitted with ok:false
      const lockEmit = events.emit.mock.calls.find(
        (args: any[]) => args[0] === "lock" && args[1]?.action === "release" && args[1]?.ok === false
      );
      expect(lockEmit).toBeDefined();
      expect(lockEmit![1].status).toBe(404);
    });

    // ── POST /locks/heartbeat → failure paths ─────────────────────────────────

    it("POST /locks/heartbeat → 409 when wrong holder tries to heartbeat", async () => {
      const logger = makeLogger();

      const registry = new ContainerRegistry();
      const secretA = "hb-wrong-a-" + randomUUID().slice(0, 8);
      const secretB = "hb-wrong-b-" + randomUUID().slice(0, 8);
      const instanceA = "inst-hb-a-" + randomUUID().slice(0, 8);
      const instanceB = "inst-hb-b-" + randomUUID().slice(0, 8);
      await registry.register(secretA, { containerName: "ca", agentName: "agent-a", instanceId: instanceA });
      await registry.register(secretB, { containerName: "cb", agentName: "agent-b", instanceId: instanceB });

      const lockStore = new LockStore();
      const app = new Hono();
      registerLockRoutes(app, registry, lockStore, logger);

      // Agent A acquires LOCK_A
      await app.request("/locks/acquire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: secretA, resourceKey: LOCK_A }),
      });

      // Agent B tries to heartbeat A's lock → wrong holder → 409
      const res = await app.request("/locks/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: secretB, resourceKey: LOCK_A }),
      });

      expect(res.status).toBe(409);
      const body = await res.json() as { ok: boolean; reason: string };
      expect(body.ok).toBe(false);
      expect(body.reason).toBeDefined();
    });

    it("POST /locks/heartbeat → events emitted on failure (lock not found)", async () => {
      const { registry, secret } = await makeRegistryWithContainer();
      const lockStore = new LockStore();
      const logger = makeLogger();
      const events = { emit: vi.fn() };
      const app = new Hono();
      registerLockRoutes(app, registry, lockStore, logger, { events: events as any });

      // Try to heartbeat a lock that was never acquired → failure events
      await app.request("/locks/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret, resourceKey: LOCK_A }),
      });

      const lockEmit = events.emit.mock.calls.find(
        (args: any[]) => args[0] === "lock" && args[1]?.action === "heartbeat" && args[1]?.ok === false
      );
      expect(lockEmit).toBeDefined();
      expect(lockEmit![1].status).toBe(404);
    });
  },
);
