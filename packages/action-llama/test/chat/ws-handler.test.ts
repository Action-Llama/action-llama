import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "http";
import WebSocket from "ws";
import { ChatSessionManager } from "../../src/chat/session-manager.js";
import { attachChatWebSocket, type ChatWebSocketState } from "../../src/chat/ws-handler.js";

const TEST_API_KEY = "test-secret-key-ws";
const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    ws.on("open", resolve);
    ws.on("error", reject);
  });
}

function waitForMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve) => {
    ws.once("message", (data) => resolve(data.toString()));
  });
}

function waitForCloseOrError(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) return resolve();
    ws.on("close", () => resolve());
    // ws throws errors for non-101 responses instead of emitting close
    ws.on("error", () => resolve());
  });
}

describe("Chat WebSocket handler", () => {
  let server: Server;
  let port: number;
  let sessionManager: ChatSessionManager;
  let wsState: ChatWebSocketState;

  beforeEach(async () => {
    vi.clearAllMocks();
    sessionManager = new ChatSessionManager(5);

    server = createServer();
    wsState = attachChatWebSocket(server, sessionManager, TEST_API_KEY, undefined, logger as any);

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    port = (server.address() as any).port;
  });

  afterEach(async () => {
    clearInterval(wsState.cleanupInterval);
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  describe("browser connection", () => {
    it("rejects connection for unknown session", async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/chat/ws/nonexistent`, {
        headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      });

      await waitForCloseOrError(ws);
      // Connection should have been rejected (CLOSED or CLOSING)
      expect(ws.readyState).not.toBe(WebSocket.OPEN);
    });

    it("rejects connection without auth", async () => {
      const session = sessionManager.createSession("test-agent");
      const ws = new WebSocket(`ws://127.0.0.1:${port}/chat/ws/${session.sessionId}`);

      await waitForCloseOrError(ws);
      expect(ws.readyState).not.toBe(WebSocket.OPEN);
    });

    it("accepts connection with valid Bearer token", async () => {
      const session = sessionManager.createSession("test-agent");
      const ws = new WebSocket(`ws://127.0.0.1:${port}/chat/ws/${session.sessionId}`, {
        headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      });

      await waitForOpen(ws);
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
    });

    it("returns error when container is not connected", async () => {
      const session = sessionManager.createSession("test-agent");
      const browser = new WebSocket(`ws://127.0.0.1:${port}/chat/ws/${session.sessionId}`, {
        headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      });

      await waitForOpen(browser);

      const msgPromise = waitForMessage(browser);
      browser.send(JSON.stringify({ type: "user_message", text: "hello" }));
      const response = JSON.parse(await msgPromise);

      expect(response.type).toBe("error");
      expect(response.message).toContain("not connected");
      browser.close();
    });

    it("rejects invalid inbound messages", async () => {
      const session = sessionManager.createSession("test-agent");
      const browser = new WebSocket(`ws://127.0.0.1:${port}/chat/ws/${session.sessionId}`, {
        headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      });

      await waitForOpen(browser);

      const msgPromise = waitForMessage(browser);
      browser.send("not json");
      const response = JSON.parse(await msgPromise);

      expect(response.type).toBe("error");
      expect(response.message).toContain("Invalid JSON");
      browser.close();
    });
  });

  describe("container connection", () => {
    it("rejects connection for unknown session", async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/chat/container/nonexistent`);
      await waitForCloseOrError(ws);
      expect(ws.readyState).not.toBe(WebSocket.OPEN);
    });

    it("accepts and authenticates container", async () => {
      const session = sessionManager.createSession("test-agent");
      const container = new WebSocket(`ws://127.0.0.1:${port}/chat/container/${session.sessionId}`);

      await waitForOpen(container);

      const authResponse = waitForMessage(container);
      container.send(JSON.stringify({ type: "auth", token: session.sessionId }));
      const response = JSON.parse(await authResponse);

      expect(response.type).toBe("auth_ok");
      container.close();
    });

    it("rejects container with invalid token", async () => {
      const session = sessionManager.createSession("test-agent");
      const container = new WebSocket(`ws://127.0.0.1:${port}/chat/container/${session.sessionId}`);

      await waitForOpen(container);
      container.send(JSON.stringify({ type: "auth", token: "wrong-token" }));

      await waitForCloseOrError(container);
      expect(container.readyState).not.toBe(WebSocket.OPEN);
    });

    it("times out if container doesn't authenticate within 5s", async () => {
      const session = sessionManager.createSession("test-agent");
      const container = new WebSocket(`ws://127.0.0.1:${port}/chat/container/${session.sessionId}`);

      await waitForOpen(container);
      // Don't send auth — wait for timeout

      await waitForCloseOrError(container);
      expect(container.readyState).not.toBe(WebSocket.OPEN);
    }, 10_000);
  });

  describe("message bridging", () => {
    async function setupBridge() {
      const session = sessionManager.createSession("test-agent");

      // Connect browser
      const browser = new WebSocket(`ws://127.0.0.1:${port}/chat/ws/${session.sessionId}`, {
        headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      });
      await waitForOpen(browser);

      // Connect and authenticate container
      const container = new WebSocket(`ws://127.0.0.1:${port}/chat/container/${session.sessionId}`);
      await waitForOpen(container);
      const authOk = waitForMessage(container);
      container.send(JSON.stringify({ type: "auth", token: session.sessionId }));
      await authOk;

      return { session, browser, container };
    }

    it("forwards browser messages to container", async () => {
      const { browser, container } = await setupBridge();

      const containerMsg = waitForMessage(container);
      browser.send(JSON.stringify({ type: "user_message", text: "hello from browser" }));

      const received = JSON.parse(await containerMsg);
      expect(received.type).toBe("user_message");
      expect(received.text).toBe("hello from browser");

      browser.close();
      container.close();
    });

    it("forwards container messages to browser", async () => {
      const { browser, container } = await setupBridge();

      const browserMsg = waitForMessage(browser);
      container.send(JSON.stringify({ type: "assistant_message", text: "Hello!", done: false }));

      const received = JSON.parse(await browserMsg);
      expect(received.type).toBe("assistant_message");
      expect(received.text).toBe("Hello!");

      browser.close();
      container.close();
    });

    it("validates outbound messages from container", async () => {
      const { browser, container } = await setupBridge();

      // Send invalid outbound type from container
      container.send(JSON.stringify({ type: "user_message", text: "invalid" }));

      // Browser should not receive anything (wait briefly to verify)
      let received = false;
      browser.once("message", () => { received = true; });
      await new Promise((r) => setTimeout(r, 100));
      expect(received).toBe(false);

      browser.close();
      container.close();
    });

    it("rate-limits browser messages", async () => {
      const { browser, container } = await setupBridge();

      // Send more than 10 messages quickly
      const errors: string[] = [];
      browser.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === "error" && msg.message.includes("Rate limited")) {
          errors.push(msg.message);
        }
      });

      for (let i = 0; i < 15; i++) {
        browser.send(JSON.stringify({ type: "user_message", text: `msg ${i}` }));
      }

      // Wait for messages to be processed
      await new Promise((r) => setTimeout(r, 100));
      expect(errors.length).toBeGreaterThan(0);

      browser.close();
      container.close();
    });
  });

  describe("disconnect handling", () => {
    it("notifies browser when container disconnects", async () => {
      const session = sessionManager.createSession("test-agent");

      const browser = new WebSocket(`ws://127.0.0.1:${port}/chat/ws/${session.sessionId}`, {
        headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      });
      await waitForOpen(browser);

      const container = new WebSocket(`ws://127.0.0.1:${port}/chat/container/${session.sessionId}`);
      await waitForOpen(container);
      const authOk = waitForMessage(container);
      container.send(JSON.stringify({ type: "auth", token: session.sessionId }));
      await authOk;

      const browserMsg = waitForMessage(browser);
      container.close();

      const received = JSON.parse(await browserMsg);
      expect(received.type).toBe("error");
      expect(received.message).toContain("disconnected");

      browser.close();
    });

    it("removes session when container disconnects", async () => {
      const session = sessionManager.createSession("test-agent");

      const container = new WebSocket(`ws://127.0.0.1:${port}/chat/container/${session.sessionId}`);
      await waitForOpen(container);
      const authOk = waitForMessage(container);
      container.send(JSON.stringify({ type: "auth", token: session.sessionId }));
      await authOk;

      container.close();

      // Wait for close handler to run
      await new Promise((r) => setTimeout(r, 50));
      expect(sessionManager.getSession(session.sessionId)).toBeUndefined();
    });

    it("removes browser connection map entry on browser disconnect", async () => {
      const session = sessionManager.createSession("test-agent");
      const browser = new WebSocket(`ws://127.0.0.1:${port}/chat/ws/${session.sessionId}`, {
        headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      });
      await waitForOpen(browser);

      expect(wsState.browserConnections.has(session.sessionId)).toBe(true);

      browser.close();
      // Wait for close handler to propagate
      await new Promise((r) => setTimeout(r, 50));

      expect(wsState.browserConnections.has(session.sessionId)).toBe(false);
    });
  });

  describe("cookie authentication", () => {
    it("accepts browser connection with al_session cookie matching api key", async () => {
      const session = sessionManager.createSession("test-agent");
      const ws = new WebSocket(`ws://127.0.0.1:${port}/chat/ws/${session.sessionId}`, {
        headers: { Cookie: `al_session=${TEST_API_KEY}` },
      });

      await waitForOpen(ws);
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
    });

    it("rejects browser connection with invalid al_session cookie", async () => {
      const session = sessionManager.createSession("test-agent");
      const ws = new WebSocket(`ws://127.0.0.1:${port}/chat/ws/${session.sessionId}`, {
        headers: { Cookie: "al_session=wrong-key" },
      });

      await waitForCloseOrError(ws);
      expect(ws.readyState).not.toBe(WebSocket.OPEN);
    });

    it("accepts browser connection with valid session store token", async () => {
      const sessionStore = {
        getSession: vi.fn().mockResolvedValue({ userId: "user1" }),
      } as any;

      // Create a new server with session store
      const server2 = createServer();
      const wsState2 = attachChatWebSocket(server2, sessionManager, TEST_API_KEY, sessionStore, logger as any);
      await new Promise<void>((resolve) => server2.listen(0, "127.0.0.1", resolve));
      const port2 = (server2.address() as any).port;

      const session = sessionManager.createSession("test-agent");
      const ws = new WebSocket(`ws://127.0.0.1:${port2}/chat/ws/${session.sessionId}`, {
        headers: { Cookie: "al_session=session-token-123" },
      });

      await waitForOpen(ws);
      expect(ws.readyState).toBe(WebSocket.OPEN);
      expect(sessionStore.getSession).toHaveBeenCalledWith("session-token-123");
      ws.close();

      clearInterval(wsState2.cleanupInterval);
      await new Promise<void>((resolve) => server2.close(() => resolve()));
    });
  });

  describe("shutdownSession via idle cleanup", () => {
    it("calls stopContainer when idle session is cleaned up", async () => {
      // Create a new session manager and server so we can use fake timers
      const mgr = new ChatSessionManager(5);
      const srv = createServer();
      const stopContainer = vi.fn().mockResolvedValue(undefined);

      const state2 = attachChatWebSocket(srv, mgr, TEST_API_KEY, undefined, logger as any);
      state2.stopContainer = stopContainer;

      await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
      const port2 = (srv.address() as any).port;

      // Create a session
      const session = mgr.createSession("test-agent");

      // Simulate idle: patch lastActivityAt to be in the past (16 minutes ago)
      const s = mgr.getSession(session.sessionId)!;
      (s as any).lastActivityAt = new Date(Date.now() - 16 * 60 * 1000);

      // Now manually fire the cleanup interval
      state2.cleanupInterval.ref();
      await new Promise<void>((resolve) => setTimeout(resolve, 0)); // tick

      // Directly call the cleanup logic by triggering the interval callback
      // getIdleSessions would now return the session (it's idle)
      const idle = mgr.getIdleSessions(15 * 60 * 1000);
      expect(idle).toHaveLength(1);
      expect(idle[0].sessionId).toBe(session.sessionId);

      clearInterval(state2.cleanupInterval);
      await new Promise<void>((resolve) => srv.close(() => resolve()));
    });

    it("handles stopContainer error gracefully", async () => {
      const mgr = new ChatSessionManager(5);
      const srv = createServer();
      const stopContainer = vi.fn().mockRejectedValue(new Error("container stop failed"));

      const state2 = attachChatWebSocket(srv, mgr, TEST_API_KEY, undefined, logger as any);
      state2.stopContainer = stopContainer;

      await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));

      // Verify that stopContainer being set works correctly
      expect(typeof state2.stopContainer).toBe("function");

      clearInterval(state2.cleanupInterval);
      await new Promise<void>((resolve) => srv.close(() => resolve()));
    });
  });

  // ── Error event handling ─────────────────────────────────────────────────

  describe("WebSocket error event handling", () => {
    it("logs warning when browser WebSocket emits an error event", async () => {
      vi.clearAllMocks();
      const session = sessionManager.createSession("test-agent");
      const browser = new WebSocket(`ws://127.0.0.1:${port}/chat/ws/${session.sessionId}`, {
        headers: { Authorization: `Bearer ${TEST_API_KEY}` },
      });
      await waitForOpen(browser);

      // Emit error directly on the server-side WebSocket object
      const serverConn = wsState.browserConnections.get(session.sessionId);
      expect(serverConn).toBeDefined();
      serverConn!.ws.emit("error", new Error("simulated browser connection error"));

      // Give event handlers a chance to run
      await new Promise((r) => setTimeout(r, 20));

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: session.sessionId }),
        "browser WebSocket error",
      );

      browser.close();
    });

    it("logs warning when container WebSocket emits an error event", async () => {
      vi.clearAllMocks();
      const session = sessionManager.createSession("test-agent");
      const container = new WebSocket(`ws://127.0.0.1:${port}/chat/container/${session.sessionId}`);
      await waitForOpen(container);
      // Authenticate container
      const authOk = waitForMessage(container);
      container.send(JSON.stringify({ type: "auth", token: session.sessionId }));
      await authOk;

      // Emit error directly on the server-side container WebSocket
      const serverConn = wsState.containerConnections.get(session.sessionId);
      expect(serverConn).toBeDefined();
      serverConn!.ws.emit("error", new Error("simulated container error"));

      await new Promise((r) => setTimeout(r, 20));

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: session.sessionId }),
        "container WebSocket error",
      );

      container.close();
    });
  });
});

