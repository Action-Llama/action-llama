import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockWsInstances: any[] = [];

vi.mock("ws", () => {
  const { EventEmitter } = require("events");

  class MockWebSocket extends EventEmitter {
    static OPEN = 1;
    static CONNECTING = 0;
    static CLOSING = 2;
    static CLOSED = 3;

    readyState: number;
    url: string;
    options: any;
    sent: string[];

    constructor(url: string, options?: any) {
      super();
      this.url = url;
      this.options = options;
      this.readyState = MockWebSocket.CONNECTING;
      this.sent = [];
      (globalThis as any).__mockWsInstances.push(this);
    }

    send(data: string) {
      this.sent.push(data);
    }

    close() {
      this.readyState = MockWebSocket.CLOSED;
      this.emit("close");
    }
  }

  return { default: MockWebSocket, WebSocket: MockWebSocket };
});

// Expose the instances array to the hoisted mock factory
(globalThis as any).__mockWsInstances = mockWsInstances;

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { RemoteTransport } from "../../src/chat/remote-transport.js";

/** Helper: attach test utilities to the most-recently-created MockWebSocket. */
function getMockWs() {
  const ws = (globalThis as any).__mockWsInstances[(globalThis as any).__mockWsInstances.length - 1] as any;
  if (!ws) throw new Error("No MockWebSocket instance found");
  ws._open = () => { ws.readyState = 1; ws.emit("open"); };
  ws._message = (data: object) => { ws.emit("message", Buffer.from(JSON.stringify(data))); };
  ws._error = (err: Error) => { ws.emit("error", err); };
  return ws;
}

/**
 * Creates a connected RemoteTransport.
 * Awaits enough microtasks for the fetch mock to resolve so that the
 * WebSocket constructor has been called before getMockWs() is invoked.
 */
async function createConnected(opts?: { sessionId?: string; gatewayUrl?: string; apiKey?: string }) {
  const sessionId = opts?.sessionId ?? "sess";
  const gatewayUrl = opts?.gatewayUrl ?? "http://localhost:8080";
  const apiKey = opts?.apiKey ?? "k";

  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ sessionId }),
  });

  const t = new RemoteTransport({ gatewayUrl, agentName: "agent", apiKey });
  const connectPromise = t.connect();

  // Wait for the fetch mock to resolve so that `new WebSocket(...)` is called
  await Promise.resolve();
  await Promise.resolve();

  const ws = getMockWs();
  ws._open();
  await connectPromise;
  return { t, ws };
}

