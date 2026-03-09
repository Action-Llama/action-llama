import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { registerLockRoutes } from "../../../src/gateway/routes/locks.js";
import { LockStore } from "../../../src/gateway/lock-store.js";
import type { ContainerRegistration } from "../../../src/gateway/types.js";

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function setup() {
  const registry = new Map<string, ContainerRegistration>();
  const lockStore = new LockStore(300, 9999);
  const app = new Hono();
  registerLockRoutes(app, registry, lockStore, logger as any);
  return { app, registry, lockStore };
}

function register(registry: Map<string, ContainerRegistration>, secret: string, agentName: string) {
  registry.set(secret, { containerName: `al-${agentName}-1234`, agentName });
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

  it("returns all active locks", async () => {
    await acquire(app, { secret: "secret-a", resourceKey: "github issue acme/app#1" });
    await acquire(app, { secret: "secret-b", resourceKey: "github pr acme/app#2" });
    const res = await app.request("/locks/list?secret=secret-a");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
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
