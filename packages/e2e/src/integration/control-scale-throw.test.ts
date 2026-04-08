/**
 * Integration tests: control/routes/control.ts scale endpoint throw paths — no Docker required.
 *
 * The existing control-scale-ops-direct.test.ts covers the 400/200/500(false)/404 cases
 * for project and agent scale. The existing control-routes-direct.test.ts covers the
 * 503 (not provided) case. This file covers the remaining uncovered throw paths:
 *
 *   - POST /control/project/scale — updateProjectScale throws → 500 with error message
 *   - POST /control/agents/:name/scale — updateAgentScale throws → 500 with error message
 *
 * Both routes have a catch block:
 *   catch (error) {
 *     const message = error instanceof Error ? error.message : String(error);
 *     logger?.error(...)
 *     return c.json({ error: `Failed to update ... scale: ${message}` }, 500);
 *   }
 *
 * Covers:
 *   - control/routes/control.ts: POST /control/project/scale — updateProjectScale throws Error → 500
 *   - control/routes/control.ts: POST /control/project/scale — error message includes thrown message
 *   - control/routes/control.ts: POST /control/project/scale — non-Error throw (string) → 500
 *   - control/routes/control.ts: POST /control/agents/:name/scale — updateAgentScale throws Error → 500
 *   - control/routes/control.ts: POST /control/agents/:name/scale — error message includes agent name context
 *   - control/routes/control.ts: POST /control/agents/:name/scale — non-Error throw (string) → 500
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

async function postScale(app: any, path: string, scale: number) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scale }),
  });
}

describe(
  "integration: control/routes/control.ts scale throw paths — no Docker required",
  { timeout: 15_000 },
  () => {
    // ── POST /control/project/scale — updateProjectScale throws ───────────────

    it("POST /control/project/scale → 500 when updateProjectScale throws an Error", async () => {
      const app = new Hono();
      const logger = makeLogger();
      const updateProjectScale = vi.fn(async () => {
        throw new Error("database write failed");
      });
      registerControlRoutes(app, makeBaseDeps({ updateProjectScale, logger }));

      const res = await postScale(app, "/control/project/scale", 3);
      expect(res.status).toBe(500);
    });

    it("POST /control/project/scale throw → error body contains thrown message", async () => {
      const app = new Hono();
      const updateProjectScale = vi.fn(async () => {
        throw new Error("database write failed");
      });
      registerControlRoutes(app, makeBaseDeps({ updateProjectScale }));

      const res = await postScale(app, "/control/project/scale", 3);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("database write failed");
    });

    it("POST /control/project/scale throw → logs error", async () => {
      const app = new Hono();
      const logger = makeLogger();
      const updateProjectScale = vi.fn(async () => {
        throw new Error("scale update error");
      });
      registerControlRoutes(app, makeBaseDeps({ updateProjectScale, logger }));

      await postScale(app, "/control/project/scale", 2);
      expect(logger.error).toHaveBeenCalled();
    });

    it("POST /control/project/scale throw → non-Error (string) → 500 with stringified message", async () => {
      const app = new Hono();
      const updateProjectScale = vi.fn(async () => {
        // eslint-disable-next-line no-throw-literal
        throw "string-error";
      });
      registerControlRoutes(app, makeBaseDeps({ updateProjectScale }));

      const res = await postScale(app, "/control/project/scale", 1);
      expect(res.status).toBe(500);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("string-error");
    });

    // ── POST /control/agents/:name/scale — updateAgentScale throws ────────────

    it("POST /control/agents/:name/scale → 500 when updateAgentScale throws an Error", async () => {
      const app = new Hono();
      const updateAgentScale = vi.fn(async () => {
        throw new Error("agent scale update failed");
      });
      registerControlRoutes(app, makeBaseDeps({ updateAgentScale }));

      const res = await postScale(app, "/control/agents/my-agent/scale", 2);
      expect(res.status).toBe(500);
    });

    it("POST /control/agents/:name/scale throw → error body contains thrown message", async () => {
      const app = new Hono();
      const updateAgentScale = vi.fn(async () => {
        throw new Error("agent scale update failed");
      });
      registerControlRoutes(app, makeBaseDeps({ updateAgentScale }));

      const res = await postScale(app, "/control/agents/my-agent/scale", 2);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("agent scale update failed");
    });

    it("POST /control/agents/:name/scale throw → logs error with agent name", async () => {
      const app = new Hono();
      const logger = makeLogger();
      const updateAgentScale = vi.fn(async () => {
        throw new Error("scale error");
      });
      registerControlRoutes(app, makeBaseDeps({ updateAgentScale, logger }));

      await postScale(app, "/control/agents/target-agent/scale", 3);
      expect(logger.error).toHaveBeenCalled();
      // The error log should include the agent name
      const errorArgs = logger.error.mock.calls[0];
      const argsStr = JSON.stringify(errorArgs);
      expect(argsStr).toContain("target-agent");
    });

    it("POST /control/agents/:name/scale throw → non-Error (string) → 500 with stringified message", async () => {
      const app = new Hono();
      const updateAgentScale = vi.fn(async () => {
        // eslint-disable-next-line no-throw-literal
        throw "agent-string-error";
      });
      registerControlRoutes(app, makeBaseDeps({ updateAgentScale }));

      const res = await postScale(app, "/control/agents/my-agent/scale", 1);
      expect(res.status).toBe(500);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("agent-string-error");
    });
  },
);
