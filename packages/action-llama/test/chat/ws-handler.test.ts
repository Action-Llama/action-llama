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
  });
});
