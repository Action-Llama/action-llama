/**
 * REST API routes for chat session management.
 */

import type { Hono } from "hono";
import type { ChatSessionManager } from "./session-manager.js";
import type { Logger } from "../shared/logger.js";

export type LaunchChatCallback = (agentName: string, sessionId: string) => Promise<void>;
export type StopChatCallback = (sessionId: string) => Promise<void>;

export function registerChatApiRoutes(
  app: Hono,
  sessionManager: ChatSessionManager,
  launchCallback: LaunchChatCallback,
  stopCallback: StopChatCallback,
  logger?: Logger,
): void {
  // Create a new chat session and launch a container
  app.post("/api/chat/sessions", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const agentName = body.agentName;
    if (!agentName || typeof agentName !== "string") {
      return c.json({ error: "agentName is required" }, 400);
    }

    if (!sessionManager.canCreateSession()) {
      return c.json({ error: "Chat session limit reached" }, 429);
    }

    try {
      const session = sessionManager.createSession(agentName);
      logger?.info({ sessionId: session.sessionId, agentName }, "chat session created");

      // Launch container asynchronously
      launchCallback(agentName, session.sessionId).catch((err) => {
        logger?.error({ sessionId: session.sessionId, err: err.message }, "failed to launch chat container");
        sessionManager.removeSession(session.sessionId);
      });

      return c.json({ sessionId: session.sessionId });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  // Delete a chat session and stop its container
  app.delete("/api/chat/sessions/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    try {
      await stopCallback(sessionId);
    } catch (err: any) {
      logger?.warn({ sessionId, err: err.message }, "error stopping chat container");
    }

    sessionManager.removeSession(sessionId);
    logger?.info({ sessionId }, "chat session deleted");
    return c.json({ success: true });
  });

  // List active chat sessions
  app.get("/api/chat/sessions", (c) => {
    const sessions = sessionManager.listSessions().map((s) => ({
      sessionId: s.sessionId,
      agentName: s.agentName,
      containerName: s.containerName,
      createdAt: s.createdAt.toISOString(),
      lastActivityAt: s.lastActivityAt.toISOString(),
    }));
    return c.json({ sessions });
  });
}
