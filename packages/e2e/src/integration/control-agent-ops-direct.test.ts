/**
 * Integration tests: control/routes/control.ts agent enable/disable/pause/resume/kill — no Docker required.
 *
 * The existing tests (control-routes-direct.test.ts) only test the "not provided" (503)
 * and "throws" (500) paths for these routes. The success (200) and "not found" (404)
 * paths are not yet tested without Docker.
 *
 * Covers:
 *   - control/routes/control.ts: POST /control/agents/:name/enable — success (enableAgent returns true) → 200
 *   - control/routes/control.ts: POST /control/agents/:name/enable — not found (enableAgent returns false) → 404
 *   - control/routes/control.ts: POST /control/agents/:name/disable — success → 200
 *   - control/routes/control.ts: POST /control/agents/:name/disable — not found → 404
 *   - control/routes/control.ts: POST /control/agents/:name/pause — success → 200
 *   - control/routes/control.ts: POST /control/agents/:name/pause — not found → 404
 *   - control/routes/control.ts: POST /control/agents/:name/resume — success → 200
 *   - control/routes/control.ts: POST /control/agents/:name/resume — not found → 404
 *   - control/routes/control.ts: POST /control/agents/:name/kill — success → 200
 *   - control/routes/control.ts: POST /control/agents/:name/kill — agent not found → 404
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

function makeBaseDeps(overrides?: Record<string, unknown>) {
  return {
    killInstance: vi.fn(async () => false),
    killAgent: vi.fn(async () => null),
    pauseScheduler: vi.fn(async () => {}),
    resumeScheduler: vi.fn(async () => {}),
    logger: makeLogger(),
    ...overrides,
  };
}

describe(
  "integration: control/routes/control.ts agent operations success and 404 paths — no Docker required",
  { timeout: 15_000 },
  () => {
    // ── enable ──────────────────────────────────────────────────────────────────

    it("POST /control/agents/:name/enable → 200 success when enableAgent returns true", async () => {
      const app = new Hono();
      const enableAgent = vi.fn(async () => true);
      registerControlRoutes(app, makeBaseDeps({ enableAgent }));

      const res = await app.request("/control/agents/my-agent/enable", { method: "POST" });
      expect(res.status).toBe(200);
      const body = await res.json() as { success: boolean; message: string };
      expect(body.success).toBe(true);
      expect(body.message).toContain("my-agent");
    });

    it("POST /control/agents/:name/enable → 404 when enableAgent returns false (agent not found)", async () => {
      const app = new Hono();
      const enableAgent = vi.fn(async () => false);
      registerControlRoutes(app, makeBaseDeps({ enableAgent }));

      const res = await app.request("/control/agents/unknown-agent/enable", { method: "POST" });
      expect(res.status).toBe(404);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("unknown-agent");
    });

    // ── disable ─────────────────────────────────────────────────────────────────

    it("POST /control/agents/:name/disable → 200 success when disableAgent returns true", async () => {
      const app = new Hono();
      const disableAgent = vi.fn(async () => true);
      registerControlRoutes(app, makeBaseDeps({ disableAgent }));

      const res = await app.request("/control/agents/my-agent/disable", { method: "POST" });
      expect(res.status).toBe(200);
      const body = await res.json() as { success: boolean };
      expect(body.success).toBe(true);
    });

    it("POST /control/agents/:name/disable → 404 when disableAgent returns false", async () => {
      const app = new Hono();
      const disableAgent = vi.fn(async () => false);
      registerControlRoutes(app, makeBaseDeps({ disableAgent }));

      const res = await app.request("/control/agents/ghost-agent/disable", { method: "POST" });
      expect(res.status).toBe(404);
    });

    // ── pause ───────────────────────────────────────────────────────────────────

    it("POST /control/agents/:name/pause → 200 success when disableAgent returns true", async () => {
      const app = new Hono();
      const disableAgent = vi.fn(async () => true);
      registerControlRoutes(app, makeBaseDeps({ disableAgent }));

      const res = await app.request("/control/agents/my-agent/pause", { method: "POST" });
      expect(res.status).toBe(200);
      const body = await res.json() as { success: boolean; message: string };
      expect(body.success).toBe(true);
      expect(body.message).toContain("paused");
    });

    it("POST /control/agents/:name/pause → 404 when disableAgent returns false", async () => {
      const app = new Hono();
      const disableAgent = vi.fn(async () => false);
      registerControlRoutes(app, makeBaseDeps({ disableAgent }));

      const res = await app.request("/control/agents/nobody/pause", { method: "POST" });
      expect(res.status).toBe(404);
    });

    // ── resume ──────────────────────────────────────────────────────────────────

    it("POST /control/agents/:name/resume → 200 success when enableAgent returns true", async () => {
      const app = new Hono();
      const enableAgent = vi.fn(async () => true);
      registerControlRoutes(app, makeBaseDeps({ enableAgent }));

      const res = await app.request("/control/agents/my-agent/resume", { method: "POST" });
      expect(res.status).toBe(200);
      const body = await res.json() as { success: boolean; message: string };
      expect(body.success).toBe(true);
      expect(body.message).toContain("resumed");
    });

    it("POST /control/agents/:name/resume → 404 when enableAgent returns false", async () => {
      const app = new Hono();
      const enableAgent = vi.fn(async () => false);
      registerControlRoutes(app, makeBaseDeps({ enableAgent }));

      const res = await app.request("/control/agents/nobody/resume", { method: "POST" });
      expect(res.status).toBe(404);
    });

    // ── kill agent ──────────────────────────────────────────────────────────────

    it("POST /control/agents/:name/kill → 200 success when killAgent returns { killed: N }", async () => {
      const app = new Hono();
      const killAgent = vi.fn(async () => ({ killed: 2 }));
      registerControlRoutes(app, makeBaseDeps({ killAgent }));

      const res = await app.request("/control/agents/my-agent/kill", { method: "POST" });
      expect(res.status).toBe(200);
      const body = await res.json() as { success: boolean };
      expect(body.success).toBe(true);
    });

    it("POST /control/agents/:name/kill → 404 when killAgent returns null (not found)", async () => {
      const app = new Hono();
      const killAgent = vi.fn(async () => null);
      registerControlRoutes(app, makeBaseDeps({ killAgent }));

      const res = await app.request("/control/agents/unknown-agent/kill", { method: "POST" });
      expect(res.status).toBe(404);
    });
  },
);
