/**
 * Integration tests: control/auth.ts authMiddleware() backward-compat cookie path
 * — no Docker required.
 *
 * authMiddleware() has THREE auth paths:
 *   1. Authorization: Bearer <key> header
 *   2. al_session cookie with SessionStore (session lookup)
 *   3. al_session cookie WITHOUT SessionStore — backward compat: cookie value
 *      is compared directly to the API key
 *
 * Path 3 is the backward-compat path tested here. It exercises:
 *   - control/auth.ts line 71: safeCompare(sessionToken, currentKey) when no sessionStore
 *
 * Also tests the dynamic provider path (apiKey as async function) for both
 * Bearer and cookie auth.
 *
 * Covers:
 *   - control/auth.ts: authMiddleware() — al_session cookie without sessionStore → 200 on match
 *   - control/auth.ts: authMiddleware() — al_session cookie without sessionStore → 401 on mismatch
 *   - control/auth.ts: authMiddleware() — al_session cookie with sessionStore=undefined → backward-compat
 *   - control/auth.ts: authMiddleware() — apiKey as async function (dynamic provider) → Bearer succeeds
 *   - control/auth.ts: authMiddleware() — apiKey as async function → undefined key → 401
 *   - control/auth.ts: authMiddleware() — al_session cookie without sessionStore → HTML request → redirect to /login
 *   - control/auth.ts: resolveApiKey() — function path called on each request
 */

import { describe, it, expect } from "vitest";

const { Hono } = await import(
  /* @vite-ignore */
  "/tmp/repo/node_modules/hono/dist/index.js"
);

const { authMiddleware } = await import(
  /* @vite-ignore */
  "/tmp/repo/packages/action-llama/dist/control/auth.js"
);

const API_KEY = "test-api-key-abc123";

// Helper: create a Hono app with authMiddleware and a protected route
function makeApp(apiKey: any, sessionStore?: any) {
  const app = new Hono();
  const auth = authMiddleware(apiKey, sessionStore);
  app.use("/protected", auth);
  app.get("/protected", (c: any) => c.json({ ok: true }));
  return app;
}

// Helper: send request with cookie
async function requestWithCookie(app: any, cookie: string, accept?: string) {
  const headers: Record<string, string> = { Cookie: cookie };
  if (accept) headers["Accept"] = accept;
  return app.request("/protected", { method: "GET", headers });
}

// Helper: send request with Bearer token
async function requestWithBearer(app: any, token: string) {
  return app.request("/protected", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe(
  "integration: authMiddleware() backward-compat cookie path (no Docker required)",
  { timeout: 15_000 },
  () => {
    // ── Backward-compat: cookie without sessionStore ──────────────────────────

    it("al_session cookie matching API key → 200 when no sessionStore provided", async () => {
      const app = makeApp(API_KEY, undefined);
      const res = await requestWithCookie(app, `al_session=${API_KEY}`);
      expect(res.status).toBe(200);
    });

    it("al_session cookie mismatching API key → 401 when no sessionStore provided", async () => {
      const app = makeApp(API_KEY, undefined);
      const res = await requestWithCookie(app, `al_session=wrong-key`);
      expect(res.status).toBe(401);
    });

    it("al_session cookie matching API key → 200 when sessionStore=undefined explicitly", async () => {
      const app = makeApp(API_KEY, undefined);
      const res = await requestWithCookie(app, `al_session=${API_KEY}`);
      const body = await res.json();
      expect(body).toEqual({ ok: true });
    });

    it("HTML request with wrong cookie → redirect to /login (not 401 JSON)", async () => {
      const app = makeApp(API_KEY, undefined);
      const res = await requestWithCookie(app, `al_session=wrong`, "text/html");
      // Should redirect (3xx)
      expect(res.status).toBeGreaterThanOrEqual(300);
      expect(res.status).toBeLessThan(400);
    });

    it("multiple cookies present: al_session matched → 200", async () => {
      const app = makeApp(API_KEY, undefined);
      const res = await requestWithCookie(app, `other=value; al_session=${API_KEY}; another=foo`);
      expect(res.status).toBe(200);
    });

    it("al_session cookie present but empty value → 401 (empty is falsy)", async () => {
      const app = makeApp(API_KEY, undefined);
      // Empty cookie value - parseCookie will see al_session=""
      const res = await requestWithCookie(app, `al_session=`);
      expect(res.status).toBe(401);
    });

    // ── Dynamic API key provider (async function) ─────────────────────────────

    it("apiKey as async function: Bearer token with matching key → 200", async () => {
      let callCount = 0;
      const provider = async () => {
        callCount++;
        return API_KEY;
      };
      const app = makeApp(provider, undefined);
      const res = await requestWithBearer(app, API_KEY);
      expect(res.status).toBe(200);
      expect(callCount).toBeGreaterThan(0);
    });

    it("apiKey as async function: returns undefined → 401 (no key configured)", async () => {
      const provider = async () => undefined;
      const app = makeApp(provider, undefined);
      const res = await requestWithBearer(app, API_KEY);
      expect(res.status).toBe(401);
    });

    it("apiKey as async function: cookie with matching key → 200 (backward compat)", async () => {
      const provider = async () => API_KEY;
      const app = makeApp(provider, undefined);
      const res = await requestWithCookie(app, `al_session=${API_KEY}`);
      expect(res.status).toBe(200);
    });

    it("resolveApiKey: function is called on every request (enables key rotation)", async () => {
      let callCount = 0;
      const provider = async () => {
        callCount++;
        return API_KEY;
      };
      const app = makeApp(provider, undefined);

      await requestWithBearer(app, API_KEY);
      await requestWithBearer(app, API_KEY);
      await requestWithBearer(app, API_KEY);

      // The provider should be called once per request
      expect(callCount).toBe(3);
    });
  },
);
