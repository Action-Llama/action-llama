import type { Context, Next } from "hono";
import { timingSafeEqual } from "crypto";
import type { SessionStore } from "./session-store.js";

/**
 * Timing-safe string comparison.
 */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Hono middleware that authenticates requests via:
 * 1. `Authorization: Bearer <key>` header (CLI / programmatic)
 * 2. `al_session` cookie (browser / Web UI)
 *
 * When a SessionStore is provided, the cookie value is treated as an opaque
 * session ID looked up server-side. Without a SessionStore, the cookie value
 * is compared directly to the API key (backward compatibility).
 *
 * Browser HTML requests to protected paths are redirected to /login on 401.
 */
export function authMiddleware(apiKey: string, sessionStore?: SessionStore) {
  return async (c: Context, next: Next) => {
    // 1. Check Bearer token
    const authHeader = c.req.header("Authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      if (safeCompare(token, apiKey)) {
        await next();
        return;
      }
    }

    // 2. Check session cookie
    const cookie = parseCookie(c.req.header("Cookie") || "");
    const sessionToken = cookie["al_session"];
    if (sessionToken) {
      if (sessionStore) {
        // Session store present: validate as opaque session ID
        const session = await sessionStore.getSession(sessionToken);
        if (session) {
          await next();
          return;
        }
      } else {
        // Backward compatibility: compare cookie value directly to API key
        if (safeCompare(sessionToken, apiKey)) {
          await next();
          return;
        }
      }
    }

    // 401 — redirect browsers to login page, return JSON for API clients
    const accept = c.req.header("Accept") || "";
    if (accept.includes("text/html")) {
      return c.redirect("/login");
    }
    return c.json({ error: "Unauthorized" }, 401);
  };
}

/**
 * Minimal cookie parser — returns key=value pairs from the Cookie header.
 */
function parseCookie(header: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    result[key] = val;
  }
  return result;
}
