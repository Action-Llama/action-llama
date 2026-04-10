import type { Server } from "http";
import { WebSocketServer } from "ws";
import { safeCompare } from "../control/auth.js";
import type { ApiKeySource } from "../control/auth.js";
import type { SessionAttachManager } from "../execution/attach/index.js";
import type { Logger } from "../shared/logger.js";

// Pattern: /sessions/<id>/attach
const ATTACH_RE = /^\/sessions\/([^/?]+)\/attach(?:\?.*)?$/;

/**
 * Attach a WebSocket upgrade handler to the raw HTTP server.
 *
 * Hono's fetch model cannot handle HTTP upgrade events, so we listen directly
 * on the Node.js Server instance using the ws package in noServer mode.
 *
 * Auth: Bearer token in Authorization header, compared against apiKey.
 */
export function applyAttachUpgradeHandler(
  server: Server,
  attachManager: SessionAttachManager,
  apiKey: ApiKeySource,
  logger: Logger,
): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (req, socket, head) => {
    const url = req.url ?? "";
    const match = ATTACH_RE.exec(url);
    if (!match) {
      socket.destroy();
      return;
    }
    const sessionId = match[1];

    // Authenticate
    const authHeader = req.headers["authorization"] ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const currentKey = typeof apiKey === "function" ? await apiKey() : apiKey;
    if (!currentKey || !token || !safeCompare(token, currentKey)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n");
      socket.destroy();
      logger.warn({ sessionId }, "WebSocket attach rejected: unauthorized");
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      logger.info({ sessionId }, "WebSocket client attached to session");
      attachManager.attach(sessionId, ws);
    });
  });
}
