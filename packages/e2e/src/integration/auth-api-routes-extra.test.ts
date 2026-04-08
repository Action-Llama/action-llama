/**
 * Integration tests: control/routes/dashboard-api.ts registerAuthApiRoutes()
 * additional branches — no Docker required.
 *
 * The existing tests (gateway-auth-api.test.ts, auth-json-api-noagent.test.ts)
 * cover the normal happy path with apiKey + sessionStore. This file covers
 * the remaining branches in registerAuthApiRoutes():
 *
 *   1. apiKey=undefined → POST /api/auth/login returns 200 { success: true } without checking key
 *   2. apiKey as async function returning undefined → POST /api/auth/login returns 200 { success: true }
 *   3. sessionStore=undefined + correct key → cookie set to currentKey (backward compat)
 *   4. hostname non-localhost → Secure flag added to Set-Cookie header
 *   5. hostname=localhost → no Secure flag
 *   6. POST /api/auth/logout without sessionStore → 200 (no session to delete)
 *   7. POST /api/auth/logout with sessionStore → deleteSession called for al_session cookie
 *
 * Covers:
 *   - control/routes/dashboard-api.ts: registerAuthApiRoutes() — apiKey=undefined → 200 success
 *   - control/routes/dashboard-api.ts: registerAuthApiRoutes() — async apiKey returns undefined → 200 success
 *   - control/routes/dashboard-api.ts: registerAuthApiRoutes() — no sessionStore → cookie=currentKey
 *   - control/routes/dashboard-api.ts: registerAuthApiRoutes() — non-localhost hostname → Secure cookie
 *   - control/routes/dashboard-api.ts: registerAuthApiRoutes() — localhost hostname → no Secure flag
 *   - control/routes/dashboard-api.ts: registerAuthApiRoutes() — POST /api/auth/logout no sessionStore → 200
 *   - control/routes/dashboard-api.ts: registerAuthApiRoutes() — POST /api/auth/logout with sessionStore → deleteSession
 */

import { describe, it, expect, vi } from "vitest";

const { Hono } = await import(
  /* @vite-ignore */
  "/tmp/repo/node_modules/hono/dist/index.js"
);

const { registerAuthApiRoutes } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/control/routes/dashboard-api.js"
);

const API_KEY = "test-api-key-xyz456";

function makeApp(opts: {
  apiKey?: any;
  sessionStore?: any;
  hostname?: string;
}) {
  const app = new Hono();
  registerAuthApiRoutes(app, opts.apiKey, opts.sessionStore, opts.hostname);
  return app;
}

async function login(app: any, key?: string) {
  return app.request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(key !== undefined ? { key } : {}),
  });
}

async function logout(app: any, cookie?: string) {
  const headers: Record<string, string> = {};
  if (cookie) headers["Cookie"] = cookie;
  return app.request("/api/auth/logout", { method: "POST", headers });
}

describe(
  "integration: registerAuthApiRoutes() additional branches (no Docker required)",
  { timeout: 15_000 },
  () => {
    // ── apiKey=undefined → always success ─────────────────────────────────────

    it("apiKey=undefined → POST /api/auth/login returns 200 { success: true }", async () => {
      const app = makeApp({ apiKey: undefined });
      const res = await login(app, "wrong-key");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });

    it("apiKey=undefined → no Set-Cookie header (no key to set)", async () => {
      const app = makeApp({ apiKey: undefined });
      const res = await login(app, "any-key");
      expect(res.status).toBe(200);
      // No cookie is set when apiKey is undefined (early return)
      const setCookie = res.headers.get("set-cookie") || "";
      expect(setCookie).toBe(""); // no cookie
    });

    // ── async apiKey returns undefined → skip auth ─────────────────────────────

    it("async apiKey returning undefined → 200 { success: true } (no key configured)", async () => {
      const app = makeApp({ apiKey: async () => undefined });
      const res = await login(app, "any-key");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });

    // ── No sessionStore → cookie set to currentKey ─────────────────────────────

    it("no sessionStore + correct key → Set-Cookie al_session=<key>", async () => {
      const app = makeApp({ apiKey: API_KEY, sessionStore: undefined });
      const res = await login(app, API_KEY);
      expect(res.status).toBe(200);
      const setCookie = res.headers.get("set-cookie") || "";
      expect(setCookie).toContain(`al_session=${API_KEY}`);
    });

    it("no sessionStore + correct key → HttpOnly and SameSite=Strict in cookie", async () => {
      const app = makeApp({ apiKey: API_KEY, sessionStore: undefined });
      const res = await login(app, API_KEY);
      const setCookie = res.headers.get("set-cookie") || "";
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("SameSite=Strict");
    });

    // ── Hostname → Secure cookie flag ──────────────────────────────────────────

    it("non-localhost hostname → Secure flag in Set-Cookie", async () => {
      const app = makeApp({ apiKey: API_KEY, hostname: "my-server.example.com" });
      const res = await login(app, API_KEY);
      const setCookie = res.headers.get("set-cookie") || "";
      expect(setCookie).toContain("Secure");
    });

    it("hostname='localhost' → no Secure flag in Set-Cookie", async () => {
      const app = makeApp({ apiKey: API_KEY, hostname: "localhost" });
      const res = await login(app, API_KEY);
      const setCookie = res.headers.get("set-cookie") || "";
      // Should NOT contain Secure for localhost
      expect(setCookie).not.toContain("Secure");
    });

    it("hostname='127.0.0.1' → no Secure flag in Set-Cookie", async () => {
      const app = makeApp({ apiKey: API_KEY, hostname: "127.0.0.1" });
      const res = await login(app, API_KEY);
      const setCookie = res.headers.get("set-cookie") || "";
      expect(setCookie).not.toContain("Secure");
    });

    it("hostname=undefined → no Secure flag in Set-Cookie (isLocalhost=true)", async () => {
      const app = makeApp({ apiKey: API_KEY });
      const res = await login(app, API_KEY);
      const setCookie = res.headers.get("set-cookie") || "";
      expect(setCookie).not.toContain("Secure");
    });

    // ── POST /api/auth/logout ──────────────────────────────────────────────────

    it("logout without sessionStore → 200 { success: true }", async () => {
      const app = makeApp({ apiKey: API_KEY, sessionStore: undefined });
      const res = await logout(app);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });

    it("logout without sessionStore → Max-Age=0 cookie to clear session", async () => {
      const app = makeApp({ apiKey: API_KEY, sessionStore: undefined });
      const res = await logout(app);
      const setCookie = res.headers.get("set-cookie") || "";
      expect(setCookie).toContain("Max-Age=0");
    });

    it("logout with sessionStore and al_session cookie → deleteSession called", async () => {
      const deletedSessions: string[] = [];
      const sessionStore = {
        createSession: vi.fn(async () => "mock-session-id"),
        getSession: vi.fn(async () => null),
        deleteSession: vi.fn(async (id: string) => { deletedSessions.push(id); }),
      };
      const app = makeApp({ apiKey: API_KEY, sessionStore });

      const res = await logout(app, "al_session=my-session-token; other=val");
      expect(res.status).toBe(200);
      expect(deletedSessions).toContain("my-session-token");
    });

    it("logout with sessionStore but no al_session cookie → 200 (no session to delete)", async () => {
      const sessionStore = {
        deleteSession: vi.fn(async () => {}),
      };
      const app = makeApp({ apiKey: API_KEY, sessionStore });
      const res = await logout(app, "other-cookie=value");
      expect(res.status).toBe(200);
      expect(sessionStore.deleteSession).not.toHaveBeenCalled();
    });
  },
);
