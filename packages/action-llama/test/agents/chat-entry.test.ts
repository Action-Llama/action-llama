/**
 * Tests for agents/chat-entry.ts (runChatMode)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Mock ws (WebSocket) - use vi.hoisted so the array is available in the factory
const { mockWsInstances } = vi.hoisted(() => ({
  mockWsInstances: [] as any[],
}));

vi.mock("ws", async () => {
  const { EventEmitter } = await import("events");
  class MockWebSocket extends EventEmitter {
    static OPEN = 1;
    static CONNECTING = 0;
    static CLOSING = 2;
    static CLOSED = 3;

    readyState = 0; // CONNECTING
    send = vi.fn();
    close = vi.fn().mockImplementation(function(this: any) {
      this.readyState = 3; // CLOSED
    });

    constructor(public url: string) {
      super();
      mockWsInstances.push(this);
      // Auto-connect after a tick
      setTimeout(() => {
        this.readyState = 1; // OPEN
        this.emit("open");
      }, 0);
    }
  }
  return { default: MockWebSocket, WebSocket: MockWebSocket };
});

const { mockSessionDispose, mockSessionPrompt, mockSessionSubscribe } = vi.hoisted(() => ({
  mockSessionDispose: vi.fn(),
  mockSessionPrompt: vi.fn().mockResolvedValue(undefined),
  mockSessionSubscribe: vi.fn(),
}));

vi.mock("@mariozechner/pi-ai", () => ({
  getModel: vi.fn().mockReturnValue({ id: "claude-sonnet", provider: "anthropic" }),
}));

vi.mock("@mariozechner/pi-coding-agent", () => ({
  AuthStorage: {
    create: vi.fn().mockReturnValue({ setRuntimeApiKey: vi.fn() }),
  },
  createAgentSession: vi.fn().mockResolvedValue({
    session: {
      dispose: mockSessionDispose,
      prompt: mockSessionPrompt,
      subscribe: mockSessionSubscribe,
    },
  }),
  DefaultResourceLoader: class {},
  SessionManager: { inMemory: vi.fn() },
  SettingsManager: { inMemory: vi.fn() },
  createCodingTools: vi.fn().mockReturnValue([]),
}));

vi.mock("../../src/agents/bash-prefix.js", () => ({
  BASH_COMMAND_PREFIX: "",
}));

vi.mock("../../src/agents/credential-setup.js", () => ({
  loadContainerCredentials: vi.fn().mockReturnValue({
    providerKeys: new Map([["anthropic", "sk-test-key"]]),
  }),
}));

vi.mock("../../src/chat/event-mapper.js", () => ({
  mapAgentEvent: vi.fn().mockReturnValue([]),
}));

import { runChatMode } from "../../src/agents/chat-entry.js";
import type { AgentInit } from "../../src/agents/container-entry.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeAgentInit(): AgentInit {
  return {
    agentConfig: {
      name: "test-agent",
      models: [{ provider: "anthropic", model: "claude-sonnet-4-20250514", authType: "api_key" }],
      credentials: [],
    } as any,
    resourceLoader: {} as any,
    settingsManager: {} as any,
    signalDir: "/tmp/signals",
    timeoutSeconds: 60,
    skillBody: "# Test Agent",
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("runChatMode", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWsInstances.length = 0;
    mockSessionSubscribe.mockImplementation(() => {});
    mockSessionPrompt.mockResolvedValue(undefined);
    originalEnv = { ...process.env };
    process.env.GATEWAY_URL = "http://localhost:3000";
    process.env.AL_CHAT_SESSION_ID = "test-session-123";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("throws if GATEWAY_URL is missing", async () => {
    delete process.env.GATEWAY_URL;
    await expect(runChatMode(makeAgentInit())).rejects.toThrow(
      "GATEWAY_URL and AL_CHAT_SESSION_ID required for chat mode"
    );
  });

  it("throws if AL_CHAT_SESSION_ID is missing", async () => {
    delete process.env.AL_CHAT_SESSION_ID;
    await expect(runChatMode(makeAgentInit())).rejects.toThrow(
      "GATEWAY_URL and AL_CHAT_SESSION_ID required for chat mode"
    );
  });

  it("resolves with 0 when WebSocket closes normally", async () => {
    const runPromise = runChatMode(makeAgentInit());
    await new Promise((r) => setTimeout(r, 20));

    const ws = mockWsInstances[0];
    expect(ws).toBeDefined();

    // Simulate WS close
    ws.emit("close");
    const code = await runPromise;
    expect(code).toBe(0);
  });

  it("resolves with 1 when WebSocket errors", async () => {
    const runPromise = runChatMode(makeAgentInit());
    await new Promise((r) => setTimeout(r, 20));

    const ws = mockWsInstances[0];
    ws.emit("error", new Error("connection refused"));
    const code = await runPromise;
    expect(code).toBe(1);
  });

  it("sends auth token on WS open", async () => {
    const runPromise = runChatMode(makeAgentInit());
    await new Promise((r) => setTimeout(r, 20));

    const ws = mockWsInstances[0];
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "auth", token: "test-session-123" })
    );

    ws.emit("close");
    await runPromise;
  });

  it("handles auth_ok message", async () => {
    const runPromise = runChatMode(makeAgentInit());
    await new Promise((r) => setTimeout(r, 20));

    const ws = mockWsInstances[0];
    ws.emit("message", JSON.stringify({ type: "auth_ok" }));
    // auth_ok just logs, no error
    ws.emit("close");
    await runPromise;
  });

  it("handles invalid JSON in message gracefully", async () => {
    const runPromise = runChatMode(makeAgentInit());
    await new Promise((r) => setTimeout(r, 20));

    const ws = mockWsInstances[0];
    ws.emit("message", "not-valid-json{{{");
    // Should not throw
    ws.emit("close");
    const code = await runPromise;
    expect(code).toBe(0);
  });

  it("handles user_message when agent is not busy", async () => {
    const runPromise = runChatMode(makeAgentInit());
    await new Promise((r) => setTimeout(r, 20));

    const ws = mockWsInstances[0];
    ws.emit("message", JSON.stringify({ type: "user_message", text: "Hello agent" }));
    await new Promise((r) => setTimeout(r, 10));

    expect(mockSessionPrompt).toHaveBeenCalledWith("Hello agent");

    ws.emit("close");
    await runPromise;
  });

  it("handles user_message when agent is busy (sends error)", async () => {
    // Make session.prompt never resolve to keep agentBusy = true
    mockSessionPrompt.mockImplementation(() => new Promise(() => {}));

    const runPromise = runChatMode(makeAgentInit());
    await new Promise((r) => setTimeout(r, 20));

    const ws = mockWsInstances[0];

    // First message sets busy = true
    ws.emit("message", JSON.stringify({ type: "user_message", text: "First" }));
    await new Promise((r) => setTimeout(r, 10));

    // Second message should get an error because agent is busy
    ws.emit("message", JSON.stringify({ type: "user_message", text: "Second" }));
    await new Promise((r) => setTimeout(r, 10));

    const sentMessages = ws.send.mock.calls.map((c: any[]) => JSON.parse(c[0]));
    const busyError = sentMessages.find((m: any) => m.type === "error");
    expect(busyError?.message).toContain("busy");

    ws.emit("close");
    await runPromise;
  });

  it("handles cancel message when agent is busy", async () => {
    mockSessionPrompt.mockImplementation(() => new Promise(() => {}));

    const runPromise = runChatMode(makeAgentInit());
    await new Promise((r) => setTimeout(r, 20));

    const ws = mockWsInstances[0];

    // Make agent busy
    ws.emit("message", JSON.stringify({ type: "user_message", text: "Hello" }));
    await new Promise((r) => setTimeout(r, 10));

    // Cancel the busy agent
    ws.emit("message", JSON.stringify({ type: "cancel" }));
    await new Promise((r) => setTimeout(r, 10));

    expect(mockSessionDispose).toHaveBeenCalled();

    ws.emit("close");
    await runPromise;
  });

  it("handles shutdown message", async () => {
    const runPromise = runChatMode(makeAgentInit());
    await new Promise((r) => setTimeout(r, 20));

    const ws = mockWsInstances[0];
    ws.emit("message", JSON.stringify({ type: "shutdown" }));
    const code = await runPromise;
    expect(code).toBe(0);
  });

  it("handles session prompt error when agent is processing", async () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockSessionPrompt.mockRejectedValueOnce(new Error("model error"));

    const runPromise = runChatMode(makeAgentInit());
    await new Promise((r) => setTimeout(r, 20));

    const ws = mockWsInstances[0];
    ws.emit("message", JSON.stringify({ type: "user_message", text: "Hello" }));
    await new Promise((r) => setTimeout(r, 50));

    // After prompt error, agent should not be busy and error should be sent
    const sentMessages = ws.send.mock.calls.map((c: any[]) => JSON.parse(c[0]));
    const errorMsg = sentMessages.find((m: any) => m.type === "error");
    expect(errorMsg?.message).toBe("model error");

    consoleLogSpy.mockRestore();
    ws.emit("close");
    await runPromise;
  });

  it("heartbeat sends message to WS when open", async () => {
    vi.useFakeTimers();
    try {
      const runPromise = runChatMode(makeAgentInit());

      // Advance just 1ms so the WS setTimeout(0) fires and WS becomes OPEN
      await vi.advanceTimersByTimeAsync(1);
      const ws = mockWsInstances[0];
      expect(ws).toBeDefined();
      expect(ws.readyState).toBe(1); // OPEN

      // Advance past heartbeat interval (30_000ms) but less than idle timeout (60_000ms)
      await vi.advanceTimersByTimeAsync(30_001);

      const sentMessages = ws.send.mock.calls.map((c: any[]) => {
        try { return JSON.parse(c[0]); } catch { return null; }
      });
      const heartbeatMsg = sentMessages.find((m: any) => m?.type === "heartbeat");
      expect(heartbeatMsg).toBeDefined();

      ws.emit("close");
      await runPromise;
    } finally {
      vi.useRealTimers();
    }
  });

  it("session subscribe callback forwards outbound messages to WS", async () => {
    const { mapAgentEvent } = await import("../../src/chat/event-mapper.js");
    // Make mapAgentEvent return an assistant message
    vi.mocked(mapAgentEvent).mockReturnValueOnce([
      { type: "assistant_message", text: "Hello!", done: true } as any,
    ]);

    let capturedSubscribeCallback: ((event: any) => void) | null = null;
    mockSessionSubscribe.mockImplementation((cb: (event: any) => void) => {
      capturedSubscribeCallback = cb;
    });

    const runPromise = runChatMode(makeAgentInit());
    await new Promise((r) => setTimeout(r, 20));

    const ws = mockWsInstances[0];

    // Trigger the session subscribe callback
    capturedSubscribeCallback?.({ type: "some-event" });
    await new Promise((r) => setTimeout(r, 10));

    // WS should have received the forwarded message
    const sentMessages = ws.send.mock.calls.map((c: any[]) => {
      try { return JSON.parse(c[0]); } catch { return null; }
    });
    const assistantMsg = sentMessages.find((m: any) => m?.type === "assistant_message");
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg?.text).toBe("Hello!");

    ws.emit("close");
    await runPromise;
  });
});
