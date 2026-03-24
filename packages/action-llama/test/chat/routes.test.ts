import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { ChatSessionManager } from "../../src/chat/session-manager.js";
import { registerChatApiRoutes } from "../../src/chat/routes.js";

describe("Chat API routes", () => {
  let app: Hono;
  let sessionManager: ChatSessionManager;
  let launchCallback: ReturnType<typeof vi.fn>;
  let stopCallback: ReturnType<typeof vi.fn>;
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    app = new Hono();
    sessionManager = new ChatSessionManager(3);
    launchCallback = vi.fn().mockResolvedValue(undefined);
    stopCallback = vi.fn().mockResolvedValue(undefined);
    registerChatApiRoutes(app, sessionManager, launchCallback, stopCallback, logger as any);
  });

  describe("POST /api/chat/sessions", () => {
    it("creates a session and returns sessionId", async () => {
      const res = await app.request("/api/chat/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentName: "test-agent" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.sessionId).toBeTruthy();
      expect(typeof body.sessionId).toBe("string");
    });

    it("calls launchCallback with agentName and sessionId", async () => {
      const res = await app.request("/api/chat/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentName: "my-agent" }),
      });
      const body = await res.json();

      // launchCallback is called asynchronously — wait a tick
      await new Promise((r) => setTimeout(r, 10));
      expect(launchCallback).toHaveBeenCalledWith("my-agent", body.sessionId);
    });

    it("returns 400 when agentName is missing", async () => {
      const res = await app.request("/api/chat/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("agentName");
    });

    it("returns 429 when session limit is reached", async () => {
      // Fill up all 3 slots
      for (let i = 0; i < 3; i++) {
        await app.request("/api/chat/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentName: `agent-${i}` }),
        });
      }

      const res = await app.request("/api/chat/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentName: "overflow" }),
      });
      expect(res.status).toBe(429);
    });

    it("handles invalid JSON body", async () => {
      const res = await app.request("/api/chat/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });
      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/chat/sessions/:sessionId", () => {
    it("deletes an existing session", async () => {
      const createRes = await app.request("/api/chat/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentName: "test-agent" }),
      });
      const { sessionId } = await createRes.json();

      const res = await app.request(`/api/chat/sessions/${sessionId}`, {
        method: "DELETE",
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(stopCallback).toHaveBeenCalledWith(sessionId);
    });

    it("returns 404 for unknown session", async () => {
      const res = await app.request("/api/chat/sessions/nonexistent", {
        method: "DELETE",
      });
      expect(res.status).toBe(404);
    });

    it("still removes session even if stopCallback throws", async () => {
      stopCallback.mockRejectedValueOnce(new Error("container not found"));

      const createRes = await app.request("/api/chat/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentName: "test-agent" }),
      });
      const { sessionId } = await createRes.json();

      const res = await app.request(`/api/chat/sessions/${sessionId}`, {
        method: "DELETE",
      });
      expect(res.status).toBe(200);
      expect(sessionManager.getSession(sessionId)).toBeUndefined();
    });
  });

  describe("GET /api/chat/sessions", () => {
    it("lists active sessions", async () => {
      await app.request("/api/chat/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentName: "agent-a" }),
      });
      await app.request("/api/chat/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentName: "agent-b" }),
      });

      const res = await app.request("/api/chat/sessions");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.sessions).toHaveLength(2);
      expect(body.sessions[0].agentName).toBe("agent-a");
      expect(body.sessions[1].agentName).toBe("agent-b");
      expect(body.sessions[0].sessionId).toBeTruthy();
      expect(body.sessions[0].createdAt).toBeTruthy();
      expect(body.sessions[0].lastActivityAt).toBeTruthy();
    });

    it("returns empty list when no sessions", async () => {
      const res = await app.request("/api/chat/sessions");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.sessions).toEqual([]);
    });
  });
});
