/**
 * Integration tests: chat/ws-handler.ts attachChatWebSocket() — no Docker required.
 *
 * attachChatWebSocket() attaches WebSocket upgrade handling to an HTTP server.
 * It manages browser connections (/chat/ws/:sessionId) and container connections
 * (/chat/container/:sessionId). The returned state includes Maps for tracking
 * connections and a cleanup interval.
 *
 * These tests verify the setup path and basic WebSocket handling without
 * starting the full scheduler or Docker containers.
 *
 * Test scenarios (no Docker required):
 *   1.  attachChatWebSocket(): returns a ChatWebSocketState object
 *   2.  returned state: browserConnections is a Map
 *   3.  returned state: containerConnections is a Map
 *   4.  returned state: cleanupInterval is set
 *   5.  returned state: browserConnections is initially empty
 *   6.  returned state: containerConnections is initially empty
 *   7.  WebSocket upgrade to unknown path → 404
 *   8.  WebSocket upgrade to /chat/ws/:nonexistentSession → 404
 *   9.  WebSocket upgrade to /chat/container/:nonexistentSession → 404
 *  10.  attachChatWebSocket() accepts a logger parameter without throwing
 *  11.  attachChatWebSocket() accepts a sessionStore parameter without throwing
 *  12.  Multiple attachments to different servers work independently
 *
 * Covers:
 *   - chat/ws-handler.ts: attachChatWebSocket() setup
 *   - chat/ws-handler.ts: ChatWebSocketState shape (browserConnections, containerConnections)
 *   - chat/ws-handler.ts: WebSocket upgrade to unknown session → 404
 *   - chat/ws-handler.ts: server.on("upgrade") handler registration
 */

import { describe, it, expect, afterEach } from "vitest";
import { createServer } from "http";
import type { Server } from "http";
import { WebSocket } from "ws";

const { attachChatWebSocket } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/chat/ws-handler.js"
);

const { ChatSessionManager } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/chat/session-manager.js"
);

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeLogger() {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: () => makeLogger(),
  };
}

function getPort(server: Server): number {
  const addr = server.address();
  if (!addr || typeof addr !== "object") throw new Error("Server not listening");
  return addr.port;
}

/** Start an HTTP server on a random port, returns server + cleanup. */
function startServer(): Promise<{ server: Server; port: number; cleanup: () => void }> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = getPort(server);
      const cleanup = () => {
        server.close();
      };
      resolve({ server, port, cleanup });
    });
  });
}

