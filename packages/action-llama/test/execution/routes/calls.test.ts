import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { registerCallRoutes, type CallDispatcher } from "../../../src/execution/routes/calls.js";
import { CallStore } from "../../../src/execution/call-store.js";
import type { ContainerRegistration } from "../../../src/execution/types.js";

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function setup(dispatcher?: CallDispatcher) {
  const registry = new Map<string, ContainerRegistration>();
  const callStore = new CallStore(9999);
  const app = new Hono();
  let currentDispatcher = dispatcher;
  registerCallRoutes(app, registry, callStore, () => currentDispatcher, logger as any);
  return { app, registry, callStore, setDispatcher: (d: CallDispatcher) => { currentDispatcher = d; } };
}

function register(registry: Map<string, ContainerRegistration>, secret: string, agentName: string, instanceId?: string) {
  registry.set(secret, { containerName: `al-${agentName}-1234`, agentName, instanceId: instanceId || agentName });
}

async function postCall(app: Hono, body: Record<string, unknown>) {
  return app.request("/calls", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function checkCall(app: Hono, callId: string, secret: string) {
  return app.request(`/calls/${callId}?secret=${secret}`);
}

describe("POST /calls", () => {
  let app: Hono, registry: Map<string, ContainerRegistration>, callStore: CallStore;
  let setDispatcher: (d: CallDispatcher) => void;

  beforeEach(() => {
    const s = setup((entry) => {
      callStore.setRunning(entry.callId);
      return { ok: true };
    });
    app = s.app;
    registry = s.registry;
    callStore = s.callStore;
    setDispatcher = s.setDispatcher;
    register(registry, "secret-a", "agent-a");
    register(registry, "secret-b", "agent-b");
  });
  afterEach(() => callStore.dispose());

  it("creates a call and returns callId", async () => {
    const res = await postCall(app, { secret: "secret-a", targetAgent: "agent-b", context: "do work" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.callId).toBeTruthy();
  });

  it("returns 400 for invalid JSON body", async () => {
    const res = await app.request("/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-valid-json{{{",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid JSON body");
  });

  it("returns 400 for missing secret", async () => {
    const res = await postCall(app, { targetAgent: "b", context: "x" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing targetAgent", async () => {
    const res = await postCall(app, { secret: "secret-a", context: "x" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing context", async () => {
    const res = await postCall(app, { secret: "secret-a", targetAgent: "b" });
    expect(res.status).toBe(400);
  });

  it("returns 403 for invalid secret", async () => {
    const res = await postCall(app, { secret: "invalid", targetAgent: "b", context: "x" });
    expect(res.status).toBe(403);
  });

  it("returns 409 when dispatcher rejects", async () => {
    setDispatcher(() => ({ ok: false, reason: "agent not found" }));
    const res = await postCall(app, { secret: "secret-a", targetAgent: "nonexistent", context: "x" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("agent not found");
  });

  it("returns 503 when dispatcher is not set", async () => {
    setDispatcher(undefined as any);
    const s2 = setup(); // No dispatcher
    register(s2.registry, "secret-a", "agent-a");
    const res = await postCall(s2.app, { secret: "secret-a", targetAgent: "b", context: "x" });
    expect(res.status).toBe(503);
    s2.callStore.dispose();
  });
});

describe("GET /calls/:callId", () => {
  let app: Hono, registry: Map<string, ContainerRegistration>, callStore: CallStore;

  beforeEach(() => {
    const s = setup((entry) => {
      callStore.setRunning(entry.callId);
      return { ok: true };
    });
    app = s.app;
    registry = s.registry;
    callStore = s.callStore;
    register(registry, "secret-a", "agent-a");
    register(registry, "secret-b", "agent-b");
  });
  afterEach(() => callStore.dispose());

  it("returns call status for valid caller", async () => {
    const createRes = await postCall(app, { secret: "secret-a", targetAgent: "agent-b", context: "do work" });
    const { callId } = await createRes.json();

    const res = await checkCall(app, callId, "secret-a");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("running");
  });

  it("returns completed status with returnValue", async () => {
    const createRes = await postCall(app, { secret: "secret-a", targetAgent: "agent-b", context: "do work" });
    const { callId } = await createRes.json();

    callStore.complete(callId, "result data");

    const res = await checkCall(app, callId, "secret-a");
    const body = await res.json();
    expect(body.status).toBe("completed");
    expect(body.returnValue).toBe("result data");
  });

  it("returns 404 for non-existent call", async () => {
    const res = await checkCall(app, "nonexistent", "secret-a");
    expect(res.status).toBe(404);
  });

  it("returns 404 when caller does not match", async () => {
    const createRes = await postCall(app, { secret: "secret-a", targetAgent: "agent-b", context: "do work" });
    const { callId } = await createRes.json();

    // agent-b tries to check a call made by agent-a
    const res = await checkCall(app, callId, "secret-b");
    expect(res.status).toBe(404);
  });

  it("returns 400 for missing secret", async () => {
    const res = await app.request("/calls/some-id");
    expect(res.status).toBe(400);
  });

  it("returns 403 for invalid secret", async () => {
    const res = await checkCall(app, "some-id", "invalid");
    expect(res.status).toBe(403);
  });

  it("returns error status with errorMessage", async () => {
    const createRes = await postCall(app, { secret: "secret-a", targetAgent: "agent-b", context: "do work" });
    const { callId } = await createRes.json();

    callStore.fail(callId, "timeout");

    const res = await checkCall(app, callId, "secret-a");
    const body = await res.json();
    expect(body.status).toBe("error");
    expect(body.errorMessage).toBe("timeout");
  });
});
