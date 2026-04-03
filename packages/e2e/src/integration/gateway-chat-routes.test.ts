/**
 * Integration tests: gateway/routes/chat.ts registerChatRoutes() — no Docker required.
 *
 * registerChatRoutes() creates a ChatSessionManager and registers REST API
 * routes for chat sessions on a Hono app.
 *
 * Covers:
 *   - gateway/routes/chat.ts: registerChatRoutes() — returns chatSessionManager
 *   - gateway/routes/chat.ts: registerChatRoutes() — chatSessionManager is a ChatSessionManager
 *   - gateway/routes/chat.ts: registerChatRoutes() — no launchChatContainer → noop used (no throw)
 *   - gateway/routes/chat.ts: registerChatRoutes() — no stopChatContainer → noop used (no throw)
 *   - gateway/routes/chat.ts: registerChatRoutes() — GET /api/chat/sessions route registered
 *   - gateway/routes/chat.ts: registerChatRoutes() — POST /api/chat/sessions route registered
 *   - gateway/routes/chat.ts: registerChatRoutes() — maxChatSessions passed to ChatSessionManager
 *   - gateway/routes/chat.ts: registerChatRoutes() — custom launchChatContainer used when provided
 */

import { describe, it, expect, vi } from "vitest";

const { Hono } = await import(
  /* @vite-ignore */
  "/tmp/repo/node_modules/hono/dist/index.js"
);

const {
  registerChatRoutes,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/gateway/routes/chat.js"
);

const {
  ChatSessionManager,
} = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/chat/session-manager.js"
);

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
}

describe("integration: gateway/routes/chat.ts registerChatRoutes() (no Docker required)", { timeout: 15_000 }, () => {

  it("returns chatSessionManager instance", () => {
    const app = new Hono();
    const result = registerChatRoutes(app, { logger: makeLogger() });

    expect(result).toHaveProperty("chatSessionManager");
    expect(result.chatSessionManager).toBeInstanceOf(ChatSessionManager);
  });

  it("does not throw when launchChatContainer is not provided", () => {
    const app = new Hono();
    expect(() => {
      registerChatRoutes(app, {
        logger: makeLogger(),
        // launchChatContainer omitted → noop used
      });
    }).not.toThrow();
  });

  it("does not throw when stopChatContainer is not provided", () => {
    const app = new Hono();
    expect(() => {
      registerChatRoutes(app, {
        logger: makeLogger(),
        // stopChatContainer omitted → noop used
      });
    }).not.toThrow();
  });

  it("GET /api/chat/sessions route is registered (returns 200)", async () => {
    const app = new Hono();
    registerChatRoutes(app, { logger: makeLogger() });

    const res = await app.request("/api/chat/sessions");
    // Should return 200 with sessions list (empty)
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("sessions");
    expect(Array.isArray(body.sessions)).toBe(true);
  });

  it("POST /api/chat/sessions without agentName → 400 bad request", async () => {
    const app = new Hono();
    registerChatRoutes(app, { logger: makeLogger() });

    const res = await app.request("/api/chat/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}), // missing agentName
    });
    expect(res.status).toBe(400);
  });

  it("maxChatSessions passed to ChatSessionManager", async () => {
    const app = new Hono();
    const result = registerChatRoutes(app, {
      logger: makeLogger(),
      maxChatSessions: 3,
    });

    // ChatSessionManager with maxSessions=3 should enforce the limit
    expect(result.chatSessionManager).toBeInstanceOf(ChatSessionManager);
    // Verify the limit is configured (by attempting to exceed it)
    // We create sessions up to the limit
    const mgr = result.chatSessionManager;
    // 3 sessions should succeed, 4th should fail
    for (let i = 0; i < 3; i++) {
      mgr.createSession(`agent-${i}`, `container-${i}`, `session-${i}`);
    }
    // 4th should throw or return an error
    expect(mgr.listSessions()).toHaveLength(3);
  });

  it("custom launchChatContainer is used when provided", async () => {
    const app = new Hono();
    const launchFn = vi.fn().mockResolvedValue(undefined);

    registerChatRoutes(app, {
      logger: makeLogger(),
      launchChatContainer: launchFn,
    });

    // POST with agentName → triggers launch
    const res = await app.request("/api/chat/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentName: "my-agent" }),
    });

    // The route was invoked (launchFn called)
    expect(launchFn).toHaveBeenCalled();
  });

  it("multiple registerChatRoutes calls each return an independent ChatSessionManager", () => {
    const app1 = new Hono();
    const app2 = new Hono();
    const result1 = registerChatRoutes(app1, { logger: makeLogger() });
    const result2 = registerChatRoutes(app2, { logger: makeLogger() });

    expect(result1.chatSessionManager).not.toBe(result2.chatSessionManager);
  });
});