/** Attempt a WebSocket upgrade and return the close code (or "open" if it connected). */
function tryWsConnect(port: number, path: string, headers?: Record<string, string>): Promise<{ code: number | null; connected: boolean }> {
  return new Promise((resolve) => {
    const url = `ws://127.0.0.1:${port}${path}`;
    const ws = new WebSocket(url, { headers });
    const timer = setTimeout(() => {
      ws.terminate();
      resolve({ code: null, connected: false });
    }, 3_000);

    ws.on("open", () => {
      clearTimeout(timer);
      resolve({ code: null, connected: true });
      ws.close();
    });

    ws.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, connected: false });
    });

    ws.on("error", () => {
      clearTimeout(timer);
      resolve({ code: null, connected: false });
    });
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("integration: attachChatWebSocket() (no Docker required)", { timeout: 30_000 }, () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()!();
    }
  });

  // ── Return value shape ─────────────────────────────────────────────────────

  describe("return value shape", () => {
    it("returns a ChatWebSocketState object (not null/undefined)", async () => {
      const { server, cleanup } = await startServer();
      cleanups.push(cleanup);
      const sessionManager = new ChatSessionManager();

      const state = attachChatWebSocket(server, sessionManager, "test-api-key");
      expect(state).toBeDefined();
      expect(state).not.toBeNull();
    });

    it("browserConnections is a Map", async () => {
      const { server, cleanup } = await startServer();
      cleanups.push(cleanup);
      const state = attachChatWebSocket(server, new ChatSessionManager(), "test-key");
      expect(state.browserConnections).toBeInstanceOf(Map);
    });

    it("containerConnections is a Map", async () => {
      const { server, cleanup } = await startServer();
      cleanups.push(cleanup);
      const state = attachChatWebSocket(server, new ChatSessionManager(), "test-key");
      expect(state.containerConnections).toBeInstanceOf(Map);
    });

    it("cleanupInterval is set (non-null, non-undefined)", async () => {
      const { server, cleanup } = await startServer();
      cleanups.push(cleanup);
      const state = attachChatWebSocket(server, new ChatSessionManager(), "test-key");
      expect(state.cleanupInterval).toBeDefined();
      expect(state.cleanupInterval).not.toBeNull();
      clearInterval(state.cleanupInterval);
    });

    it("browserConnections is initially empty", async () => {
      const { server, cleanup } = await startServer();
      cleanups.push(cleanup);
      const state = attachChatWebSocket(server, new ChatSessionManager(), "test-key");
      expect(state.browserConnections.size).toBe(0);
      clearInterval(state.cleanupInterval);
    });

    it("containerConnections is initially empty", async () => {
      const { server, cleanup } = await startServer();
      cleanups.push(cleanup);
      const state = attachChatWebSocket(server, new ChatSessionManager(), "test-key");
      expect(state.containerConnections.size).toBe(0);
      clearInterval(state.cleanupInterval);
    });
  });

  // ── Optional parameters ───────────────────────────────────────────────────

  describe("optional parameters", () => {
    it("accepts a logger parameter without throwing", async () => {
      const { server, cleanup } = await startServer();
      cleanups.push(cleanup);
      const logger = makeLogger();
      const state = attachChatWebSocket(server, new ChatSessionManager(), "test-key", undefined, logger as any);
      expect(state).toBeDefined();
      clearInterval(state.cleanupInterval);
    });

    it("accepts a sessionStore parameter without throwing", async () => {
      const { server, cleanup } = await startServer();
      cleanups.push(cleanup);
      // Minimal session store mock
      const sessionStore = {
        getSession: async () => null,
        createSession: async () => ({ sessionId: "fake", lastAccessedAt: new Date() }),
        deleteSession: async () => {},
      };
      const state = attachChatWebSocket(server, new ChatSessionManager(), "test-key", sessionStore as any);
      expect(state).toBeDefined();
      clearInterval(state.cleanupInterval);
    });
  });

  // ── WebSocket upgrade handling ────────────────────────────────────────────

  describe("WebSocket upgrade handling", () => {
    it("rejects WebSocket upgrade to unknown path (not a chat path)", async () => {
      const { server, port, cleanup } = await startServer();
      cleanups.push(cleanup);
      const state = attachChatWebSocket(server, new ChatSessionManager(), "test-key");

      // The upgrade to a non-chat path should fail or be rejected
      const result = await tryWsConnect(port, "/some/other/path");
      expect(result.connected).toBe(false);
      clearInterval(state.cleanupInterval);
    });

    it("rejects WebSocket upgrade to /chat/ws/:nonexistentSession", async () => {
      const { server, port, cleanup } = await startServer();
      cleanups.push(cleanup);
      const state = attachChatWebSocket(server, new ChatSessionManager(), "test-key");

      const result = await tryWsConnect(port, "/chat/ws/nonexistent-session-id");
      expect(result.connected).toBe(false);
      clearInterval(state.cleanupInterval);
    });

    it("rejects WebSocket upgrade to /chat/container/:nonexistentSession", async () => {
      const { server, port, cleanup } = await startServer();
      cleanups.push(cleanup);
      const state = attachChatWebSocket(server, new ChatSessionManager(), "test-key");

      const result = await tryWsConnect(port, "/chat/container/nonexistent-session-id");
      expect(result.connected).toBe(false);
      clearInterval(state.cleanupInterval);
    });

    it("rejects /chat/ws/:id when session exists but no auth header", async () => {
      const { server, port, cleanup } = await startServer();
      cleanups.push(cleanup);
      const sessionManager = new ChatSessionManager();
      const session = sessionManager.createSession("test-agent");
      const state = attachChatWebSocket(server, sessionManager, "test-key");

      // No auth header → should be rejected (401)
      const result = await tryWsConnect(port, `/chat/ws/${session.sessionId}`);
      expect(result.connected).toBe(false);
      clearInterval(state.cleanupInterval);
    });
  });

  // ── Multiple instances ────────────────────────────────────────────────────

  describe("multiple independent attachments", () => {
    it("two servers have independent states", async () => {
      const { server: s1, cleanup: c1 } = await startServer();
      const { server: s2, cleanup: c2 } = await startServer();
      cleanups.push(c1, c2);

      const state1 = attachChatWebSocket(s1, new ChatSessionManager(), "key1");
      const state2 = attachChatWebSocket(s2, new ChatSessionManager(), "key2");

      expect(state1.browserConnections).not.toBe(state2.browserConnections);
      expect(state1.containerConnections).not.toBe(state2.containerConnections);

      clearInterval(state1.cleanupInterval);
      clearInterval(state2.cleanupInterval);
    });
  });
});