describe("RemoteTransport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).__mockWsInstances.length = 0;
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // ─── constructor ──────────────────────────────────────────────────────────

  describe("constructor", () => {
    it("starts disconnected", () => {
      const t = new RemoteTransport({ gatewayUrl: "http://localhost:8080", agentName: "test", apiKey: "key" });
      expect(t.connected).toBe(false);
    });
  });

  // ─── connect() ────────────────────────────────────────────────────────────

  describe("connect()", () => {
    it("POSTs to /api/chat/sessions with correct body and headers", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sessionId: "sess-1" }),
      });

      const t = new RemoteTransport({ gatewayUrl: "http://localhost:8080", agentName: "my-agent", apiKey: "secret" });
      const connectPromise = t.connect();
      await Promise.resolve();
      await Promise.resolve();

      const ws = getMockWs();
      ws._open();
      await connectPromise;

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:8080/api/chat/sessions",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "Authorization": "Bearer secret",
          }),
          body: JSON.stringify({ agentName: "my-agent" }),
        })
      );
    });

    it("connects WebSocket to ws:// URL with sessionId path", async () => {
      const { ws } = await createConnected({ sessionId: "sess-abc" });
      expect(ws.url).toBe("ws://localhost:8080/chat/ws/sess-abc");
    });

    it("uses wss:// when gatewayUrl starts with https://", async () => {
      const { ws } = await createConnected({ gatewayUrl: "https://example.com", sessionId: "s1" });
      expect(ws.url).toBe("wss://example.com/chat/ws/s1");
    });

    it("sets connected=true after WebSocket open", async () => {
      const { t } = await createConnected();
      expect(t.connected).toBe(true);
    });

    it("passes Authorization header to the WebSocket constructor", async () => {
      const { ws } = await createConnected({ apiKey: "my-key" });
      expect(ws.options).toEqual(
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: "Bearer my-key" }),
        })
      );
    });

    it("throws when session creation HTTP call fails", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: async () => "Unauthorized",
      });

      const t = new RemoteTransport({ gatewayUrl: "http://localhost:8080", agentName: "agent", apiKey: "bad" });
      await expect(t.connect()).rejects.toThrow("Failed to create chat session: Unauthorized");
    });

    it("rejects when WebSocket emits error before open", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sessionId: "s3" }),
      });

      const t = new RemoteTransport({ gatewayUrl: "http://localhost:8080", agentName: "agent", apiKey: "k" });
      const connectPromise = t.connect();
      await Promise.resolve();
      await Promise.resolve();

      const ws = getMockWs();
      ws._error(new Error("connection refused"));

      await expect(connectPromise).rejects.toThrow("connection refused");
    });

    it("sets connected=false when WebSocket closes after a successful connection", async () => {
      const { t, ws } = await createConnected();

      expect(t.connected).toBe(true);
      ws.emit("close");
      expect(t.connected).toBe(false);
    });
  });

  // ─── onMessage() ──────────────────────────────────────────────────────────

  describe("onMessage()", () => {
    it("fires handler with parsed outbound message", async () => {
      const { t, ws } = await createConnected();
      const handler = vi.fn();
      t.onMessage(handler);

      ws._message({ type: "assistant_message", text: "hello", done: false });

      expect(handler).toHaveBeenCalledWith({ type: "assistant_message", text: "hello", done: false });
    });

    it("returns an unsubscribe function that removes the handler", async () => {
      const { t, ws } = await createConnected();
      const handler = vi.fn();
      const unsub = t.onMessage(handler);

      unsub();
      ws._message({ type: "heartbeat" });

      expect(handler).not.toHaveBeenCalled();
    });

    it("silently drops malformed JSON messages", async () => {
      const { t, ws } = await createConnected();
      const handler = vi.fn();
      t.onMessage(handler);

      ws.emit("message", Buffer.from("not-valid-json{{"));

      expect(handler).not.toHaveBeenCalled();
    });

    it("delivers to multiple registered handlers", async () => {
      const { t, ws } = await createConnected();
      const h1 = vi.fn();
      const h2 = vi.fn();
      t.onMessage(h1);
      t.onMessage(h2);

      ws._message({ type: "heartbeat" });

      expect(h1).toHaveBeenCalledOnce();
      expect(h2).toHaveBeenCalledOnce();
    });

    it("forwards tool_start messages correctly", async () => {
      const { t, ws } = await createConnected();
      const handler = vi.fn();
      t.onMessage(handler);

      ws._message({ type: "tool_start", toolCallId: "tc-1", tool: "bash", input: "{}" });

      expect(handler).toHaveBeenCalledWith({ type: "tool_start", toolCallId: "tc-1", tool: "bash", input: "{}" });
    });
  });

  // ─── send() ───────────────────────────────────────────────────────────────

  describe("send()", () => {
    it("serializes and sends a user_message over the WebSocket", async () => {
      const { t, ws } = await createConnected();

      t.send({ type: "user_message", text: "hi there" });

      expect(ws.sent).toHaveLength(1);
      expect(JSON.parse(ws.sent[0])).toEqual({ type: "user_message", text: "hi there" });
    });

    it("throws 'Not connected' when no WebSocket exists", () => {
      const t = new RemoteTransport({ gatewayUrl: "http://localhost:8080", agentName: "agent", apiKey: "k" });
      expect(() => t.send({ type: "cancel" })).toThrow("Not connected");
    });

    it("throws 'Not connected' when WebSocket readyState is CLOSING", async () => {
      const { t, ws } = await createConnected();

      ws.readyState = 2; // CLOSING

      expect(() => t.send({ type: "cancel" })).toThrow("Not connected");
    });

    it("can send a cancel message", async () => {
      const { t, ws } = await createConnected();

      t.send({ type: "cancel" });

      expect(JSON.parse(ws.sent[0])).toEqual({ type: "cancel" });
    });
  });

  // ─── close() ──────────────────────────────────────────────────────────────

  describe("close()", () => {
    it("sends a shutdown message before closing the WebSocket", async () => {
      const { t, ws } = await createConnected();
      mockFetch.mockResolvedValueOnce({ ok: true } as any);

      await t.close();

      const found = ws.sent.some((s: string) => {
        try { return JSON.parse(s).type === "shutdown"; } catch { return false; }
      });
      expect(found).toBe(true);
    });

    it("calls DELETE on the session endpoint", async () => {
      const { t } = await createConnected({ sessionId: "close-sess", apiKey: "k" });
      mockFetch.mockResolvedValueOnce({ ok: true } as any);

      await t.close();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:8080/api/chat/sessions/close-sess",
        expect.objectContaining({
          method: "DELETE",
          headers: expect.objectContaining({ Authorization: "Bearer k" }),
        })
      );
    });

    it("sets connected=false after close", async () => {
      const { t } = await createConnected();
      mockFetch.mockResolvedValueOnce({ ok: true } as any);

      await t.close();

      expect(t.connected).toBe(false);
    });

    it("clears all registered message handlers", async () => {
      const { t, ws } = await createConnected();
      mockFetch.mockResolvedValueOnce({ ok: true } as any);

      const handler = vi.fn();
      t.onMessage(handler);

      await t.close();

      ws._message({ type: "heartbeat" });
      expect(handler).not.toHaveBeenCalled();
    });

    it("does not throw when the session DELETE request fails", async () => {
      const { t } = await createConnected();
      mockFetch.mockRejectedValueOnce(new Error("network error"));

      await expect(t.close()).resolves.not.toThrow();
    });

    it("handles close on an unconnected transport without errors", async () => {
      const t = new RemoteTransport({ gatewayUrl: "http://localhost:8080", agentName: "agent", apiKey: "k" });
      await expect(t.close()).resolves.not.toThrow();
      expect(t.connected).toBe(false);
    });
  });
});
