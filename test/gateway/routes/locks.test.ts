import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { registerLockRoutes } from "../../../src/gateway/routes/locks.js";
import { LockStore } from "../../../src/gateway/lock-store.js";
import type { ContainerRegistration } from "../../../src/gateway/types.js";

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function setup(opts?: { skipStatusEndpoint?: boolean }) {
  const registry = new Map<string, ContainerRegistration>();
  const lockStore = new LockStore(300, 9999);
  const app = new Hono();
  registerLockRoutes(app, registry, lockStore, logger as any, opts);
  return { app, registry, lockStore };
}

function register(registry: Map<string, ContainerRegistration>, secret: string, agentName: string, instanceId?: string) {
  registry.set(secret, { containerName: `al-${agentName}-1234`, agentName, instanceId: instanceId || agentName });
}

async function acquire(app: Hono, body: Record<string, unknown>) {
  return app.request("/locks/acquire", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function release(app: Hono, body: Record<string, unknown>) {
  return app.request("/locks/release", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function heartbeat(app: Hono, body: Record<string, unknown>) {
  return app.request("/locks/heartbeat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /locks/acquire", () => {
  let app: Hono, registry: Map<string, ContainerRegistration>, lockStore: LockStore;

  beforeEach(() => {
    ({ app, registry, lockStore } = setup());
    register(registry, "secret-a", "agent-a");
    register(registry, "secret-b", "agent-b");
  });
  afterEach(() => lockStore.dispose());

  it("acquires a free lock and returns 200", async () => {
    const res = await acquire(app, { secret: "secret-a", resourceKey: "github issue acme/app#42" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, resourceKey: "github issue acme/app#42" });
  });

  it("returns 409 when lock is held by another agent", async () => {
    await acquire(app, { secret: "secret-a", resourceKey: "github issue acme/app#42" });
    const res = await acquire(app, { secret: "secret-b", resourceKey: "github issue acme/app#42" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.holder).toBe("agent-a");
    expect(body.heldSince).toBeTypeOf("number");
  });

  it("returns 409 when agent already holds a different lock", async () => {
    await acquire(app, { secret: "secret-a", resourceKey: "github issue acme/app#1" });
    const res = await acquire(app, { secret: "secret-a", resourceKey: "github issue acme/app#2" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toContain("already holding lock");
  });

  it("returns 403 for invalid secret", async () => {
    const res = await acquire(app, { secret: "bad", resourceKey: "github issue x" });
    expect(res.status).toBe(403);
  });

  it("returns 400 for missing fields", async () => {
    const res = await acquire(app, { secret: "secret-a" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing secret", async () => {
    const res = await acquire(app, { resourceKey: "github issue x" });
    expect(res.status).toBe(400);
  });

  it("allows same agent to re-acquire its own lock", async () => {
    await acquire(app, { secret: "secret-a", resourceKey: "github issue acme/app#42" });
    const res = await acquire(app, { secret: "secret-a", resourceKey: "github issue acme/app#42" });
    expect(res.status).toBe(200);
  });

  it("allows different instances of the same agent to each hold one lock", async () => {
    register(registry, "secret-inst-1", "my-agent", "my-agent-1");
    register(registry, "secret-inst-2", "my-agent", "my-agent-2");

    const res1 = await acquire(app, { secret: "secret-inst-1", resourceKey: "github issue #1" });
    expect(res1.status).toBe(200);

    const res2 = await acquire(app, { secret: "secret-inst-2", resourceKey: "github issue #2" });
    expect(res2.status).toBe(200);
  });

  it("prevents different instances of the same agent from locking the same resource", async () => {
    register(registry, "secret-inst-1", "my-agent", "my-agent-1");
    register(registry, "secret-inst-2", "my-agent", "my-agent-2");

    await acquire(app, { secret: "secret-inst-1", resourceKey: "github issue #1" });
    const res = await acquire(app, { secret: "secret-inst-2", resourceKey: "github issue #1" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.holder).toBe("my-agent-1");
  });
});

describe("POST /locks/release", () => {
  let app: Hono, registry: Map<string, ContainerRegistration>, lockStore: LockStore;

  beforeEach(() => {
    ({ app, registry, lockStore } = setup());
    register(registry, "secret-a", "agent-a");
    register(registry, "secret-b", "agent-b");
  });
  afterEach(() => lockStore.dispose());

  it("releases a lock held by the caller", async () => {
    await acquire(app, { secret: "secret-a", resourceKey: "github issue acme/app#42" });
    const res = await release(app, { secret: "secret-a", resourceKey: "github issue acme/app#42" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 409 when lock is held by another agent", async () => {
    await acquire(app, { secret: "secret-a", resourceKey: "github issue acme/app#42" });
    const res = await release(app, { secret: "secret-b", resourceKey: "github issue acme/app#42" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toContain("agent-a");
  });

  it("returns 404 for non-existent lock", async () => {
    const res = await release(app, { secret: "secret-a", resourceKey: "github issue nope" });
    expect(res.status).toBe(404);
  });

  it("returns 403 for invalid secret", async () => {
    const res = await release(app, { secret: "bad", resourceKey: "github issue x" });
    expect(res.status).toBe(403);
  });
});

describe("POST /locks/heartbeat", () => {
  let app: Hono, registry: Map<string, ContainerRegistration>, lockStore: LockStore;

  beforeEach(() => {
    ({ app, registry, lockStore } = setup());
    register(registry, "secret-a", "agent-a");
    register(registry, "secret-b", "agent-b");
  });
  afterEach(() => lockStore.dispose());

  it("extends TTL on a held lock", async () => {
    await acquire(app, { secret: "secret-a", resourceKey: "github issue acme/app#42" });
    const res = await heartbeat(app, { secret: "secret-a", resourceKey: "github issue acme/app#42" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.expiresAt).toBeTypeOf("number");
  });

  it("returns 409 for lock held by another agent", async () => {
    await acquire(app, { secret: "secret-a", resourceKey: "github issue acme/app#42" });
    const res = await heartbeat(app, { secret: "secret-b", resourceKey: "github issue acme/app#42" });
    expect(res.status).toBe(409);
  });

  it("returns 404 for non-existent lock", async () => {
    const res = await heartbeat(app, { secret: "secret-a", resourceKey: "github issue nope" });
    expect(res.status).toBe(404);
  });

  it("returns 403 for invalid secret", async () => {
    const res = await heartbeat(app, { secret: "bad", resourceKey: "github issue x" });
    expect(res.status).toBe(403);
  });

  it("returns 400 for missing fields", async () => {
    const res = await heartbeat(app, { secret: "secret-a" });
    expect(res.status).toBe(400);
  });
});

describe("GET /locks/list", () => {
  let app: Hono, registry: Map<string, ContainerRegistration>, lockStore: LockStore;

  beforeEach(() => {
    ({ app, registry, lockStore } = setup());
    register(registry, "secret-a", "agent-a");
    register(registry, "secret-b", "agent-b");
  });
  afterEach(() => lockStore.dispose());

  it("returns only locks held by the requesting agent", async () => {
    await acquire(app, { secret: "secret-a", resourceKey: "github issue acme/app#1" });
    await acquire(app, { secret: "secret-b", resourceKey: "github pr acme/app#2" });
    const resA = await app.request("/locks/list?secret=secret-a");
    expect(resA.status).toBe(200);
    const bodyA = await resA.json();
    expect(bodyA).toHaveLength(1);
    expect(bodyA[0].resourceKey).toBe("github issue acme/app#1");

    const resB = await app.request("/locks/list?secret=secret-b");
    expect(resB.status).toBe(200);
    const bodyB = await resB.json();
    expect(bodyB).toHaveLength(1);
    expect(bodyB[0].resourceKey).toBe("github pr acme/app#2");
  });

  it("returns 403 for invalid secret", async () => {
    const res = await app.request("/locks/list?secret=bad");
    expect(res.status).toBe(403);
  });

  it("returns 400 for missing secret", async () => {
    const res = await app.request("/locks/list");
    expect(res.status).toBe(400);
  });
});

describe("GET /locks/status", () => {
  let app: Hono, registry: Map<string, ContainerRegistration>, lockStore: LockStore;

  beforeEach(() => {
    ({ app, registry, lockStore } = setup());
    register(registry, "secret-a", "agent-a");
    register(registry, "secret-b", "dev-agent", "dev-agent-1");
  });
  afterEach(() => lockStore.dispose());

  it("returns lock status without authentication", async () => {
    await acquire(app, { secret: "secret-a", resourceKey: "github issue acme/app#1" });
    await acquire(app, { secret: "secret-b", resourceKey: "github pr acme/app#2" });
    const res = await app.request("/locks/status");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.locks).toHaveLength(2);
    
    const lock1 = body.locks.find((l: any) => l.resourceKey === "github issue acme/app#1");
    expect(lock1.agentName).toBe("agent");
    expect(lock1.heldSince).toBeTypeOf("number");
    
    const lock2 = body.locks.find((l: any) => l.resourceKey === "github pr acme/app#2");
    expect(lock2.agentName).toBe("dev-agent");
    expect(lock2.heldSince).toBeTypeOf("number");
  });

  it("returns empty locks array when no locks exist", async () => {
    const res = await app.request("/locks/status");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.locks).toEqual([]);
  });

  it("extracts agent name from holder correctly", async () => {
    register(registry, "secret-c", "my-complex-agent", "my-complex-agent-123");
    await acquire(app, { secret: "secret-c", resourceKey: "test resource" });
    const res = await app.request("/locks/status");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.locks).toHaveLength(1);
    expect(body.locks[0].agentName).toBe("my-complex-agent");
  });
});

describe("GET /locks/status with skipStatusEndpoint", () => {
  it("returns 404 when skipStatusEndpoint is true", async () => {
    const { app, registry } = setup({ skipStatusEndpoint: true });
    register(registry, "secret-a", "agent-a");
    await acquire(app, { secret: "secret-a", resourceKey: "github issue acme/app#1" });
    
    const res = await app.request("/locks/status");
    expect(res.status).toBe(404);
  });

  it("returns 200 when skipStatusEndpoint is false", async () => {
    const { app, registry } = setup({ skipStatusEndpoint: false });
    register(registry, "secret-a", "agent-a");
    await acquire(app, { secret: "secret-a", resourceKey: "github issue acme/app#1" });
    
    const res = await app.request("/locks/status");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.locks).toHaveLength(1);
    expect(body.locks[0].resourceKey).toBe("github issue acme/app#1");
  });

  it("returns 200 when skipStatusEndpoint is undefined (default behavior)", async () => {
    const { app, registry } = setup(); // No opts parameter
    register(registry, "secret-a", "agent-a");
    await acquire(app, { secret: "secret-a", resourceKey: "github issue acme/app#1" });
    
    const res = await app.request("/locks/status");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.locks).toHaveLength(1);
    expect(body.locks[0].resourceKey).toBe("github issue acme/app#1");
  });
});
