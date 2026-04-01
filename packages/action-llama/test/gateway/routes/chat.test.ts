/**
 * Unit tests for gateway/routes/chat.ts
 *
 * Verifies that registerChatRoutes:
 * 1. Creates and returns a ChatSessionManager
 * 2. Registers chat API routes on the app
 * 3. Uses noop callbacks when launchChatContainer/stopChatContainer are not provided
 * 4. Passes provided callbacks through to registerChatApiRoutes
 *
 * Also verifies attachChatWebSocketToServer delegates to attachChatWebSocket.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

// Mock the dependencies
vi.mock("../../../src/chat/session-manager.js", () => {
  const MockChatSessionManager = vi.fn().mockImplementation(function(maxSessions?: number) {
    (this as any)._maxSessions = maxSessions;
    (this as any).createSession = vi.fn().mockResolvedValue("session-id");
    (this as any).getSession = vi.fn();
    (this as any).deleteSession = vi.fn();
    (this as any).listSessions = vi.fn().mockReturnValue([]);
  });
  return { ChatSessionManager: MockChatSessionManager };
});

vi.mock("../../../src/chat/routes.js", () => ({
  registerChatApiRoutes: vi.fn(),
}));

vi.mock("../../../src/chat/ws-handler.js", () => ({
  attachChatWebSocket: vi.fn().mockReturnValue({ connections: new Map() }),
}));

import { registerChatRoutes, attachChatWebSocketToServer } from "../../../src/gateway/routes/chat.js";
import { ChatSessionManager } from "../../../src/chat/session-manager.js";
import { registerChatApiRoutes } from "../../../src/chat/routes.js";
import { attachChatWebSocket } from "../../../src/chat/ws-handler.js";

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as any;

describe("registerChatRoutes", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new Hono();
  });

  it("creates a ChatSessionManager with the provided maxChatSessions", () => {
    registerChatRoutes(app, { maxChatSessions: 5, logger: mockLogger });

    expect(ChatSessionManager).toHaveBeenCalledWith(5);
  });

  it("creates a ChatSessionManager without maxChatSessions when not provided", () => {
    registerChatRoutes(app, { logger: mockLogger });

    expect(ChatSessionManager).toHaveBeenCalledWith(undefined);
  });

  it("returns a ChatSetup with the created chatSessionManager", () => {
    const result = registerChatRoutes(app, { logger: mockLogger });

    expect(result).toHaveProperty("chatSessionManager");
    expect(result.chatSessionManager).toBeDefined();
  });

  it("calls registerChatApiRoutes with the app, session manager, and logger", () => {
    const launchMock = vi.fn().mockResolvedValue(undefined);
    const stopMock = vi.fn().mockResolvedValue(undefined);

    registerChatRoutes(app, {
      launchChatContainer: launchMock,
      stopChatContainer: stopMock,
      logger: mockLogger,
    });

    expect(registerChatApiRoutes).toHaveBeenCalledWith(
      app,
      expect.any(Object), // chatSessionManager
      launchMock,
      stopMock,
      mockLogger,
    );
  });

  it("uses noop callbacks when launchChatContainer is not provided", () => {
    registerChatRoutes(app, { logger: mockLogger });

    const [, , launchCallback] = vi.mocked(registerChatApiRoutes).mock.calls[0];
    // Noop should resolve without error
    expect(launchCallback).toBeDefined();
    expect(launchCallback("agent", "session")).resolves.toBeUndefined();
  });

  it("uses noop callbacks when stopChatContainer is not provided", () => {
    registerChatRoutes(app, { logger: mockLogger });

    const [, , , stopCallback] = vi.mocked(registerChatApiRoutes).mock.calls[0];
    // Noop should resolve without error
    expect(stopCallback).toBeDefined();
    expect(stopCallback("agent", "session")).resolves.toBeUndefined();
  });
});

describe("attachChatWebSocketToServer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates to attachChatWebSocket with correct arguments", () => {
    const mockServer = {} as any;
    const mockSessionManager = {} as any;
    const mockApiKey = "test-key";
    const mockSessionStore = {} as any;

    attachChatWebSocketToServer(mockServer, {
      chatSessionManager: mockSessionManager,
      apiKey: mockApiKey,
      sessionStore: mockSessionStore,
      logger: mockLogger,
    });

    expect(attachChatWebSocket).toHaveBeenCalledWith(
      mockServer,
      mockSessionManager,
      mockApiKey,
      mockSessionStore,
      mockLogger,
    );
  });

  it("passes undefined sessionStore when not provided", () => {
    const mockServer = {} as any;
    const mockSessionManager = {} as any;

    attachChatWebSocketToServer(mockServer, {
      chatSessionManager: mockSessionManager,
      apiKey: "test-key",
      logger: mockLogger,
    });

    expect(attachChatWebSocket).toHaveBeenCalledWith(
      mockServer,
      mockSessionManager,
      "test-key",
      undefined,
      mockLogger,
    );
  });

  it("returns the result from attachChatWebSocket", () => {
    const mockResult = { connections: new Map() };
    vi.mocked(attachChatWebSocket).mockReturnValue(mockResult as any);

    const mockServer = {} as any;
    const result = attachChatWebSocketToServer(mockServer, {
      chatSessionManager: {} as any,
      apiKey: "key",
      logger: mockLogger,
    });

    expect(result).toBe(mockResult);
  });
});
