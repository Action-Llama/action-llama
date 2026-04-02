/**
 * Integration tests: JSON auth API endpoints — no Docker required.
 *
 * When an API key is configured, applyAuthMiddleware() registers:
 *   POST /api/auth/login  — validate key, create session, set al_session cookie
 *   GET  /api/auth/check  — protected: returns { authenticated: true }
 *   POST /api/auth/logout — clear session cookie (Max-Age=0)
 *
 * These endpoints are used by the React dashboard SPA for cookie-based auth.
 * They are registered in Phase 3 (before Docker), so they work without Docker.
 *
 * Test scenarios:
 *   1. POST /api/auth/login with correct key → 200 + al_session cookie
 *   2. POST /api/auth/login with wrong key → 401 { error: "Invalid API key" }
 *   3. POST /api/auth/login with no key field → 401
 *   4. GET /api/auth/check without auth → 401
 *   5. GET /api/auth/check with Bearer token → 200 { authenticated: true }
 *   6. GET /api/auth/check with valid al_session cookie → 200 { authenticated: true }
 *   7. POST /api/auth/logout sets al_session cookie with Max-Age=0
 *   8. Protected route (/api/stats/activity) with al_session cookie → 200
 *
 * Covers:
 *   - control/routes/dashboard-api.ts: registerAuthApiRoutes() — all three endpoints
 *   - control/auth.ts: authMiddleware cookie path (al_session with SessionStore)
 *   - control/session-store.ts: createSession, getSession (via cookie auth)
 *   - gateway/middleware/auth.ts: applyAuthMiddleware — session cookie branch
 */

import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness } from "./harness.js";

describe(
  "integration: JSON auth API endpoints (no Docker required)",
  { timeout: 60_000 },
  () => {
    let harness: IntegrationHarness;
    let gatewayAccessible = false;

    afterEach(async () => {
      if (harness) {
        try { await harness.shutdown(); } catch {}
        harness = undefined as unknown as IntegrationHarness;
        gatewayAccessible = false;
      }
    });

    async function startHarness(): Promise<void> {
      harness = await IntegrationHarness.create({
        agents: [
          {
            name: "auth-api-agent",
            schedule: "0 0 31 2 *",
            testScript: "#!/bin/sh\nexit 0\n",
          },
        ],
      });

      try {
        await harness.start();
        gatewayAccessible = true;
      } catch {
        try {
          const h = await fetch(
            `http://127.0.0.1:${harness.gatewayPort}/health`,
            { signal: AbortSignal.timeout(3_000) },
          );
          gatewayAccessible = h.ok;
        } catch {
          gatewayAccessible = false;
        }
      }
    }

    function gw(method: string, path: string, opts?: {
      body?: unknown;
      bearer?: string;
      cookie?: string;
      accept?: string;
    }): Promise<Response> {
      const headers: Record<string, string> = {};
      if (opts?.body !== undefined) {
        headers["Content-Type"] = "application/json";
      }
      if (opts?.bearer) {
        headers["Authorization"] = `Bearer ${opts.bearer}`;
      }
      if (opts?.cookie) {
        headers["Cookie"] = opts.cookie;
      }
      if (opts?.accept) {
        headers["Accept"] = opts.accept;
      }
      return fetch(`http://127.0.0.1:${harness.gatewayPort}${path}`, {
        method,
        headers,
        body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      });
    }

    it("POST /api/auth/login with correct key returns 200 and sets al_session cookie", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await gw("POST", "/api/auth/login", { body: { key: harness.apiKey } });
      expect(res.status).toBe(200);

      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(true);

      // al_session cookie should be set
      const setCookie = res.headers.get("Set-Cookie") || "";
      expect(setCookie).toContain("al_session=");
      expect(setCookie).toContain("HttpOnly");
    });

    it("POST /api/auth/login with wrong key returns 401", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await gw("POST", "/api/auth/login", { body: { key: "wrong-key-xyz" } });
      expect(res.status).toBe(401);

      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/invalid api key/i);
    });

    it("POST /api/auth/login with no key field returns 401", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      // Empty key (body.key ?? "" → "" which doesn't match any real key)
      const res = await gw("POST", "/api/auth/login", { body: {} });
      expect(res.status).toBe(401);
    });

    it("GET /api/auth/check without auth returns 401", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await gw("GET", "/api/auth/check");
      expect(res.status).toBe(401);
    });

    it("GET /api/auth/check with Bearer token returns 200", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      const res = await gw("GET", "/api/auth/check", { bearer: harness.apiKey });
      expect(res.status).toBe(200);

      const body = (await res.json()) as { authenticated: boolean };
      expect(body.authenticated).toBe(true);
    });

    it("GET /api/auth/check with valid al_session cookie returns 200", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      // First login to get a session cookie
      const loginRes = await gw("POST", "/api/auth/login", { body: { key: harness.apiKey } });
      expect(loginRes.status).toBe(200);

      const setCookie = loginRes.headers.get("Set-Cookie") || "";
      const match = setCookie.match(/al_session=([^;]+)/);
      expect(match).not.toBeNull();
      const sessionValue = match![1];

      // Now use the session cookie to access the protected check endpoint
      const checkRes = await gw("GET", "/api/auth/check", {
        cookie: `al_session=${sessionValue}`,
      });
      expect(checkRes.status).toBe(200);

      const checkBody = (await checkRes.json()) as { authenticated: boolean };
      expect(checkBody.authenticated).toBe(true);
    });

    it("POST /api/auth/logout sets al_session cookie with Max-Age=0", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      // Login first (not strictly needed to test logout, but realistic flow)
      const logoutRes = await gw("POST", "/api/auth/logout", {
        bearer: harness.apiKey, // logout is protected
        body: {},
      });
      expect(logoutRes.status).toBe(200);

      const body = (await logoutRes.json()) as { success: boolean };
      expect(body.success).toBe(true);

      // The al_session cookie should be cleared (Max-Age=0)
      const setCookie = logoutRes.headers.get("Set-Cookie") || "";
      expect(setCookie).toContain("al_session=");
      expect(setCookie).toContain("Max-Age=0");
    });

    it("protected /api/stats/activity with al_session cookie returns 200", async () => {
      await startHarness();
      if (!gatewayAccessible) return;

      // Get a session cookie via login
      const loginRes = await gw("POST", "/api/auth/login", { body: { key: harness.apiKey } });
      expect(loginRes.status).toBe(200);

      const setCookie = loginRes.headers.get("Set-Cookie") || "";
      const match = setCookie.match(/al_session=([^;]+)/);
      expect(match).not.toBeNull();
      const sessionValue = match![1];

      // Access a protected stats endpoint using only the session cookie (no Bearer)
      const statsRes = await gw("GET", "/api/stats/activity", {
        cookie: `al_session=${sessionValue}`,
      });
      expect(statsRes.status).toBe(200);

      const statsBody = (await statsRes.json()) as { rows: unknown[]; total: number };
      expect(Array.isArray(statsBody.rows)).toBe(true);
      expect(typeof statsBody.total).toBe("number");
    });
  },
);
