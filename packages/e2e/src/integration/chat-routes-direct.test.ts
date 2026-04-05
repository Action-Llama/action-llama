/**
 * Integration tests: chat/routes.ts registerChatApiRoutes() — no Docker required.
 *
 * Tests the chat session REST endpoints using a directly-constructed Hono app
 * with a ChatSessionManager and mock callbacks. Covers code paths not exercised
 * by the no-Docker gateway harness tests (chat-api-noagent.test.ts):
 *
 *   1. POST /api/chat/sessions — returns existing session when agent already has one (idempotent)
 *   2. POST /api/chat/sessions — 429 when session limit reached
 *   3. DELETE /api/chat/sessions/:id — 200 { success: true } when session exists
 *   4. DELETE /api/chat/sessions/:id — stopCallback error is caught (logged, not thrown)
 *   5. POST /api/chat/sessions/:id/clear — returns new sessionId after clearing
 *   6. GET /api/chat/sessions — returns enriched session list shape
 *   7. POST /api/chat/sessions/:id/clear — stopCallback error caught (logged, not thrown)
 *
 * Covers:
 *   - chat/routes.ts: POST /api/chat/sessions — idempotent path (existing session returned)
 *   - chat/routes.ts: POST /api/chat/sessions — 429 when canCreateSession() false
 *   - chat/routes.ts: DELETE /api/chat/sessions/:id — success path (200 { success: true })
 *   - chat/routes.ts: DELETE /api/chat/sessions/:id — stopCallback throws → caught, session removed
 *   - chat/routes.ts: POST /api/chat/sessions/:id/clear — new sessionId returned
 *   - chat/routes.ts: POST /api/chat/sessions/:id/clear — stopCallback throws → caught
 *   - chat/routes.ts: GET /api/chat/sessions — sessions shape with containerName/timestamps
 */

import { describe, it, expect, vi } from "vitest";

const { Hono } = await import(
  /* @vite-ignore */
  "/tmp/repo/node_modules/hono/dist/index.js"
);

const { registerChatApiRoutes } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/chat/routes.js"
);

const { ChatSessionManager } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/chat/session-manager.js"
);

// ── Helpers ────────────────────────────────────────────────────────────────

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
}

function makeApp(sessionManager: any, launchCb?: any, stopCb?: any) {
  const app = new Hono();
  const launch = launchCb || vi.fn(async () => {});
  const stop = stopCb || vi.fn(async () => {});
  const logger = makeLogger();
  registerChatApiRoutes(app, sessionManager, launch, stop, logger);
  return { app, launch, stop, logger };
}

async function post(app: any, path: string, body?: object): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function get(app: any, path: string): Promise<Response> {
  return app.request(path, { method: "GET" });
}

async function del(app: any, path: string): Promise<Response> {
  return app.request(path, { method: "DELETE" });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe(
  "integration: chat/routes.ts registerChatApiRoutes() — no Docker required",
  { timeout: 15_000 },
  () => {
    // ── POST /api/chat/sessions — idempotent path ─────────────────────────

    it("POST /api/chat/sessions returns existing session when agent already has one", async () => {
      const mgr = new ChatSessionManager(5);
      // Pre-create session for "existing-agent"
      const existing = mgr.createSession("existing-agent");
      const { app } = makeApp(mgr);

      const res = await post(app, "/api/chat/sessions", { agentName: "existing-agent" });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.sessionId).toBe(existing.sessionId);
      expect(body.created).toBe(false);
    });

    // ── POST /api/chat/sessions — 429 when limit reached ─────────────────

    it("POST /api/chat/sessions returns 429 when session limit is reached", async () => {
      const mgr = new ChatSessionManager(1); // limit = 1
      mgr.createSession("first-agent"); // fills the limit
      const { app } = makeApp(mgr);

      const res = await post(app, "/api/chat/sessions", { agentName: "second-agent" });
      const body = await res.json();

      expect(res.status).toBe(429);
      expect(body.error).toContain("limit");
    });

    // ── DELETE /api/chat/sessions/:id — success path ──────────────────────

    it("DELETE /api/chat/sessions/:id returns 200 { success: true } when session exists", async () => {
      const mgr = new ChatSessionManager(5);
      const session = mgr.createSession("test-agent");
      const stopCb = vi.fn(async () => {});
      const { app } = makeApp(mgr, undefined, stopCb);

      const res = await del(app, `/api/chat/sessions/${session.sessionId}`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      // Session should be removed
      expect(mgr.getSession(session.sessionId)).toBeUndefined();
    });

    it("DELETE /api/chat/sessions/:id — stopCallback throws but session is still removed", async () => {
      const mgr = new ChatSessionManager(5);
      const session = mgr.createSession("test-agent");
      const stopCb = vi.fn(async () => { throw new Error("stop failed"); });
      const { app, logger } = makeApp(mgr, undefined, stopCb);

      // Should not throw
      const res = await del(app, `/api/chat/sessions/${session.sessionId}`);
      expect(res.status).toBe(200);
      // Session should be removed despite error
      expect(mgr.getSession(session.sessionId)).toBeUndefined();
      // Warning should be logged
      expect(logger.warn).toHaveBeenCalled();
    });

    // ── POST /api/chat/sessions/:id/clear — returns new sessionId ─────────

    it("POST /api/chat/sessions/:id/clear returns new sessionId", async () => {
      const mgr = new ChatSessionManager(5);
      const session = mgr.createSession("test-agent");
      const { app } = makeApp(mgr);

      const res = await post(app, `/api/chat/sessions/${session.sessionId}/clear`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.sessionId).toBeDefined();
      // New session ID should be different from old
      expect(body.sessionId).not.toBe(session.sessionId);
    });

    it("POST /api/chat/sessions/:id/clear — stopCallback throws but continues", async () => {
      const mgr = new ChatSessionManager(5);
      const session = mgr.createSession("test-agent");
      const stopCb = vi.fn(async () => { throw new Error("stop failed"); });
      const { app, logger } = makeApp(mgr, undefined, stopCb);

      const res = await post(app, `/api/chat/sessions/${session.sessionId}/clear`);
      // Should still succeed (error is caught)
      expect(res.status).toBe(200);
      expect(logger.warn).toHaveBeenCalled();
    });

    // ── GET /api/chat/sessions — list shape ───────────────────────────────

    it("GET /api/chat/sessions returns enriched session list shape", async () => {
      const mgr = new ChatSessionManager(5);
      const session = mgr.createSession("list-agent");
      mgr.setContainerName(session.sessionId, "al-container-abc");
      const { app } = makeApp(mgr);

      const res = await get(app, "/api/chat/sessions");
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(Array.isArray(body.sessions)).toBe(true);
      expect(body.sessions).toHaveLength(1);
      const s = body.sessions[0];
      expect(s.sessionId).toBe(session.sessionId);
      expect(s.agentName).toBe("list-agent");
      expect(s.containerName).toBe("al-container-abc");
      expect(s.createdAt).toBeDefined();
      expect(s.lastActivityAt).toBeDefined();
    });

    it("GET /api/chat/sessions returns empty sessions array when no sessions", async () => {
      const mgr = new ChatSessionManager(5);
      const { app } = makeApp(mgr);

      const res = await get(app, "/api/chat/sessions");
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.sessions).toHaveLength(0);
    });
  },
);
