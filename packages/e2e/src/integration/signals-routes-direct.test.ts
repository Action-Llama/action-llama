/**
 * Integration tests: execution/routes/signals.ts registerSignalRoutes() — no Docker required.
 *
 * Tests success paths in registerSignalRoutes() by constructing a Hono app
 * directly with a ContainerRegistry and optional SignalContext/StatusTracker.
 * These paths require a registered container (valid secret) and are not covered
 * by the harness-based tests which only test validation/auth error paths.
 *
 *   1. POST /signals/rerun — valid secret → 200 ok:true, schedulerRerun called
 *   2. POST /signals/rerun — events emitted with signal:rerun
 *   3. POST /signals/rerun — no signalContext → still 200 ok:true (no-op)
 *   4. POST /signals/status — valid secret → 200 ok:true, statusTracker.setAgentStatusText called
 *   5. POST /signals/status — events emitted with signal:status
 *   6. POST /signals/status — no statusTracker → still 200 ok:true (no-op)
 *   7. POST /signals/trigger — valid secret → 200 ok:true, schedulerTrigger called
 *   8. POST /signals/trigger — events emitted with signal:trigger
 *   9. POST /signals/return — valid secret → 200 ok:true, schedulerReturn called
 *  10. POST /signals/return — events emitted with signal:return
 *  11. POST /signals/return — no schedulerReturn in signalContext → still 200 ok:true
 *
 * Covers:
 *   - execution/routes/signals.ts: POST /signals/rerun → 200 success path
 *   - execution/routes/signals.ts: POST /signals/rerun → signalContext.schedulerRerun called
 *   - execution/routes/signals.ts: POST /signals/rerun → events emitted
 *   - execution/routes/signals.ts: POST /signals/rerun → no signalContext → ok:true no-op
 *   - execution/routes/signals.ts: POST /signals/status → statusTracker.setAgentStatusText
 *   - execution/routes/signals.ts: POST /signals/status → events emitted
 *   - execution/routes/signals.ts: POST /signals/status → no statusTracker → ok:true no-op
 *   - execution/routes/signals.ts: POST /signals/trigger → schedulerTrigger called
 *   - execution/routes/signals.ts: POST /signals/trigger → events emitted
 *   - execution/routes/signals.ts: POST /signals/return → schedulerReturn called
 *   - execution/routes/signals.ts: POST /signals/return → events emitted
 *   - execution/routes/signals.ts: POST /signals/return → no schedulerReturn → ok:true no-op
 */

import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "crypto";

const { Hono } = await import(
  /* @vite-ignore */
  "/tmp/repo/node_modules/hono/dist/index.js"
);

const {
  registerSignalRoutes,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/execution/routes/signals.js"
);

const {
  ContainerRegistry,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/execution/container-registry.js"
);

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
}

/** Create a registry with one registered container. */
async function makeRegistryWithContainer(): Promise<{
  registry: InstanceType<typeof ContainerRegistry>;
  secret: string;
  instanceId: string;
  agentName: string;
}> {
  const registry = new ContainerRegistry();
  const secret = "test-signal-secret-" + randomUUID().slice(0, 8);
  const instanceId = "signal-instance-" + randomUUID().slice(0, 8);
  const agentName = "test-signal-agent";
  await registry.register(secret, { containerName: "test-container", agentName, instanceId });
  return { registry, secret, instanceId, agentName };
}

