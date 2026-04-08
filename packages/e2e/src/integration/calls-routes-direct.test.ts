/**
 * Integration tests: execution/routes/calls.ts registerCallRoutes() — no Docker required.
 *
 * Tests branches that require a registered container (valid secret) but
 * no running Docker containers. These paths are not exercised by the
 * harness-based tests which only test validation error paths (400/403).
 *
 * By constructing a Hono app directly with a ContainerRegistry, CallStore,
 * and mock dispatcher, we can test:
 *
 *   1. POST /calls — dispatcher not provided (getDispatcher() returns undefined) → 503
 *   2. POST /calls — dispatcher rejects (result.ok=false) → 409
 *   3. POST /calls — dispatcher succeeds → 200 { ok:true, callId }
 *   4. POST /calls — events emitted for successful dispatch
 *   5. POST /calls — events emitted for rejected dispatch
 *   6. GET /calls/:callId — valid secret, unknown callId → 404 "call not found"
 *   7. GET /calls/:callId — valid secret, known callId → 200 with call state
 *
 * Covers:
 *   - execution/routes/calls.ts: POST /calls dispatcher not ready → 503
 *   - execution/routes/calls.ts: POST /calls dispatcher rejects → 409
 *   - execution/routes/calls.ts: POST /calls dispatcher succeeds → 200
 *   - execution/routes/calls.ts: GET /calls/:callId unknown callId → 404
 *   - execution/routes/calls.ts: GET /calls/:callId known callId → 200
 */

import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "crypto";

const { Hono } = await import(
  /* @vite-ignore */
  "/tmp/repo/node_modules/hono/dist/index.js"
);

const {
  registerCallRoutes,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/execution/routes/calls.js"
);

const {
  ContainerRegistry,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/execution/container-registry.js"
);

const {
  CallStore,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/execution/call-store.js"
);

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  };
}

/** Create a registry with one pre-registered container. */
async function makeRegistryWithContainer(): Promise<{
  registry: InstanceType<typeof ContainerRegistry>;
  secret: string;
  agentName: string;
  instanceId: string;
}> {
  const registry = new ContainerRegistry(); // no StateStore → in-memory only
  const secret = "test-secret-" + randomUUID();
  const agentName = "test-caller-agent";
  const instanceId = "instance-" + randomUUID().slice(0, 8);

  await registry.register(secret, {
    containerName: "test-container",
    agentName,
    instanceId,
  });

  return { registry, secret, agentName, instanceId };
}