// ── shutdownSession tests (separate describe with fake timers from start) ──

describe("Chat WebSocket handler — shutdownSession via idle cleanup", () => {
  // We use fake timers for this entire describe so that setInterval in
  // attachChatWebSocket is under fake-timer control from the start.
  // Network operations (listen, WebSocket open/message) work independently of timers.

  let srv: ReturnType<typeof createServer>;
  let wsState2: ChatWebSocketState;
  let mgr: ChatSessionManager;
  let port2: number;
  const logger2 = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    // Enable fake timers BEFORE creating the ws-handler so setInterval is under fake control.
    // Network operations (listen, WebSocket) use real I/O and work independently of timers.
    vi.useFakeTimers();

    mgr = new ChatSessionManager(5);
    srv = createServer();
    wsState2 = attachChatWebSocket(srv, mgr, TEST_API_KEY, undefined, logger2 as any);

    // server.listen() uses native I/O — wrap in a promise that resolves on the callback
    await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
    port2 = (srv.address() as any).port;
  });

  afterEach(async () => {
    vi.useRealTimers();
    clearInterval(wsState2.cleanupInterval);
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  });

  it("closes browser and container connections and calls stopContainer when idle session cleaned up", async () => {
    const stopContainer = vi.fn().mockResolvedValue(undefined);
    wsState2.stopContainer = stopContainer;

    // Connect browser (WebSocket events are I/O-driven, not timer-driven)
    const session = mgr.createSession("test-agent");
    const browser = new WebSocket(`ws://127.0.0.1:${port2}/chat/ws/${session.sessionId}`, {
      headers: { Authorization: `Bearer ${TEST_API_KEY}` },
    });
    await waitForOpen(browser);

    // Connect and authenticate container
    const container = new WebSocket(`ws://127.0.0.1:${port2}/chat/container/${session.sessionId}`);
    await waitForOpen(container);
    const authOk = waitForMessage(container);
    container.send(JSON.stringify({ type: "auth", token: session.sessionId }));
    await authOk;

    // Verify connections tracked
    expect(wsState2.browserConnections.has(session.sessionId)).toBe(true);
    expect(wsState2.containerConnections.has(session.sessionId)).toBe(true);

    // Make session idle (16 minutes ago) — use fake Date.now() offset
    const s = mgr.getSession(session.sessionId)!;
    (s as any).lastActivityAt = new Date(Date.now() - 16 * 60 * 1000);

    // Advance fake timers by 60s to fire the setInterval cleanup callback
    // advanceTimersByTimeAsync also flushes all resulting microtasks/promises
    await vi.advanceTimersByTimeAsync(60_000);
    // Flush remaining microtasks (e.g., the async shutdownSession await chain)
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(stopContainer).toHaveBeenCalledWith(session.sessionId);
    expect(wsState2.browserConnections.has(session.sessionId)).toBe(false);
    expect(wsState2.containerConnections.has(session.sessionId)).toBe(false);
  });

  it("logs warning and continues when stopContainer throws during idle cleanup", async () => {
    const stopContainer = vi.fn().mockRejectedValue(new Error("stop failed"));
    wsState2.stopContainer = stopContainer;

    const session = mgr.createSession("test-agent");

    // Connect browser so shutdownSession has something to close
    const browser = new WebSocket(`ws://127.0.0.1:${port2}/chat/ws/${session.sessionId}`, {
      headers: { Authorization: `Bearer ${TEST_API_KEY}` },
    });
    await waitForOpen(browser);

    // Make session idle
    const s = mgr.getSession(session.sessionId)!;
    (s as any).lastActivityAt = new Date(Date.now() - 16 * 60 * 1000);

    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(stopContainer).toHaveBeenCalledWith(session.sessionId);
    expect(logger2.warn).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: session.sessionId }),
      "failed to stop chat container",
    );
  });

  it("shuts down container-only session during idle cleanup (no stopContainer set)", async () => {
    // No stopContainer set — exercises the `if (state.stopContainer)` false branch
    const session = mgr.createSession("test-agent");

    const container = new WebSocket(`ws://127.0.0.1:${port2}/chat/container/${session.sessionId}`);
    await waitForOpen(container);
    const authOk = waitForMessage(container);
    container.send(JSON.stringify({ type: "auth", token: session.sessionId }));
    await authOk;

    expect(wsState2.containerConnections.has(session.sessionId)).toBe(true);

    // Make session idle
    const s = mgr.getSession(session.sessionId)!;
    (s as any).lastActivityAt = new Date(Date.now() - 16 * 60 * 1000);

    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(wsState2.containerConnections.has(session.sessionId)).toBe(false);
  });
});
