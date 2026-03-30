import type { Server } from "http";
import type { Hono } from "hono";
import { ChatSessionManager } from "../../chat/session-manager.js";
import {
  registerChatApiRoutes,
  type LaunchChatCallback,
  type StopChatCallback,
} from "../../chat/routes.js";
import { attachChatWebSocket, type ChatWebSocketState } from "../../chat/ws-handler.js";
import type { ApiKeySource } from "../../control/auth.js";
import type { SessionStore } from "../../control/session-store.js";
import type { Logger } from "../../shared/logger.js";

export interface ChatSetup {
  chatSessionManager: ChatSessionManager;
}

/**
 * Create the chat session manager and register chat API routes.
 * Returns the session manager so it can be passed to `attachChatWebSocketToServer`.
 */
export function registerChatRoutes(
  app: Hono,
  opts: {
    maxChatSessions?: number;
    launchChatContainer?: LaunchChatCallback;
    stopChatContainer?: StopChatCallback;
    logger: Logger;
  },
): ChatSetup {
  const { maxChatSessions, launchChatContainer, stopChatContainer, logger } = opts;

  const chatSessionManager = new ChatSessionManager(maxChatSessions);

  const noopLaunch: LaunchChatCallback = async () => {};
  const noopStop: StopChatCallback = async () => {};

  registerChatApiRoutes(
    app,
    chatSessionManager,
    launchChatContainer || noopLaunch,
    stopChatContainer || noopStop,
    logger,
  );

  return { chatSessionManager };
}

/**
 * Attach the chat WebSocket handler to the raw HTTP server.
 * Must be called after the server is listening.
 */
export function attachChatWebSocketToServer(
  server: Server,
  opts: {
    chatSessionManager: ChatSessionManager;
    apiKey: ApiKeySource;
    sessionStore?: SessionStore;
    logger: Logger;
  },
): ChatWebSocketState {
  const { chatSessionManager, apiKey, sessionStore, logger } = opts;
  return attachChatWebSocket(server, chatSessionManager, apiKey, sessionStore, logger);
}
