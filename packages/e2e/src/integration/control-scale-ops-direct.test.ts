/**
 * Integration tests: control/routes/control.ts scale update operations — no Docker required.
 *
 * The existing tests only cover the "not provided" (503) case for scale updates.
 * This file covers the remaining branches:
 *   - POST /control/project/scale — invalid input (scale < 1) → 400
 *   - POST /control/project/scale — success → 200
 *   - POST /control/project/scale — failure (returns false) → 500
 *   - POST /control/agents/:name/scale — invalid input → 400
 *   - POST /control/agents/:name/scale — success → 200
 *   - POST /control/agents/:name/scale — not found (returns false) → 404
 *
 * Covers:
 *   - control/routes/control.ts: POST /control/project/scale — invalid scale → 400
 *   - control/routes/control.ts: POST /control/project/scale — success → 200
 *   - control/routes/control.ts: POST /control/project/scale — failure → 500
 *   - control/routes/control.ts: POST /control/agents/:name/scale — invalid scale → 400
 *   - control/routes/control.ts: POST /control/agents/:name/scale — success → 200
 *   - control/routes/control.ts: POST /control/agents/:name/scale — not found → 404
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
  "integration: control/routes/control.ts scale endpoints — no Docker required",
  { timeout: 15_000 },
  () => {
    // ── project scale ─────────────────────────────────────────────────────────

    it("POST /control/project/scale → 400 for scale=0 (not a positive integer)", async () => {
      const app = new Hono();
      const updateProjectScale = vi.fn(async () => true);
      registerControlRoutes(app, makeBaseDeps({ updateProjectScale }));

      const res = await app.request("/control/project/scale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scale: 0 }),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("positive integer");
    });

    it("POST /control/project/scale → 400 for scale=-1", async () => {
      const app = new Hono();
      const updateProjectScale = vi.fn(async () => true);
      registerControlRoutes(app, makeBaseDeps({ updateProjectScale }));

      const res = await app.request("/control/project/scale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scale: -1 }),
      });
      expect(res.status).toBe(400);
    });

    it("POST /control/project/scale → 200 success when updateProjectScale returns true", async () => {
      const app = new Hono();
      const updateProjectScale = vi.fn(async () => true);
      registerControlRoutes(app, makeBaseDeps({ updateProjectScale }));

      const res = await app.request("/control/project/scale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scale: 5 }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { success: boolean; message: string };
      expect(body.success).toBe(true);
      expect(body.message).toContain("5");
    });

    it("POST /control/project/scale → 500 when updateProjectScale returns false", async () => {
      const app = new Hono();
      const updateProjectScale = vi.fn(async () => false);
      registerControlRoutes(app, makeBaseDeps({ updateProjectScale }));

      const res = await app.request("/control/project/scale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scale: 3 }),
      });
      expect(res.status).toBe(500);
    });

    // ── agent scale ───────────────────────────────────────────────────────────

    it("POST /control/agents/:name/scale → 400 for scale=0", async () => {
      const app = new Hono();
      const updateAgentScale = vi.fn(async () => true);
      registerControlRoutes(app, makeBaseDeps({ updateAgentScale }));

      const res = await app.request("/control/agents/my-agent/scale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scale: 0 }),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("positive integer");
    });

    it("POST /control/agents/:name/scale → 200 success when updateAgentScale returns true", async () => {
      const app = new Hono();
      const updateAgentScale = vi.fn(async () => true);
      registerControlRoutes(app, makeBaseDeps({ updateAgentScale }));

      const res = await app.request("/control/agents/my-agent/scale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scale: 3 }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { success: boolean; message: string };
      expect(body.success).toBe(true);
      expect(body.message).toContain("my-agent");
      expect(body.message).toContain("3");
    });

    it("POST /control/agents/:name/scale → 404 when updateAgentScale returns false (not found)", async () => {
      const app = new Hono();
      const updateAgentScale = vi.fn(async () => false);
      registerControlRoutes(app, makeBaseDeps({ updateAgentScale }));

      const res = await app.request("/control/agents/ghost-agent/scale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scale: 2 }),
      });
      expect(res.status).toBe(404);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("ghost-agent");
    });
  },
);
