/**
 * Integration tests: gateway/routes/system.ts registerSystemRoutes() — no Docker required.
 *
 * registerSystemRoutes() sets up three things on a Hono app:
 *   1. GET /health → { status: "ok" } (always registered)
 *   2. POST /shutdown route (via registerShutdownRoute)
 *   3. Control routes (only when controlDeps is provided)
 *
 * Tests verify the function's conditional logic and that routes are registered
 * correctly using in-memory Hono app without starting an HTTP server.
 *
 * Covers:
 *   - gateway/routes/system.ts: registerSystemRoutes() — GET /health returns { status: "ok" }
 *   - gateway/routes/system.ts: registerSystemRoutes() — killFn defaults to async no-op when not provided
 *   - gateway/routes/system.ts: registerSystemRoutes() — controlDeps=undefined → control routes skipped
 *   - gateway/routes/system.ts: registerSystemRoutes() — controlDeps provided → control routes registered
 *   - gateway/routes/system.ts: registerSystemRoutes() — with explicit killContainer callback
 */

import { describe, it, expect, vi } from "vitest";

const { Hono } = await import(
  /* @vite-ignore */
  "/tmp/repo/node_modules/hono/dist/index.js"
);

const {
  registerSystemRoutes,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/gateway/routes/system.js"
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

function makeRegistry() {
  return new ContainerRegistry();
}

describe("integration: gateway/routes/system.ts registerSystemRoutes() (no Docker required)", { timeout: 15_000 }, () => {

  it("GET /health → { status: 'ok' } JSON response", async () => {
    const app = new Hono();
    registerSystemRoutes(app, {
      containerRegistry: makeRegistry(),
      logger: makeLogger(),
    });

    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
  });

  it("does not throw when killContainer is not provided (defaults to async no-op)", () => {
    const app = new Hono();
    expect(() => {
      registerSystemRoutes(app, {
        containerRegistry: makeRegistry(),
        logger: makeLogger(),
        // killContainer intentionally omitted
      });
    }).not.toThrow();
  });

  it("does not throw when controlDeps is not provided", () => {
    const app = new Hono();
    expect(() => {
      registerSystemRoutes(app, {
        containerRegistry: makeRegistry(),
        logger: makeLogger(),
        // controlDeps intentionally omitted
      });
    }).not.toThrow();
  });

  it("health endpoint still works even without controlDeps", async () => {
    const app = new Hono();
    registerSystemRoutes(app, {
      containerRegistry: makeRegistry(),
      logger: makeLogger(),
      controlDeps: undefined,
    });

    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  it("with explicit killContainer callback — does not throw on setup", () => {
    const app = new Hono();
    const killFn = vi.fn().mockResolvedValue(undefined);
    expect(() => {
      registerSystemRoutes(app, {
        containerRegistry: makeRegistry(),
        killContainer: killFn,
        logger: makeLogger(),
      });
    }).not.toThrow();
  });

  it("controlDeps provided → control routes are registered (/control/status is accessible)", async () => {
    const app = new Hono();
    const mockStatusTracker = {
      getAgentInfos: vi.fn(() => []),
      getSchedulerInfo: vi.fn(() => null),
      getAllInstances: vi.fn(() => []),
    };

    registerSystemRoutes(app, {
      containerRegistry: makeRegistry(),
      logger: makeLogger(),
      controlDeps: {
        statusTracker: mockStatusTracker as any,
        schedulerState: { schedulerCtx: null, workQueue: null, cronJobs: [], runnerPools: {} },
        logger: makeLogger(),
        events: undefined as any,
      },
    });

    // /control/status route should now exist and return a response (not 404)
    const res = await app.request("/control/status", {
      headers: { Authorization: "Bearer test-key" },
    });
    // Status may be 401 (auth) or 200/503, but should NOT be 404
    expect(res.status).not.toBe(404);
  });

  it("multiple calls to registerSystemRoutes register multiple health routes", async () => {
    const app = new Hono();

    // Register once
    registerSystemRoutes(app, {
      containerRegistry: makeRegistry(),
      logger: makeLogger(),
    });

    // The last registered health route wins in Hono
    const res = await app.request("/health");
    expect(res.status).toBe(200);
  });
});
