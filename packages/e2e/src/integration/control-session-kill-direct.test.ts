/**
 * Integration tests: control/routes/control.ts POST /control/kill/:sessionId and
 * POST /control/stop success/404 paths — no Docker required.
 *
 * Covers the remaining branches:
 *   - POST /control/kill/:sessionId — killSession returns true → 200 success
 *   - POST /control/kill/:sessionId — killSession returns false → 404 not found
 *   - POST /control/stop — stopScheduler provided → 200 { success: true }
 *   - GET /control/sessions — without statusTracker → 503
 *   - GET /control/status — without statusTracker → 503
 *
 * Covers:
 *   - control/routes/control.ts: POST /control/kill/:sessionId → 200 (success)
 *   - control/routes/control.ts: POST /control/kill/:sessionId → 404 (not found)
 *   - control/routes/control.ts: POST /control/stop → 200 (success)
 *   - control/routes/control.ts: GET /control/sessions → 503 (no statusTracker)
 *   - control/routes/control.ts: GET /control/status → 503 (no statusTracker)
 */

import { describe, it, expect, vi } from "vitest";

const { Hono } = await import(
  /* @vite-ignore */
  "/tmp/repo/node_modules/hono/dist/index.js"
);

const {
  registerControlRoutes,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/control/routes/control.js"
);

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
}

describe(
  "integration: control/routes/control.ts kill instance, stop, instances, status paths — no Docker required",
  { timeout: 15_000 },
  () => {
    // ── kill instance success ──────────────────────────────────────────────────

    it("POST /control/kill/:sessionId → 200 success when killSession returns true", async () => {
      const app = new Hono();
      const killSession = vi.fn(async () => true);
      registerControlRoutes(app, {
        killSession,
        killAgent: vi.fn(async () => null),
        pauseScheduler: vi.fn(async () => {}),
        resumeScheduler: vi.fn(async () => {}),
        logger: makeLogger(),
      });

      const res = await app.request("/control/kill/inst-abc123", { method: "POST" });
      expect(res.status).toBe(200);
      const body = await res.json() as { success: boolean; message: string };
      expect(body.success).toBe(true);
      expect(body.message).toContain("inst-abc123");
    });

    // ── kill instance 404 ─────────────────────────────────────────────────────

    it("POST /control/kill/:sessionId → 404 when killSession returns false", async () => {
      const app = new Hono();
      const killSession = vi.fn(async () => false);
      registerControlRoutes(app, {
        killSession,
        killAgent: vi.fn(async () => null),
        pauseScheduler: vi.fn(async () => {}),
        resumeScheduler: vi.fn(async () => {}),
        logger: makeLogger(),
      });

      const res = await app.request("/control/kill/no-such-instance", { method: "POST" });
      expect(res.status).toBe(404);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("no-such-instance");
    });

    // ── stop scheduler success ─────────────────────────────────────────────────

    it("POST /control/stop → 200 success when stopScheduler is provided", async () => {
      const app = new Hono();
      const stopScheduler = vi.fn(async () => {});
      registerControlRoutes(app, {
        killSession: vi.fn(async () => false),
        killAgent: vi.fn(async () => null),
        pauseScheduler: vi.fn(async () => {}),
        resumeScheduler: vi.fn(async () => {}),
        stopScheduler,
        logger: makeLogger(),
      });

      const res = await app.request("/control/stop", { method: "POST" });
      expect(res.status).toBe(200);
      const body = await res.json() as { success: boolean; message: string };
      expect(body.success).toBe(true);
    });

    // ── GET /control/sessions — no statusTracker → 503 ───────────────────────

    it("GET /control/sessions → 503 when no statusTracker provided", async () => {
      const app = new Hono();
      registerControlRoutes(app, {
        killSession: vi.fn(async () => false),
        killAgent: vi.fn(async () => null),
        pauseScheduler: vi.fn(async () => {}),
        resumeScheduler: vi.fn(async () => {}),
        logger: makeLogger(),
        // No statusTracker
      });

      const res = await app.request("/control/sessions");
      expect(res.status).toBe(503);
    });

    // ── GET /control/status — no statusTracker → 503 ──────────────────────────

    it("GET /control/status → 503 when no statusTracker provided", async () => {
      const app = new Hono();
      registerControlRoutes(app, {
        killSession: vi.fn(async () => false),
        killAgent: vi.fn(async () => null),
        pauseScheduler: vi.fn(async () => {}),
        resumeScheduler: vi.fn(async () => {}),
        logger: makeLogger(),
        // No statusTracker
      });

      const res = await app.request("/control/status");
      expect(res.status).toBe(503);
    });
  },
);
