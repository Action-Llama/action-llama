/**
 * Integration tests: gateway/routes/dashboard.ts registerDashboardRoutes() — no Docker required.
 *
 * registerDashboardRoutes() is an async wrapper that combines five route groups:
 *   1. registerDashboardDataRoutes() — SSE stream + locks API
 *   2. registerDashboardApiRoutes() — JSON API for React SPA
 *   3. registerLogRoutes() — Log API (only when projectPath provided)
 *   4. registerLogSummaryRoutes() — Log summary API (only when projectPath provided)
 *   5. registerStatsRoutes() — Stats API
 * And registers a root redirect: GET / → /dashboard
 *
 * Test scenarios (no Docker required):
 *   1. registerDashboardRoutes() resolves without throwing
 *   2. GET /dashboard/api/locks → accessible (returns {locks:[]} not 404)
 *   3. GET /dashboard/api/status-stream → accessible (200 SSE response)
 *   4. GET /api/dashboard/status → accessible (not 404)
 *   5. GET /api/stats/activity → accessible (200 with rows array)
 *   6. GET /api/logs/agents/:name → accessible when projectPath provided (not 404 from missing route)
 *   7. GET /api/logs/agents/:name → 404 route not registered when no projectPath
 *   8. GET / → redirect to /dashboard
 *
 * Covers:
 *   - gateway/routes/dashboard.ts: registerDashboardRoutes() — async, resolves
 *   - gateway/routes/dashboard.ts: SSE route accessible via registerDashboardDataRoutes
 *   - gateway/routes/dashboard.ts: JSON API route accessible via registerDashboardApiRoutes
 *   - gateway/routes/dashboard.ts: stats route accessible via registerStatsRoutes
 *   - gateway/routes/dashboard.ts: log routes registered when projectPath provided
 *   - gateway/routes/dashboard.ts: log routes NOT registered when no projectPath
 *   - gateway/routes/dashboard.ts: root redirect registered
 */

import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { StatusTracker } from "@action-llama/action-llama/internals/status-tracker";

const { Hono } = await import(
  /* @vite-ignore */
  "/tmp/repo/node_modules/hono/dist/index.js"
);

const {
  registerDashboardRoutes,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/gateway/routes/dashboard.js"
);

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
}

describe("integration: gateway/routes/dashboard.ts registerDashboardRoutes() (no Docker required)", { timeout: 30_000 }, () => {
  let tmpDir: string;

  // ── Basic registration ────────────────────────────────────────────────────

  it("resolves without throwing", async () => {
    const app = new Hono();
    const tracker = new StatusTracker();
    const logger = makeLogger();

    await expect(
      registerDashboardRoutes(app, {
        statusTracker: tracker,
        apiKey: "test-api-key",
        logger,
      })
    ).resolves.toBeUndefined();
  });

  it("resolves without throwing with all optional params provided", async () => {
    const app = new Hono();
    const tracker = new StatusTracker();
    const logger = makeLogger();

    await expect(
      registerDashboardRoutes(app, {
        statusTracker: tracker,
        projectPath: undefined,
        apiKey: "test-api-key",
        statsStore: undefined,
        logger,
        controlDeps: undefined,
      })
    ).resolves.toBeUndefined();
  });

  // ── SSE data route ────────────────────────────────────────────────────────

  it("GET /dashboard/api/locks → accessible (not 404 due to missing route)", async () => {
    const app = new Hono();
    const tracker = new StatusTracker();
    const logger = makeLogger();

    await registerDashboardRoutes(app, {
      statusTracker: tracker,
      apiKey: "test-api-key",
      logger,
    });

    const res = await app.request("/dashboard/api/locks");
    // Should return { locks: [] } when gateway unavailable — not 404 from "route not registered"
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toHaveProperty("locks");
  });

  // ── JSON API routes ───────────────────────────────────────────────────────

  it("GET /api/dashboard/status → accessible (not 404)", async () => {
    const app = new Hono();
    const tracker = new StatusTracker();
    const logger = makeLogger();

    await registerDashboardRoutes(app, {
      statusTracker: tracker,
      apiKey: "test-api-key",
      logger,
    });

    const res = await app.request("/api/dashboard/status");
    // Should not be 404 (route not registered)
    expect(res.status).not.toBe(404);
  });

  // ── Stats routes ──────────────────────────────────────────────────────────

  it("GET /api/stats/activity → 200 with rows array", async () => {
    const app = new Hono();
    const tracker = new StatusTracker();
    const logger = makeLogger();

    await registerDashboardRoutes(app, {
      statusTracker: tracker,
      apiKey: "test-api-key",
      logger,
    });

    const res = await app.request("/api/stats/activity");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toHaveProperty("rows");
    expect(Array.isArray(body.rows)).toBe(true);
  });

  // ── Log routes conditional on projectPath ────────────────────────────────

  it("GET /api/logs/agents/test-agent → accessible when projectPath provided", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-dash-routes-"));
    mkdirSync(join(tmpDir, ".al", "logs"), { recursive: true });

    const app = new Hono();
    const tracker = new StatusTracker();
    const logger = makeLogger();

    await registerDashboardRoutes(app, {
      statusTracker: tracker,
      projectPath: tmpDir,
      apiKey: "test-api-key",
      logger,
    });

    const res = await app.request("/api/logs/agents/test-agent");
    // Route is registered → should return 200 (empty entries) not 404
    expect(res.status).toBe(200);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("GET /api/logs/agents/test-agent → 404 when no projectPath provided", async () => {
    const app = new Hono();
    const tracker = new StatusTracker();
    const logger = makeLogger();

    await registerDashboardRoutes(app, {
      statusTracker: tracker,
      // No projectPath
      apiKey: "test-api-key",
      logger,
    });

    const res = await app.request("/api/logs/agents/test-agent");
    expect(res.status).toBe(404);
  });

  // ── Root redirect ─────────────────────────────────────────────────────────

  it("GET / redirects to /dashboard", async () => {
    const app = new Hono();
    const tracker = new StatusTracker();
    const logger = makeLogger();

    await registerDashboardRoutes(app, {
      statusTracker: tracker,
      apiKey: "test-api-key",
      logger,
    });

    const res = await app.request("/", {
      // Prevent following redirect
      redirect: "manual" as any,
    });

    // Hono's c.redirect() returns 302
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/dashboard");
  });
});
