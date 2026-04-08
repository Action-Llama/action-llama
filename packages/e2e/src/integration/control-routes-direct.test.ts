/**
 * Integration tests: control/routes/control.ts error and fallback paths — no Docker required.
 *
 * registerControlRoutes() is tested here by constructing a Hono app directly
 * and exercising branches that are not covered by the gateway/harness-based tests:
 *
 *   1. POST /control/trigger/:name — triggerAgent not provided → 503
 *   2. POST /control/trigger/:name — triggerAgent returns "not found" string → 404
 *   3. POST /control/trigger/:name — triggerAgent returns other error string → 409
 *   4. POST /control/trigger/:name — triggerAgent throws → 500
 *   5. POST /control/trigger/:name — triggerAgent returns { instanceId } → 200
 *   6. POST /control/trigger/:name — with prompt in JSON body → prompt forwarded
 *   7. POST /control/stop — stopScheduler not provided → 503
 *   8. POST /control/pause — pauseScheduler throws → 500
 *   9. POST /control/resume — resumeScheduler throws → 500
 *  10. POST /control/kill/:instanceId — killInstance throws → 500
 *  11. POST /control/agents/:name/enable — enableAgent not provided → 503
 *  12. POST /control/agents/:name/disable — disableAgent not provided → 503
 *  13. POST /control/agents/:name/pause — disableAgent not provided → 503
 *  14. POST /control/agents/:name/resume — enableAgent not provided → 503
 *  15. POST /control/agents/:name/enable — enableAgent throws → 500
 *  16. POST /control/agents/:name/disable — disableAgent throws → 500
 *  17. POST /control/project/scale — updateProjectScale not provided → 503
 *  18. POST /control/agents/:name/scale — updateAgentScale not provided → 503
 *
 * Covers:
 *   - control/routes/control.ts: POST /control/trigger/:name — triggerAgent not provided → 503
 *   - control/routes/control.ts: POST /control/trigger/:name — "not found" result → 404
 *   - control/routes/control.ts: POST /control/trigger/:name — other error string → 409
 *   - control/routes/control.ts: POST /control/trigger/:name — throws → 500
 *   - control/routes/control.ts: POST /control/trigger/:name — instanceId result → 200
 *   - control/routes/control.ts: POST /control/trigger/:name — prompt forwarded to triggerAgent
 *   - control/routes/control.ts: POST /control/stop — stopScheduler absent → 503
 *   - control/routes/control.ts: POST /control/pause — throws → 500
 *   - control/routes/control.ts: POST /control/resume — throws → 500
 *   - control/routes/control.ts: POST /control/kill/:instanceId — throws → 500
 *   - control/routes/control.ts: POST /control/agents/:name/enable — not provided → 503
 *   - control/routes/control.ts: POST /control/agents/:name/disable — not provided → 503
 *   - control/routes/control.ts: POST /control/agents/:name/pause — not provided → 503
 *   - control/routes/control.ts: POST /control/agents/:name/resume — not provided → 503
 *   - control/routes/control.ts: POST /control/agents/:name/enable — throws → 500
 *   - control/routes/control.ts: POST /control/agents/:name/disable — throws → 500
 *   - control/routes/control.ts: POST /control/project/scale — not provided → 503
 *   - control/routes/control.ts: POST /control/agents/:name/scale — not provided → 503
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
  return {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  };
}

/** Build minimal ControlRoutesDeps with all optional fields absent. */
function makeMinimalDeps(overrides: Record<string, any> = {}): any {
  return {
    killInstance: vi.fn(async () => false),
    killAgent: vi.fn(async () => null),
    pauseScheduler: vi.fn(async () => {}),
    resumeScheduler: vi.fn(async () => {}),
    logger: makeLogger(),
    ...overrides,
  };
}

/** Create a Hono app with control routes registered. */
function makeApp(overrides: Record<string, any> = {}): ReturnType<typeof Hono> {
  const app = new Hono();
  registerControlRoutes(app, makeMinimalDeps(overrides));
  return app;
}

