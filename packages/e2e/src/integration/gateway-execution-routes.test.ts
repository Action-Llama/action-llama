/**
 * Integration tests: gateway/routes/execution.ts registerExecutionRoutes() — no Docker required.
 *
 * registerExecutionRoutes() is a thin wrapper that calls:
 *   - registerLockRoutes(app, containerRegistry, lockStore, logger, opts)
 *   - registerCallRoutes(app, containerRegistry, callStore, callDispatcherProvider, logger, events)
 *   - registerSignalRoutes(app, containerRegistry, logger, statusTracker, signalContext, events)
 *
 * This test verifies that calling registerExecutionRoutes() correctly sets up
 * all three sets of routes by checking that requests to representative
 * endpoints from each group receive the expected responses (not 404 "unknown route").
 *
 * Test scenarios (no Docker required):
 *   1. registerExecutionRoutes() does not throw
 *   2. Registers lock routes — POST /locks/acquire returns 400 (missing fields, not 404)
 *   3. Registers lock routes — GET /locks/list route exists (not 404)
 *   4. Registers lock routes — GET /locks/status registered when skipStatusEndpoint omitted
 *   5. Registers lock routes — GET /locks/status 404 when skipStatusEndpoint=true
 *   6. Registers call routes — POST /calls route exists (returns 400 on bad input, not 404)
 *   7. Registers signal routes — POST /signals/status route exists (returns 400, not 404)
 *   8. All three route groups work in combination on same Hono app
 *
 * Covers:
 *   - gateway/routes/execution.ts: registerExecutionRoutes() — delegates to all three register fns
 *   - gateway/routes/execution.ts: skipStatusEndpoint option forwarded to registerLockRoutes()
 *   - gateway/routes/execution.ts: events option forwarded to call and lock routes
 *   - gateway/routes/execution.ts: all routes accessible on the Hono app
 */

import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "crypto";

const { Hono } = await import(
  /* @vite-ignore */
  "/tmp/repo/node_modules/hono/dist/index.js"
);

const {
  registerExecutionRoutes,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/gateway/routes/execution.js"
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

const {
  CallStore,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/execution/call-store.js"
);

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
}

function makeApp() {
  const app = new Hono();
  const registry = new ContainerRegistry();
  const lockStore = new LockStore();
  const callStore = new CallStore();
  const logger = makeLogger();

  return { app, registry, lockStore, callStore, logger };
}

