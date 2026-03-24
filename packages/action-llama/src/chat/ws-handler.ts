/**
 * WebSocket handler for chat — bridges browser ↔ container per session.
 *
 * Two WS paths:
 *   /chat/ws/:sessionId      — browser connects here (auth via header/cookie)
 *   /chat/container/:sessionId — container connects here (auth via first-message token)
 */

import type { Server } from "http";
import type { IncomingMessage } from "http";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { safeCompare } from "../control/auth.js";
import type { ChatSessionManager } from "./session-manager.js";
import { validateInbound, validateOutbound, RateLimiter } from "./validation.js";
import type { SessionStore } from "../control/session-store.js";
import type { Logger } from "../shared/logger.js";

interface BrowserConnection {
  ws: WebSocket;
  rateLimiter: RateLimiter;
}

interface ContainerConnection {
  ws: WebSocket;
  authenticated: boolean;
}

export interface ChatWebSocketState {
  browserConnections: Map<string, BrowserConnection>;
  containerConnections: Map<string, ContainerConnection>;
  cleanupInterval: ReturnType<typeof setInterval>;
  /** Callback to stop a chat container by session. */
  stopContainer?: (sessionId: string) => Promise<void>;
}

export function attachChatWebSocket(
  server: Server,
  sessionManager: ChatSessionManager,
  apiKey: string,
  sessionStore?: SessionStore,
  logger?: Logger,
): ChatWebSocketState {
  const browserConnections = new Map<string, BrowserConnection>();
  const containerConnections = new Map<string, ContainerConnection>();

  // Browser-facing WS server
  const browserWss = new WebSocketServer({ noServer: true });
  // Container-facing WS server
  const containerWss = new WebSocketServer({ noServer: true });

  // Disconnection grace periods: track when browser disconnected
  const browserDisconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

  server.on("upgrade", async (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    // Browser path: /chat/ws/:sessionId
    const browserMatch = pathname.match(/^\/chat\/ws\/([^/]+)$/);
    if (browserMatch) {
      const sessionId = browserMatch[1];
      const session = sessionManager.getSession(sessionId);
      if (!session) {
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
        socket.destroy();
        return;
      }

      // Authenticate via Authorization header or cookie
      const authenticated = await authenticateBrowser(req, apiKey, sessionStore);
      if (!authenticated) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      browserWss.handleUpgrade(req, socket, head, (ws) => {
        handleBrowserConnection(ws, sessionId);
      });
      return;
    }

    // Container path: /chat/container/:sessionId
    const containerMatch = pathname.match(/^\/chat\/container\/([^/]+)$/);
    if (containerMatch) {
      const sessionId = containerMatch[1];
      const session = sessionManager.getSession(sessionId);
      if (!session) {
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
        socket.destroy();
        return;
      }

      containerWss.handleUpgrade(req, socket, head, (ws) => {
        handleContainerConnection(ws, sessionId);
      });
      return;
    }

    // Not a chat path — let other upgrade handlers deal with it
  });

  function handleBrowserConnection(ws: WebSocket, sessionId: string) {
    logger?.debug({ sessionId }, "browser WebSocket connected");

    // Clear any grace-period timer from a prior disconnect
    const timer = browserDisconnectTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      browserDisconnectTimers.delete(sessionId);
    }

    const conn: BrowserConnection = { ws, rateLimiter: new RateLimiter() };
    browserConnections.set(sessionId, conn);

    ws.on("message", (data: RawData) => {
      const raw = data.toString();
      sessionManager.touchSession(sessionId);

      if (!conn.rateLimiter.consume()) {
        ws.send(JSON.stringify({ type: "error", message: "Rate limited" }));
        return;
      }

      const validation = validateInbound(raw);
      if (!validation.valid) {
        ws.send(JSON.stringify({ type: "error", message: validation.error }));
        return;
      }

      // Forward to container
      const containerConn = containerConnections.get(sessionId);
      if (containerConn?.authenticated && containerConn.ws.readyState === WebSocket.OPEN) {
        containerConn.ws.send(raw);
      } else {
        ws.send(JSON.stringify({ type: "error", message: "Agent container not connected" }));
      }
    });

    ws.on("close", () => {
      logger?.debug({ sessionId }, "browser WebSocket disconnected");
      browserConnections.delete(sessionId);

      // Grace period: wait 60s before shutting down the container
      const gracePeriod = setTimeout(() => {
        browserDisconnectTimers.delete(sessionId);
        logger?.info({ sessionId }, "browser grace period expired, shutting down container");
        shutdownSession(sessionId);
      }, 60_000);
      browserDisconnectTimers.set(sessionId, gracePeriod);
    });

    ws.on("error", (err) => {
      logger?.warn({ sessionId, err: err.message }, "browser WebSocket error");
    });
  }

  function handleContainerConnection(ws: WebSocket, sessionId: string) {
    logger?.debug({ sessionId }, "container WebSocket connected");

    const conn: ContainerConnection = { ws, authenticated: false };
    containerConnections.set(sessionId, conn);

    // Container must authenticate with session token in first message within 5s
    const authTimeout = setTimeout(() => {
      if (!conn.authenticated) {
        logger?.warn({ sessionId }, "container auth timeout");
        ws.close(4001, "Auth timeout");
        containerConnections.delete(sessionId);
      }
    }, 5000);

    ws.on("message", (data: RawData) => {
      const raw = data.toString();

      // First message must be auth token
      if (!conn.authenticated) {
        try {
          const msg = JSON.parse(raw);
          if (msg.type === "auth" && typeof msg.token === "string") {
            const session = sessionManager.getSession(sessionId);
            if (session && safeCompare(msg.token, sessionId)) {
              conn.authenticated = true;
              clearTimeout(authTimeout);
              ws.send(JSON.stringify({ type: "auth_ok" }));
              logger?.info({ sessionId }, "container authenticated");
              return;
            }
          }
        } catch { /* invalid JSON */ }
        ws.close(4003, "Auth failed");
        containerConnections.delete(sessionId);
        clearTimeout(authTimeout);
        return;
      }

      sessionManager.touchSession(sessionId);

      // Validate outbound message from container
      const validation = validateOutbound(raw);
      if (!validation.valid) {
        logger?.warn({ sessionId, error: validation.error }, "invalid outbound from container");
        return;
      }

      // Forward to browser
      const browserConn = browserConnections.get(sessionId);
      if (browserConn && browserConn.ws.readyState === WebSocket.OPEN) {
        browserConn.ws.send(raw);
      }
    });

    ws.on("close", () => {
      logger?.debug({ sessionId }, "container WebSocket disconnected");
      containerConnections.delete(sessionId);

      // Notify browser
      const browserConn = browserConnections.get(sessionId);
      if (browserConn && browserConn.ws.readyState === WebSocket.OPEN) {
        browserConn.ws.send(JSON.stringify({ type: "error", message: "Agent container disconnected" }));
      }

      sessionManager.removeSession(sessionId);
    });

    ws.on("error", (err) => {
      logger?.warn({ sessionId, err: err.message }, "container WebSocket error");
    });
  }

  async function shutdownSession(sessionId: string) {
    // Send shutdown to container
    const containerConn = containerConnections.get(sessionId);
    if (containerConn?.authenticated && containerConn.ws.readyState === WebSocket.OPEN) {
      containerConn.ws.send(JSON.stringify({ type: "shutdown" }));
      containerConn.ws.close();
    }
    containerConnections.delete(sessionId);

    // Close browser connection
    const browserConn = browserConnections.get(sessionId);
    if (browserConn && browserConn.ws.readyState === WebSocket.OPEN) {
      browserConn.ws.close();
    }
    browserConnections.delete(sessionId);

    // Stop container via callback
    if (state.stopContainer) {
      try {
        await state.stopContainer(sessionId);
      } catch (err: any) {
        logger?.warn({ sessionId, err: err.message }, "failed to stop chat container");
      }
    }

    sessionManager.removeSession(sessionId);
  }

  // Idle session cleanup interval (Phase 8)
  const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
  const cleanupInterval = setInterval(() => {
    const idle = sessionManager.getIdleSessions(IDLE_TIMEOUT_MS);
    for (const session of idle) {
      logger?.info({ sessionId: session.sessionId, agentName: session.agentName }, "cleaning up idle chat session");
      shutdownSession(session.sessionId);
    }
  }, 60_000);
  cleanupInterval.unref();

  const state: ChatWebSocketState = {
    browserConnections,
    containerConnections,
    cleanupInterval,
  };

  return state;
}

// --- Auth helpers ---

async function authenticateBrowser(
  req: IncomingMessage,
  apiKey: string,
  sessionStore?: SessionStore,
): Promise<boolean> {
  // Check Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    if (safeCompare(token, apiKey)) return true;
  }

  // Check al_session cookie
  const cookieHeader = req.headers.cookie || "";
  const sessionToken = parseCookie(cookieHeader)["al_session"];
  if (sessionToken) {
    if (sessionStore) {
      const session = await sessionStore.getSession(sessionToken);
      if (session) return true;
    } else {
      if (safeCompare(sessionToken, apiKey)) return true;
    }
  }

  return false;
}

function parseCookie(header: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    result[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return result;
}