describe("integration: control/routes/control.ts direct tests (no Docker required)", { timeout: 20_000 }, () => {

  // ── POST /control/trigger/:name ───────────────────────────────────────────

  describe("POST /control/trigger/:name", () => {
    it("returns 503 when triggerAgent is not provided", async () => {
      const app = makeApp({ triggerAgent: undefined });
      const res = await app.request("/control/trigger/my-agent", { method: "POST" });
      expect(res.status).toBe(503);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("Trigger not available");
    });

    it("returns 404 when triggerAgent returns string containing 'not found'", async () => {
      const app = makeApp({
        triggerAgent: vi.fn(async () => "Agent my-agent not found"),
      });
      const res = await app.request("/control/trigger/my-agent", { method: "POST" });
      expect(res.status).toBe(404);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("not found");
    });

    it("returns 409 when triggerAgent returns a non-'not found' error string", async () => {
      const app = makeApp({
        triggerAgent: vi.fn(async () => "Agent is paused"),
      });
      const res = await app.request("/control/trigger/my-agent", { method: "POST" });
      expect(res.status).toBe(409);
      const body = await res.json() as { error: string };
      expect(body.error).toBe("Agent is paused");
    });

    it("returns 500 when triggerAgent throws an error", async () => {
      const app = makeApp({
        triggerAgent: vi.fn(async () => {
          throw new Error("Internal dispatch failure");
        }),
      });
      const res = await app.request("/control/trigger/my-agent", { method: "POST" });
      expect(res.status).toBe(500);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("Internal dispatch failure");
    });

    it("returns 200 with instanceId when triggerAgent succeeds", async () => {
      const fakeInstanceId = "test-instance-abc123";
      const app = makeApp({
        triggerAgent: vi.fn(async () => ({ instanceId: fakeInstanceId })),
      });
      const res = await app.request("/control/trigger/my-agent", { method: "POST" });
      expect(res.status).toBe(200);
      const body = await res.json() as { success: boolean; instanceId: string };
      expect(body.success).toBe(true);
      expect(body.instanceId).toBe(fakeInstanceId);
    });

    it("forwards prompt from JSON body to triggerAgent", async () => {
      const capturedCalls: Array<{ name: string; prompt: string | undefined }> = [];
      const app = makeApp({
        triggerAgent: vi.fn(async (name: string, prompt?: string) => {
          capturedCalls.push({ name, prompt });
          return { instanceId: "test-id" };
        }),
      });

      const res = await app.request("/control/trigger/my-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "run the diagnostics" }),
      });
      expect(res.status).toBe(200);
      expect(capturedCalls).toHaveLength(1);
      expect(capturedCalls[0].name).toBe("my-agent");
      expect(capturedCalls[0].prompt).toBe("run the diagnostics");
    });

    it("passes undefined prompt when body has no prompt field", async () => {
      const capturedCalls: Array<{ prompt: string | undefined }> = [];
      const app = makeApp({
        triggerAgent: vi.fn(async (_name: string, prompt?: string) => {
          capturedCalls.push({ prompt });
          return { instanceId: "test-id" };
        }),
      });

      const res = await app.request("/control/trigger/my-agent", { method: "POST" });
      expect(res.status).toBe(200);
      expect(capturedCalls[0].prompt).toBeUndefined();
    });
  });

  // ── POST /control/stop ────────────────────────────────────────────────────

  describe("POST /control/stop", () => {
    it("returns 503 when stopScheduler is not provided", async () => {
      const app = makeApp({ stopScheduler: undefined });
      const res = await app.request("/control/stop", { method: "POST" });
      expect(res.status).toBe(503);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("Stop not available");
    });

    it("returns 200 when stopScheduler is provided", async () => {
      const stopFn = vi.fn(async () => {});
      const app = makeApp({ stopScheduler: stopFn });
      const res = await app.request("/control/stop", { method: "POST" });
      expect(res.status).toBe(200);
      const body = await res.json() as { success: boolean };
      expect(body.success).toBe(true);
    });
  });

  // ── POST /control/pause + /control/resume error paths ────────────────────

  describe("POST /control/pause", () => {
    it("returns 500 when pauseScheduler throws", async () => {
      const app = makeApp({
        pauseScheduler: vi.fn(async () => {
          throw new Error("Cannot pause — already paused");
        }),
      });
      const res = await app.request("/control/pause", { method: "POST" });
      expect(res.status).toBe(500);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("Cannot pause");
    });
  });

  describe("POST /control/resume", () => {
    it("returns 500 when resumeScheduler throws", async () => {
      const app = makeApp({
        resumeScheduler: vi.fn(async () => {
          throw new Error("Cannot resume — scheduler crashed");
        }),
      });
      const res = await app.request("/control/resume", { method: "POST" });
      expect(res.status).toBe(500);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("Cannot resume");
    });
  });

  // ── POST /control/kill/:instanceId ───────────────────────────────────────

  describe("POST /control/kill/:instanceId", () => {
    it("returns 500 when killInstance throws", async () => {
      const app = makeApp({
        killInstance: vi.fn(async () => {
          throw new Error("Kill command failed: no such container");
        }),
      });
      const res = await app.request("/control/kill/some-instance-id", { method: "POST" });
      expect(res.status).toBe(500);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("no such container");
    });
  });

  // ── Per-agent enable/disable/pause/resume not-provided paths ─────────────

  describe("POST /control/agents/:name/enable — not provided", () => {
    it("returns 503 when enableAgent is not provided", async () => {
      const app = makeApp({ enableAgent: undefined });
      const res = await app.request("/control/agents/my-agent/enable", { method: "POST" });
      expect(res.status).toBe(503);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("Enable not available");
    });
  });

  describe("POST /control/agents/:name/disable — not provided", () => {
    it("returns 503 when disableAgent is not provided", async () => {
      const app = makeApp({ disableAgent: undefined });
      const res = await app.request("/control/agents/my-agent/disable", { method: "POST" });
      expect(res.status).toBe(503);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("Disable not available");
    });
  });

  describe("POST /control/agents/:name/pause — not provided", () => {
    it("returns 503 when disableAgent (pause alias) is not provided", async () => {
      const app = makeApp({ disableAgent: undefined });
      const res = await app.request("/control/agents/my-agent/pause", { method: "POST" });
      expect(res.status).toBe(503);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("Pause not available");
    });
  });

  describe("POST /control/agents/:name/resume — not provided", () => {
    it("returns 503 when enableAgent (resume alias) is not provided", async () => {
      const app = makeApp({ enableAgent: undefined });
      const res = await app.request("/control/agents/my-agent/resume", { method: "POST" });
      expect(res.status).toBe(503);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("Resume not available");
    });
  });

  // ── Per-agent enable/disable throwing → 500 ──────────────────────────────

  describe("POST /control/agents/:name/enable — throws", () => {
    it("returns 500 when enableAgent throws an error", async () => {
      const app = makeApp({
        enableAgent: vi.fn(async () => {
          throw new Error("Enable failed: database error");
        }),
      });
      const res = await app.request("/control/agents/my-agent/enable", { method: "POST" });
      expect(res.status).toBe(500);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("Enable failed");
    });
  });

  describe("POST /control/agents/:name/disable — throws", () => {
    it("returns 500 when disableAgent throws an error", async () => {
      const app = makeApp({
        disableAgent: vi.fn(async () => {
          throw new Error("Disable failed: lock contention");
        }),
      });
      const res = await app.request("/control/agents/my-agent/disable", { method: "POST" });
      expect(res.status).toBe(500);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("Disable failed");
    });
  });

  // ── POST /control/project/scale — not provided ────────────────────────────

  describe("POST /control/project/scale — not provided", () => {
    it("returns 503 when updateProjectScale is not provided", async () => {
      const app = makeApp({ updateProjectScale: undefined });
      const res = await app.request("/control/project/scale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scale: 2 }),
      });
      expect(res.status).toBe(503);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("Project scale update not available");
    });
  });

  // ── POST /control/agents/:name/scale — not provided ──────────────────────

  describe("POST /control/agents/:name/scale — not provided", () => {
    it("returns 503 when updateAgentScale is not provided", async () => {
      const app = makeApp({ updateAgentScale: undefined });
      const res = await app.request("/control/agents/my-agent/scale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scale: 3 }),
      });
      expect(res.status).toBe(503);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("Agent scale update not available");
    });
  });
});
