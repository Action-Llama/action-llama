import type { Hono } from "hono";
import { authMiddleware, type ApiKeySource } from "../../control/auth.js";
import { registerAuthApiRoutes } from "../../control/routes/dashboard-api.js";
import type { SessionStore } from "../../control/session-store.js";

/**
 * Apply authentication middleware to all protected routes and register
 * the auth API endpoints (login/logout/check).
 *
 * The SessionStore is passed in (created once in stores.ts) and shared
 * between the auth middleware, chat auth, and chat WebSocket handler.
 */
export function applyAuthMiddleware(
  app: Hono,
  apiKey: ApiKeySource,
  sessionStore: SessionStore | undefined,
  hostname?: string,
): void {
  const auth = authMiddleware(apiKey, sessionStore);

  // Protected route patterns — includes chat auth, unified here to avoid duplication
  app.use("/control/*", auth);
  app.use("/dashboard/api/*", auth);
  app.use("/locks/status", auth);
  app.use("/api/logs/*", auth);
  app.use("/api/stats/*", auth);
  app.use("/api/dashboard/*", auth);
  app.use("/api/auth/check", auth);
  app.use("/api/webhooks/*", auth);
  app.use("/api/chat/*", auth);

  // JSON auth endpoints for the SPA (login is unprotected, check is protected)
  registerAuthApiRoutes(app, apiKey, sessionStore, hostname);
}
