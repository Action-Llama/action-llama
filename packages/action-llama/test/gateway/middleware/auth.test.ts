/**
 * Unit tests for gateway/middleware/auth.ts
 *
 * Verifies that applyAuthMiddleware:
 * 1. Protects all expected route patterns (/control/*, /api/logs/*, etc.)
 * 2. Allows /api/auth/login to pass through (unprotected)
 * 3. Registers JSON auth routes (/api/auth/login, /api/auth/logout, /api/auth/check)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { applyAuthMiddleware } from "../../../src/gateway/middleware/auth.js";

const TEST_API_KEY = "test-auth-key-unit";

function makeApp(apiKey = TEST_API_KEY) {
  const app = new Hono();
  applyAuthMiddleware(app, apiKey, undefined);
  return app;
}

function makeAppWithHostname(hostname: string) {
  const app = new Hono();
  applyAuthMiddleware(app, TEST_API_KEY, undefined, hostname);
  // Register a protected test route
  app.get("/api/dashboard/test", (c) => c.json({ ok: true }));
  return app;
}

describe("applyAuthMiddleware — protected routes return 401 without auth", () => {
  let app: Hono;

  beforeEach(() => {
    app = makeApp();
    // Register test routes for each protected pattern
    app.get("/control/status", (c) => c.json({ status: "ok" }));
    app.get("/dashboard/api/stream", (c) => c.json({ data: "stream" }));
    app.get("/locks/status", (c) => c.json({ locks: [] }));
    app.get("/api/logs/scheduler", (c) => c.json({ entries: [] }));
    app.get("/api/stats/agents", (c) => c.json({ agents: [] }));
    app.get("/api/dashboard/status", (c) => c.json({ status: "ok" }));
    app.get("/api/webhooks/receipts", (c) => c.json({ receipts: [] }));
    app.get("/api/chat/sessions", (c) => c.json({ sessions: [] }));
  });

  it("protects /control/* — returns 401 without Authorization header", async () => {
    const res = await app.request("/control/status");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("protects /dashboard/api/* — returns 401 without auth", async () => {
    const res = await app.request("/dashboard/api/stream");
    expect(res.status).toBe(401);
  });

  it("protects /locks/status — returns 401 without auth", async () => {
    const res = await app.request("/locks/status");
    expect(res.status).toBe(401);
  });

  it("protects /api/logs/* — returns 401 without auth", async () => {
    const res = await app.request("/api/logs/scheduler");
    expect(res.status).toBe(401);
  });

  it("protects /api/stats/* — returns 401 without auth", async () => {
    const res = await app.request("/api/stats/agents");
    expect(res.status).toBe(401);
  });

  it("protects /api/dashboard/* — returns 401 without auth", async () => {
    const res = await app.request("/api/dashboard/status");
    expect(res.status).toBe(401);
  });

  it("protects /api/webhooks/* — returns 401 without auth", async () => {
    const res = await app.request("/api/webhooks/receipts");
    expect(res.status).toBe(401);
  });

  it("protects /api/chat/* — returns 401 without auth", async () => {
    const res = await app.request("/api/chat/sessions");
    expect(res.status).toBe(401);
  });

  it("allows /api/auth/login (unprotected) — POST returns 401 for wrong key", async () => {
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "wrong-key" }),
    });
    // Login route is NOT behind auth middleware, so it should respond (with 401 for wrong key)
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Invalid API key");
  });

  it("allows /api/auth/login with correct key — returns success", async () => {
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: TEST_API_KEY }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("allows access to protected route with valid Bearer token", async () => {
    const res = await app.request("/control/status", {
      headers: { Authorization: `Bearer ${TEST_API_KEY}` },
    });
    // Route exists and auth passes — should return 200
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });
});

describe("applyAuthMiddleware — /api/auth/check is protected", () => {
  it("GET /api/auth/check returns 401 without auth", async () => {
    const app = makeApp();
    const res = await app.request("/api/auth/check");
    expect(res.status).toBe(401);
  });

  it("GET /api/auth/check returns 200 with valid auth", async () => {
    const app = makeApp();
    const res = await app.request("/api/auth/check", {
      headers: { Authorization: `Bearer ${TEST_API_KEY}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authenticated).toBe(true);
  });
});

describe("applyAuthMiddleware — /api/auth/logout is available", () => {
  it("POST /api/auth/logout returns 200 without requiring auth", async () => {
    // logout clears the session cookie — it's accessible without auth
    const app = makeApp();
    const res = await app.request("/api/auth/logout", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    // Should set Max-Age=0 cookie
    const cookie = res.headers.get("Set-Cookie") || "";
    expect(cookie).toContain("Max-Age=0");
  });
});