describe("integration: execution/routes/signals.ts direct tests (no Docker required)", { timeout: 20_000 }, () => {

  // ── POST /signals/rerun ───────────────────────────────────────────────────

  it("POST /signals/rerun → 200 ok:true and calls schedulerRerun", async () => {
    const { registry, secret, agentName } = await makeRegistryWithContainer();
    const app = new Hono();
    const rerunFn = vi.fn();
    const signalContext = {
      schedulerRerun: rerunFn,
      schedulerTrigger: vi.fn(),
    };

    registerSignalRoutes(app, registry, makeLogger(), undefined, signalContext);

    const res = await app.request("/signals/rerun", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);

    // schedulerRerun should have been called with the agent name
    expect(rerunFn).toHaveBeenCalledOnce();
    expect(rerunFn).toHaveBeenCalledWith(agentName);
  });

  it("POST /signals/rerun → emits 'signal' event with signal:rerun", async () => {
    const { registry, secret, agentName, instanceId } = await makeRegistryWithContainer();
    const app = new Hono();
    const mockEvents = { emit: vi.fn() };

    registerSignalRoutes(app, registry, makeLogger(), undefined, undefined, mockEvents as any);

    await app.request("/signals/rerun", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret }),
    });

    expect(mockEvents.emit).toHaveBeenCalledWith("signal", expect.objectContaining({
      agentName,
      instanceId,
      signal: "rerun",
    }));
  });

  it("POST /signals/rerun → 200 ok:true even without signalContext (no-op)", async () => {
    const { registry, secret } = await makeRegistryWithContainer();
    const app = new Hono();

    registerSignalRoutes(app, registry, makeLogger(), undefined, undefined);  // no signalContext

    const res = await app.request("/signals/rerun", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  // ── POST /signals/status ──────────────────────────────────────────────────

  it("POST /signals/status → 200 ok:true and calls statusTracker.setAgentStatusText", async () => {
    const { registry, secret, agentName } = await makeRegistryWithContainer();
    const app = new Hono();
    const setStatusFn = vi.fn();
    const mockTracker = { setAgentStatusText: setStatusFn };

    registerSignalRoutes(app, registry, makeLogger(), mockTracker as any);

    const res = await app.request("/signals/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, text: "Working on it..." }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);

    expect(setStatusFn).toHaveBeenCalledWith(agentName, "Working on it...");
  });

  it("POST /signals/status → emits 'signal' event with signal:status", async () => {
    const { registry, secret } = await makeRegistryWithContainer();
    const app = new Hono();
    const mockEvents = { emit: vi.fn() };

    registerSignalRoutes(app, registry, makeLogger(), undefined, undefined, mockEvents as any);

    await app.request("/signals/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, text: "Processing..." }),
    });

    expect(mockEvents.emit).toHaveBeenCalledWith("signal", expect.objectContaining({
      signal: "status",
    }));
  });

  it("POST /signals/status → 200 ok:true without statusTracker (no-op)", async () => {
    const { registry, secret } = await makeRegistryWithContainer();
    const app = new Hono();

    registerSignalRoutes(app, registry, makeLogger(), undefined);  // no statusTracker

    const res = await app.request("/signals/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, text: "Some status" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  // ── POST /signals/trigger ─────────────────────────────────────────────────

  it("POST /signals/trigger → 200 ok:true and calls schedulerTrigger with correct args", async () => {
    const { registry, secret, agentName } = await makeRegistryWithContainer();
    const app = new Hono();
    const triggerFn = vi.fn();
    const signalContext = {
      schedulerRerun: vi.fn(),
      schedulerTrigger: triggerFn,
    };

    registerSignalRoutes(app, registry, makeLogger(), undefined, signalContext);

    const res = await app.request("/signals/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, targetAgent: "other-agent", context: "do something" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);

    expect(triggerFn).toHaveBeenCalledWith("other-agent", agentName, "do something");
  });

  it("POST /signals/trigger → emits 'signal' event with signal:trigger", async () => {
    const { registry, secret } = await makeRegistryWithContainer();
    const app = new Hono();
    const mockEvents = { emit: vi.fn() };

    registerSignalRoutes(app, registry, makeLogger(), undefined, undefined, mockEvents as any);

    await app.request("/signals/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, targetAgent: "target", context: "ctx" }),
    });

    expect(mockEvents.emit).toHaveBeenCalledWith("signal", expect.objectContaining({
      signal: "trigger",
    }));
  });

  // ── POST /signals/return ──────────────────────────────────────────────────

  it("POST /signals/return → 200 ok:true and calls schedulerReturn", async () => {
    const { registry, secret, agentName } = await makeRegistryWithContainer();
    const app = new Hono();
    const returnFn = vi.fn();
    const signalContext = {
      schedulerRerun: vi.fn(),
      schedulerTrigger: vi.fn(),
      schedulerReturn: returnFn,
    };

    registerSignalRoutes(app, registry, makeLogger(), undefined, signalContext);

    const res = await app.request("/signals/return", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, value: "42" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);

    expect(returnFn).toHaveBeenCalledWith(agentName, "42");
  });

  it("POST /signals/return → emits 'signal' event with signal:return", async () => {
    const { registry, secret } = await makeRegistryWithContainer();
    const app = new Hono();
    const mockEvents = { emit: vi.fn() };

    registerSignalRoutes(app, registry, makeLogger(), undefined, undefined, mockEvents as any);

    await app.request("/signals/return", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, value: "result-value" }),
    });

    expect(mockEvents.emit).toHaveBeenCalledWith("signal", expect.objectContaining({
      signal: "return",
    }));
  });

  it("POST /signals/return → 200 ok:true when signalContext has no schedulerReturn", async () => {
    const { registry, secret } = await makeRegistryWithContainer();
    const app = new Hono();
    // signalContext without schedulerReturn
    const signalContext = {
      schedulerRerun: vi.fn(),
      schedulerTrigger: vi.fn(),
      // no schedulerReturn
    };

    registerSignalRoutes(app, registry, makeLogger(), undefined, signalContext);

    const res = await app.request("/signals/return", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, value: "some-value" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