describe("integration: execution/routes/calls.ts direct tests (no Docker required)", { timeout: 20_000 }, () => {

  // ── POST /calls — dispatcher not ready → 503 ─────────────────────────────

  it("returns 503 when dispatcher is not provided (getDispatcher returns undefined)", async () => {
    const { registry, secret } = await makeRegistryWithContainer();
    const callStore = new CallStore();
    const app = new Hono();
    const logger = makeLogger();

    // Provide no dispatcher (undefined)
    registerCallRoutes(app, registry, callStore, () => undefined, logger);

    const res = await app.request("/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, targetAgent: "target-agent", context: "do something" }),
    });
    expect(res.status).toBe(503);
    const body = await res.json() as { ok: boolean; reason: string };
    expect(body.ok).toBe(false);
    expect(body.reason).toContain("not ready");
  });

  // ── POST /calls — dispatcher rejects → 409 ───────────────────────────────

  it("returns 409 when dispatcher rejects the call with ok:false", async () => {
    const { registry, secret } = await makeRegistryWithContainer();
    const callStore = new CallStore();
    const app = new Hono();
    const logger = makeLogger();

    const mockDispatcher = vi.fn(() => ({ ok: false, reason: "target agent not found" }));
    registerCallRoutes(app, registry, callStore, () => mockDispatcher, logger);

    const res = await app.request("/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, targetAgent: "nonexistent-agent", context: "do something" }),
    });
    expect(res.status).toBe(409);
    const body = await res.json() as { ok: boolean; reason: string };
    expect(body.ok).toBe(false);
    expect(body.reason).toContain("not found");

    // Dispatcher was called
    expect(mockDispatcher).toHaveBeenCalledOnce();
  });

  // ── POST /calls — dispatcher succeeds → 200 ──────────────────────────────

  it("returns 200 with callId when dispatcher succeeds", async () => {
    const { registry, secret, agentName } = await makeRegistryWithContainer();
    const callStore = new CallStore();
    const app = new Hono();
    const logger = makeLogger();

    const mockDispatcher = vi.fn(() => ({ ok: true }));
    registerCallRoutes(app, registry, callStore, () => mockDispatcher, logger);

    const res = await app.request("/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, targetAgent: "target-agent", context: "run this task" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; callId: string };
    expect(body.ok).toBe(true);
    expect(typeof body.callId).toBe("string");
    expect(body.callId.length).toBeGreaterThan(0);

    // Dispatcher was called with correct caller info
    expect(mockDispatcher).toHaveBeenCalledOnce();
    const dispatchArg = mockDispatcher.mock.calls[0][0];
    expect(dispatchArg.callerAgent).toBe(agentName);
    expect(dispatchArg.targetAgent).toBe("target-agent");
    expect(dispatchArg.context).toBe("run this task");
    expect(dispatchArg.callId).toBe(body.callId);
  });

  // ── POST /calls — events emitted ─────────────────────────────────────────

  it("emits 'call' event with ok:true when dispatch succeeds", async () => {
    const { registry, secret } = await makeRegistryWithContainer();
    const callStore = new CallStore();
    const app = new Hono();
    const logger = makeLogger();

    const mockEvents = { emit: vi.fn() };
    const mockDispatcher = vi.fn(() => ({ ok: true }));
    registerCallRoutes(app, registry, callStore, () => mockDispatcher, logger, mockEvents as any);

    await app.request("/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, targetAgent: "target-agent", context: "task" }),
    });

    expect(mockEvents.emit).toHaveBeenCalledWith("call", expect.objectContaining({
      ok: true,
      targetAgent: "target-agent",
    }));
  });

  it("emits 'call' event with ok:false when dispatch is rejected", async () => {
    const { registry, secret } = await makeRegistryWithContainer();
    const callStore = new CallStore();
    const app = new Hono();
    const logger = makeLogger();

    const mockEvents = { emit: vi.fn() };
    const mockDispatcher = vi.fn(() => ({ ok: false, reason: "agent unavailable" }));
    registerCallRoutes(app, registry, callStore, () => mockDispatcher, logger, mockEvents as any);

    await app.request("/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, targetAgent: "target-agent", context: "task" }),
    });

    expect(mockEvents.emit).toHaveBeenCalledWith("call", expect.objectContaining({
      ok: false,
      reason: "agent unavailable",
    }));
  });

  // ── GET /calls/:callId — unknown callId → 404 ────────────────────────────

  it("returns 404 for unknown callId with valid secret", async () => {
    const { registry, secret } = await makeRegistryWithContainer();
    const callStore = new CallStore();
    const app = new Hono();
    const logger = makeLogger();

    registerCallRoutes(app, registry, callStore, () => undefined, logger);

    const unknownCallId = randomUUID();
    const res = await app.request(`/calls/${unknownCallId}?secret=${encodeURIComponent(secret)}`);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("call not found");
  });

  // ── GET /calls/:callId — known callId → 200 ──────────────────────────────

  it("returns 200 with call state for a known callId (matching callerInstanceId)", async () => {
    const { registry, secret, agentName, instanceId } = await makeRegistryWithContainer();
    const callStore = new CallStore();
    const app = new Hono();
    const logger = makeLogger();

    // Create a call in the store with the same callerInstanceId as the registered container
    const call = callStore.create({
      callerAgent: agentName,
      callerInstanceId: instanceId,  // must match the registered container's instanceId
      targetAgent: "target-agent",
      context: "do something",
      depth: 1,
    });

    registerCallRoutes(app, registry, callStore, () => undefined, logger);

    const res = await app.request(`/calls/${call.callId}?secret=${encodeURIComponent(secret)}`);
    expect(res.status).toBe(200);
    // check() returns { status, returnValue, errorMessage } (not the full call)
    const body = await res.json() as { status: string; returnValue?: string; errorMessage?: string };
    expect(body.status).toBe("pending");
    expect(body.returnValue).toBeUndefined();
  });
});
