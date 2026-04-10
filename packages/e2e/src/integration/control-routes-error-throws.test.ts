/**
 * Integration tests: control/routes/control.ts error throw paths — no Docker required.
 *
 * The existing tests cover the "not provided" (503) case and success/failure
 * return-value paths for the control routes, but do NOT cover the catch blocks
 * that are hit when the underlying dep functions THROW. This file covers:
 *
 *   1. POST /control/agents/:name/resume — enableAgent throws → 500 + error body
 *   2. POST /control/agents/:name/kill  — killAgent throws → 500 + error body
 *   3. POST /control/project/scale      — updateProjectScale throws → 500 + error body
 *   4. POST /control/agents/:name/scale — updateAgentScale throws → 500 + error body
 *
 * These exercise the catch blocks at lines 211, 230, 282, and 310 in
 * control/routes/control.ts, which are currently uncovered branches.
 *
 * Covers:
 *   - control/routes/control.ts: POST /control/agents/:name/resume — enableAgent throws → 500
 *   - control/routes/control.ts: POST /control/agents/:name/kill — killAgent throws → 500
 *   - control/routes/control.ts: POST /control/project/scale — updateProjectScale throws → 500
 *   - control/routes/control.ts: POST /control/agents/:name/scale — updateAgentScale throws → 500
 *   - control/routes/control.ts: logger.error called with error message on each throw path
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
    killSession: vi.fn(async () => false),
    killAgent: vi.fn(async () => null),
    pauseScheduler: vi.fn(async () => {}),
    resumeScheduler: vi.fn(async () => {}),
    logger: makeLogger(),
    ...overrides,
  };
}

describe(
  "integration: control/routes/control.ts error throw catch paths — no Docker required",
  { timeout: 15_000 },
  () => {
    // ── per-agent resume: enableAgent throws ───────────────────────────────

    it("POST /control/agents/:name/resume — enableAgent throws → 500", async () => {
      const app = new Hono();
      const logger = makeLogger();
      const enableAgent = vi.fn(async () => {
        throw new Error("Database connection failed");
      });
      registerControlRoutes(app, makeBaseDeps({ enableAgent, logger }));

      const res = await app.request("/control/agents/my-agent/resume", {
        method: "POST",
      });
      expect(res.status).toBe(500);
    });

    it("POST /control/agents/:name/resume — enableAgent throws → error body mentions reason", async () => {
      const app = new Hono();
      const logger = makeLogger();
      const enableAgent = vi.fn(async () => {
        throw new Error("Resume operation failed");
      });
      registerControlRoutes(app, makeBaseDeps({ enableAgent, logger }));

      const res = await app.request("/control/agents/my-agent/resume", {
        method: "POST",
      });
      const body = await res.json() as { error: string };
      expect(body.error).toBeTruthy();
      expect(body.error).toContain("Resume operation failed");
    });

    it("POST /control/agents/:name/resume — enableAgent throws → logger.error called", async () => {
      const app = new Hono();
      const logger = makeLogger();
      const enableAgent = vi.fn(async () => {
        throw new Error("unexpected failure");
      });
      registerControlRoutes(app, makeBaseDeps({ enableAgent, logger }));

      await app.request("/control/agents/my-agent/resume", { method: "POST" });
      expect(logger.error).toHaveBeenCalledOnce();
    });

    // ── per-agent kill: killAgent throws ──────────────────────────────────

    it("POST /control/agents/:name/kill — killAgent throws → 500", async () => {
      const app = new Hono();
      const logger = makeLogger();
      const killAgent = vi.fn(async () => {
        throw new Error("Cannot kill: scheduler is shutting down");
      });
      registerControlRoutes(app, makeBaseDeps({ killAgent, logger }));

      const res = await app.request("/control/agents/my-agent/kill", {
        method: "POST",
      });
      expect(res.status).toBe(500);
    });

    it("POST /control/agents/:name/kill — killAgent throws → error body mentions reason", async () => {
      const app = new Hono();
      const logger = makeLogger();
      const killAgent = vi.fn(async () => {
        throw new Error("Kill operation failed");
      });
      registerControlRoutes(app, makeBaseDeps({ killAgent, logger }));

      const res = await app.request("/control/agents/my-agent/kill", {
        method: "POST",
      });
      const body = await res.json() as { error: string };
      expect(body.error).toBeTruthy();
      expect(body.error).toContain("Kill operation failed");
    });

    it("POST /control/agents/:name/kill — killAgent throws → logger.error called", async () => {
      const app = new Hono();
      const logger = makeLogger();
      const killAgent = vi.fn(async () => {
        throw new Error("internal kill error");
      });
      registerControlRoutes(app, makeBaseDeps({ killAgent, logger }));

      await app.request("/control/agents/my-agent/kill", { method: "POST" });
      expect(logger.error).toHaveBeenCalledOnce();
    });

    // ── project scale: updateProjectScale throws ──────────────────────────

    it("POST /control/project/scale — updateProjectScale throws → 500", async () => {
      const app = new Hono();
      const logger = makeLogger();
      const updateProjectScale = vi.fn(async () => {
        throw new Error("Failed to write config.toml");
      });
      registerControlRoutes(app, makeBaseDeps({ updateProjectScale, logger }));

      const res = await app.request("/control/project/scale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scale: 3 }),
      });
      expect(res.status).toBe(500);
    });

    it("POST /control/project/scale — updateProjectScale throws → error body mentions reason", async () => {
      const app = new Hono();
      const logger = makeLogger();
      const updateProjectScale = vi.fn(async () => {
        throw new Error("Config write error");
      });
      registerControlRoutes(app, makeBaseDeps({ updateProjectScale, logger }));

      const res = await app.request("/control/project/scale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scale: 2 }),
      });
      const body = await res.json() as { error: string };
      expect(body.error).toBeTruthy();
      expect(body.error).toContain("Config write error");
    });

    it("POST /control/project/scale — updateProjectScale throws → logger.error called", async () => {
      const app = new Hono();
      const logger = makeLogger();
      const updateProjectScale = vi.fn(async () => {
        throw new Error("scale update failure");
      });
      registerControlRoutes(app, makeBaseDeps({ updateProjectScale, logger }));

      await app.request("/control/project/scale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scale: 2 }),
      });
      expect(logger.error).toHaveBeenCalledOnce();
    });

    // ── agent scale: updateAgentScale throws ──────────────────────────────

    it("POST /control/agents/:name/scale — updateAgentScale throws → 500", async () => {
      const app = new Hono();
      const logger = makeLogger();
      const updateAgentScale = vi.fn(async () => {
        throw new Error("Cannot update scale for agent");
      });
      registerControlRoutes(app, makeBaseDeps({ updateAgentScale, logger }));

      const res = await app.request("/control/agents/my-agent/scale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scale: 2 }),
      });
      expect(res.status).toBe(500);
    });

    it("POST /control/agents/:name/scale — updateAgentScale throws → error body mentions reason", async () => {
      const app = new Hono();
      const logger = makeLogger();
      const updateAgentScale = vi.fn(async () => {
        throw new Error("Agent scale write failed");
      });
      registerControlRoutes(app, makeBaseDeps({ updateAgentScale, logger }));

      const res = await app.request("/control/agents/my-agent/scale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scale: 2 }),
      });
      const body = await res.json() as { error: string };
      expect(body.error).toBeTruthy();
      expect(body.error).toContain("Agent scale write failed");
    });

    it("POST /control/agents/:name/scale — updateAgentScale throws → logger.error called", async () => {
      const app = new Hono();
      const logger = makeLogger();
      const updateAgentScale = vi.fn(async () => {
        throw new Error("unexpected scale error");
      });
      registerControlRoutes(app, makeBaseDeps({ updateAgentScale, logger }));

      await app.request("/control/agents/my-agent/scale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scale: 3 }),
      });
      expect(logger.error).toHaveBeenCalledOnce();
    });
  },
);