describe("integration: gateway/routes/execution.ts registerExecutionRoutes() (no Docker required)", { timeout: 30_000 }, () => {

  // ── Basic registration ────────────────────────────────────────────────────

  it("does not throw when called with minimal options", () => {
    const { app, registry, lockStore, callStore, logger } = makeApp();
    expect(() =>
      registerExecutionRoutes(app, {
        containerRegistry: registry,
        lockStore,
        callStore,
        callDispatcherProvider: () => undefined,
        logger,
      })
    ).not.toThrow();
  });

  it("does not throw with all optional parameters provided", () => {
    const { app, registry, lockStore, callStore, logger } = makeApp();
    expect(() =>
      registerExecutionRoutes(app, {
        containerRegistry: registry,
        lockStore,
        callStore,
        callDispatcherProvider: () => undefined,
        logger,
        statusTracker: undefined,
        signalContext: undefined,
        skipStatusEndpoint: false,
        events: undefined,
      })
    ).not.toThrow();
  });

  // ── Lock routes registered ────────────────────────────────────────────────

  it("registers POST /locks/acquire (returns 400, not 404)", async () => {
    const { app, registry, lockStore, callStore, logger } = makeApp();
    registerExecutionRoutes(app, {
      containerRegistry: registry,
      lockStore,
      callStore,
      callDispatcherProvider: () => undefined,
      logger,
    });

    const res = await app.request("/locks/acquire", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}), // missing secret field → 400
    });

    // Should be 400 (validation error), not 404 (route not found)
    expect(res.status).toBe(400);
  });

  it("registers GET /locks/list (returns 400 or accessible)", async () => {
    const { app, registry, lockStore, callStore, logger } = makeApp();
    registerExecutionRoutes(app, {
      containerRegistry: registry,
      lockStore,
      callStore,
      callDispatcherProvider: () => undefined,
      logger,
    });

    const res = await app.request("/locks/list", {
      method: "GET",
    });

    // Should be 400 (no secret), not 404 (route not found)
    expect(res.status).toBe(400);
  });

  it("registers GET /locks/status by default (not 404)", async () => {
    const { app, registry, lockStore, callStore, logger } = makeApp();
    registerExecutionRoutes(app, {
      containerRegistry: registry,
      lockStore,
      callStore,
      callDispatcherProvider: () => undefined,
      logger,
    });

    const res = await app.request("/locks/status");
    // /locks/status returns {"locks":[]} when accessible
    expect(res.status).not.toBe(404);
  });

  it("skipStatusEndpoint=true makes /locks/status return 404", async () => {
    const { app, registry, lockStore, callStore, logger } = makeApp();
    registerExecutionRoutes(app, {
      containerRegistry: registry,
      lockStore,
      callStore,
      callDispatcherProvider: () => undefined,
      logger,
      skipStatusEndpoint: true,
    });

    const res = await app.request("/locks/status");
    expect(res.status).toBe(404);
  });

  // ── Call routes registered ────────────────────────────────────────────────

  it("registers POST /calls (returns 400, not 404)", async () => {
    const { app, registry, lockStore, callStore, logger } = makeApp();
    registerExecutionRoutes(app, {
      containerRegistry: registry,
      lockStore,
      callStore,
      callDispatcherProvider: () => undefined,
      logger,
    });

    const res = await app.request("/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}), // missing secret → 400
    });

    expect(res.status).toBe(400);
  });

  it("registers GET /calls/:callId (returns 400, not 404)", async () => {
    const { app, registry, lockStore, callStore, logger } = makeApp();
    registerExecutionRoutes(app, {
      containerRegistry: registry,
      lockStore,
      callStore,
      callDispatcherProvider: () => undefined,
      logger,
    });

    const res = await app.request("/calls/some-id-without-secret");
    // Missing secret in query → 400
    expect(res.status).toBe(400);
  });

  // ── Signal routes registered ──────────────────────────────────────────────

  it("registers POST /signals/status (returns 400, not 404)", async () => {
    const { app, registry, lockStore, callStore, logger } = makeApp();
    registerExecutionRoutes(app, {
      containerRegistry: registry,
      lockStore,
      callStore,
      callDispatcherProvider: () => undefined,
      logger,
    });

    const res = await app.request("/signals/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}), // missing secret → 400
    });

    expect(res.status).toBe(400);
  });

  it("registers POST /signals/rerun (returns 400, not 404)", async () => {
    const { app, registry, lockStore, callStore, logger } = makeApp();
    registerExecutionRoutes(app, {
      containerRegistry: registry,
      lockStore,
      callStore,
      callDispatcherProvider: () => undefined,
      logger,
    });

    const res = await app.request("/signals/rerun", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  // ── Route coexistence ─────────────────────────────────────────────────────

  it("all route groups work together on the same Hono app", async () => {
    const { app, registry, lockStore, callStore, logger } = makeApp();
    registerExecutionRoutes(app, {
      containerRegistry: registry,
      lockStore,
      callStore,
      callDispatcherProvider: () => undefined,
      logger,
    });

    // Lock route
    const lockRes = await app.request("/locks/acquire", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(lockRes.status).toBe(400);

    // Call route
    const callRes = await app.request("/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(callRes.status).toBe(400);

    // Signal route
    const signalRes = await app.request("/signals/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(signalRes.status).toBe(400);
  });
});
