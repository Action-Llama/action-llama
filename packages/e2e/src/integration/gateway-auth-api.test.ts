/**
 * Integration test: verify the gateway JSON auth API endpoints.
 *
 * These endpoints are registered via applyAuthMiddleware whenever an API key
 * is configured (even without webUI/statusTracker):
 *   POST /api/auth/login   — JSON login: accept { key }, return session cookie
 *   POST /api/auth/logout  — JSON logout: clear session cookie
 *   GET  /api/auth/check   — Protected: returns { authenticated: true } when authed
 *
 * These routes are used by the React dashboard SPA for cookie-based auth.
 * They are distinct from the Bearer token path used by the CLI.
 *
 * Covers: control/routes/dashboard-api.ts registerAuthApiRoutes() (previously untested).
 */
import { describe, it, expect, afterEach } from "vitest";
import { IntegrationHarness, isDockerAvailable } from "./harness.js";

const DOCKER = isDockerAvailable();

describe.skipIf(!DOCKER)("integration: gateway JSON auth API", { timeout: 180_000 }, () => {
  let harness: IntegrationHarness;

  afterEach(async () => {
    if (harness) await harness.shutdown();
  });

  /** Send a request to the gateway, optionally with auth. */
  function gatewayFetch(
    h: IntegrationHarness,
    method: string,
    path: string,
    opts?: { body?: unknown; bearer?: string; cookie?: string },
  ): Promise<Response> {
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
    return fetch(`http://127.0.0.1:${h.gatewayPort}${path}`, {
      method,
      headers,
      body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  }

  it("POST /api/auth/login with correct key returns success and sets al_session cookie", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "auth-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    await harness.start();

    const res = await gatewayFetch(harness, "POST", "/api/auth/login", {
      body: { key: harness.apiKey },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);

    // Response should set an al_session cookie.
    const setCookie = res.headers.get("set-cookie") || "";
    expect(setCookie).toContain("al_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
  });

  it("POST /api/auth/login with wrong key returns 401", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "auth-reject-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    await harness.start();

    const res = await gatewayFetch(harness, "POST", "/api/auth/login", {
      body: { key: "wrong-key-completely-invalid" },
    });

    expect(res.status).toBe(401);
    const body = await res.json() as { error?: string };
    expect(body.error).toBeDefined();
  });

  it("GET /api/auth/check with valid Bearer token returns authenticated:true", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "auth-check-bearer-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    await harness.start();

    const res = await gatewayFetch(harness, "GET", "/api/auth/check", {
      bearer: harness.apiKey,
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { authenticated: boolean };
    expect(body.authenticated).toBe(true);
  });

  it("GET /api/auth/check without auth returns 401", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "auth-check-unauth-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    await harness.start();

    const res = await gatewayFetch(harness, "GET", "/api/auth/check");

    expect(res.status).toBe(401);
  });

  it("GET /api/auth/check with al_session cookie set via login returns authenticated", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "auth-session-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    await harness.start();

    // Step 1: login to get a session cookie
    const loginRes = await gatewayFetch(harness, "POST", "/api/auth/login", {
      body: { key: harness.apiKey },
    });

    expect(loginRes.status).toBe(200);

    // Extract the al_session value from the Set-Cookie header.
    const setCookieHeader = loginRes.headers.get("set-cookie") || "";
    const sessionMatch = setCookieHeader.match(/al_session=([^;]+)/);
    expect(sessionMatch).toBeTruthy();
    const sessionValue = sessionMatch![1];

    // Step 2: use the session cookie for /api/auth/check
    const checkRes = await gatewayFetch(harness, "GET", "/api/auth/check", {
      cookie: `al_session=${sessionValue}`,
    });

    expect(checkRes.status).toBe(200);
    const checkBody = await checkRes.json() as { authenticated: boolean };
    expect(checkBody.authenticated).toBe(true);
  });

  it("POST /api/auth/logout returns success", async () => {
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "auth-logout-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    await harness.start();

    // Logout with a valid session (Bearer token used for auth on logout route)
    const logoutRes = await gatewayFetch(harness, "POST", "/api/auth/logout", {
      bearer: harness.apiKey,
    });

    expect(logoutRes.status).toBe(200);
    const body = await logoutRes.json() as { success: boolean };
    expect(body.success).toBe(true);

    // Logout should clear the al_session cookie (Max-Age=0)
    const setCookie = logoutRes.headers.get("set-cookie") || "";
    expect(setCookie).toContain("al_session=");
    expect(setCookie).toContain("Max-Age=0");
  });

  it("unauthenticated request with Accept: text/html redirects to /login", async () => {
    // The auth middleware has two branches for unauthenticated requests:
    // 1. API clients (no Accept: text/html) → 401 JSON { error: "Unauthorized" }
    // 2. Browser requests (Accept: text/html) → redirect to /login
    //
    // This test covers the browser redirect path.
    //
    // Code path: control/auth.ts authMiddleware() → accept.includes("text/html")
    //   → c.redirect("/login")
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "auth-redirect-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    await harness.start();

    // Make a request to a protected route with browser Accept header but no auth
    const res = await fetch(`http://127.0.0.1:${harness.gatewayPort}/control/status`, {
      method: "GET",
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "manual", // Don't follow redirect — we want to verify the 3xx
    });

    // Should redirect to /login (not return 401 JSON)
    expect(res.status).toBeGreaterThanOrEqual(301);
    expect(res.status).toBeLessThanOrEqual(302);
    const location = res.headers.get("location") || "";
    expect(location).toContain("/login");
  });

  it("unauthenticated API request without text/html returns 401 JSON", async () => {
    // API clients send JSON-only Accept headers → get 401 JSON, not a redirect.
    // Code path: control/auth.ts authMiddleware() → !accept.includes("text/html")
    //   → c.json({ error: "Unauthorized" }, 401)
    harness = await IntegrationHarness.create({
      agents: [
        {
          name: "auth-401-agent",
          schedule: "0 0 31 2 *",
          testScript: "#!/bin/sh\nexit 0\n",
        },
      ],
    });

    await harness.start();

    // No auth header, Accept: application/json → should get 401 JSON
    const res = await fetch(`http://127.0.0.1:${harness.gatewayPort}/api/stats/triggers`, {
      method: "GET",
      headers: {
        "Accept": "application/json",
      },
    });

    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBeTruthy();
    expect(typeof body.error).toBe("string");
  });
});
