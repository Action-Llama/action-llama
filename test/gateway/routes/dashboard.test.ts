import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { registerDashboardRoutes, registerLoginRoutes } from "../../../src/gateway/routes/dashboard.js";
import { authMiddleware } from "../../../src/gateway/auth.js";
import type { SessionStore } from "../../../src/gateway/session-store.js";

function mockStatusTracker() {
  return {
    getAllAgents: () => [],
    getSchedulerInfo: () => null,
    getRecentLogs: () => [],
    on: vi.fn(),
    removeListener: vi.fn(),
  } as any;
}

function createTestApp(apiKey?: string, sessionStore?: SessionStore) {
  const app = new Hono();
  if (apiKey) {
    const auth = authMiddleware(apiKey, sessionStore);
    app.use("/control/*", auth);
    app.use("/dashboard/*", auth);
    app.use("/dashboard", auth);
    app.use("/locks/status", auth);
    registerLoginRoutes(app, apiKey, sessionStore);
  }
  registerDashboardRoutes(app, mockStatusTracker(), undefined, apiKey);
  return app;
}

/** Simulates gateway with apiKey but no webUI (no dashboard routes). */
function createAuthOnlyApp(apiKey: string) {
  const app = new Hono();
  const auth = authMiddleware(apiKey);
  app.use("/control/*", auth);
  app.use("/dashboard/*", auth);
  app.use("/dashboard", auth);
  app.use("/locks/status", auth);
  registerLoginRoutes(app, apiKey);
  return app;
}

function mockSessionStore(sessionId?: string): SessionStore {
  return {
    createSession: vi.fn().mockResolvedValue(sessionId ?? "mock-session-id"),
    getSession: vi.fn().mockImplementation(async (id: string) =>
      id === (sessionId ?? "mock-session-id")
        ? { id, createdAt: Date.now(), lastAccessed: Date.now() }
        : null
    ),
    deleteSession: vi.fn().mockResolvedValue(undefined),
  } as any;
}

describe("dashboard auth", () => {
  const savedEnv = process.env.AL_DASHBOARD_SECRET;

  afterEach(() => {
    if (savedEnv !== undefined) {
      process.env.AL_DASHBOARD_SECRET = savedEnv;
    } else {
      delete process.env.AL_DASHBOARD_SECRET;
    }
  });

  it("serves dashboard without auth when no apiKey provided", async () => {
    const app = createTestApp();
    const res = await app.request("/dashboard");
    expect(res.status).toBe(200);
  });

  it("redirects browser requests to /login when apiKey set and no auth", async () => {
    const app = createTestApp("test-key");
    const res = await app.request("/dashboard", {
      headers: { Accept: "text/html" },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/login");
  });

  it("returns 401 JSON for API requests with no auth", async () => {
    const app = createTestApp("test-key");
    const res = await app.request("/dashboard", {
      headers: { Accept: "application/json" },
    });
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("allows access with correct Bearer token", async () => {
    const app = createTestApp("test-key");
    const res = await app.request("/dashboard", {
      headers: { Authorization: "Bearer test-key" },
    });
    expect(res.status).toBe(200);
  });

  it("rejects wrong Bearer token", async () => {
    const app = createTestApp("test-key");
    const res = await app.request("/dashboard", {
      headers: { Authorization: "Bearer wrong-key", Accept: "application/json" },
    });
    expect(res.status).toBe(401);
  });

  it("allows access with correct session cookie (no session store — backward compat)", async () => {
    const app = createTestApp("test-key");
    const res = await app.request("/dashboard", {
      headers: { Cookie: "al_session=test-key" },
    });
    expect(res.status).toBe(200);
  });

  it("rejects wrong session cookie (no session store — backward compat)", async () => {
    const app = createTestApp("test-key");
    const res = await app.request("/dashboard", {
      headers: { Cookie: "al_session=wrong-key", Accept: "application/json" },
    });
    expect(res.status).toBe(401);
  });

  it("protects sub-routes under /dashboard/", async () => {
    const app = createTestApp("test-key");

    const res = await app.request("/dashboard/agents/dev/logs", {
      headers: { Accept: "application/json" },
    });
    expect(res.status).toBe(401);

    const authedRes = await app.request("/dashboard/agents/dev/logs", {
      headers: { Authorization: "Bearer test-key" },
    });
    expect(authedRes.status).toBe(200);
  });

  it("login page is accessible without auth", async () => {
    const app = createTestApp("test-key");
    const res = await app.request("/login");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Action Llama");
    expect(html).toContain("API Key");
  });

  it("POST /login sets cookie on correct key (no session store)", async () => {
    const app = createTestApp("test-key");
    const form = new URLSearchParams({ key: "test-key" });
    const res = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/dashboard");
    const cookie = res.headers.get("Set-Cookie") || "";
    expect(cookie).toContain("al_session=");
    expect(cookie).toContain("HttpOnly");
  });

  it("POST /login returns 401 on wrong key", async () => {
    const app = createTestApp("test-key");
    const form = new URLSearchParams({ key: "wrong" });
    const res = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    expect(res.status).toBe(401);
    const html = await res.text();
    expect(html).toContain("Invalid API key");
  });

  it("POST /logout clears the cookie", async () => {
    const app = createTestApp("test-key");
    const res = await app.request("/logout", { method: "POST" });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/login");
    const cookie = res.headers.get("Set-Cookie") || "";
    expect(cookie).toContain("Max-Age=0");
  });

  it("login page is accessible when webUI is off but apiKey is set", async () => {
    const app = createAuthOnlyApp("test-key");
    const res = await app.request("/login");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Action Llama");
  });

  it("auth redirect to /login works when webUI is off", async () => {
    const app = createAuthOnlyApp("test-key");
    // Unauthenticated browser request to /dashboard should redirect to /login
    const res = await app.request("/dashboard", {
      headers: { Accept: "text/html" },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/login");

    // Following the redirect should get the login page, not 404
    const loginRes = await app.request("/login");
    expect(loginRes.status).toBe(200);
  });

  it("logs deprecation warning when AL_DASHBOARD_SECRET is set", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.AL_DASHBOARD_SECRET = "old-secret";
    createTestApp("new-key");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("AL_DASHBOARD_SECRET is no longer used"));
    warnSpy.mockRestore();
  });

  describe("session store integration", () => {
    it("POST /login sets opaque session ID cookie when session store is provided", async () => {
      const store = mockSessionStore("abc123session");
      const app = createTestApp("test-key", store);
      const form = new URLSearchParams({ key: "test-key" });
      const res = await app.request("/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });
      expect(res.status).toBe(302);
      const cookie = res.headers.get("Set-Cookie") || "";
      expect(cookie).toContain("al_session=abc123session");
      expect(cookie).not.toContain("test-key");
      expect(store.createSession).toHaveBeenCalled();
    });

    it("allows access with valid session ID cookie when session store is provided", async () => {
      const store = mockSessionStore("valid-session-id");
      const app = createTestApp("test-key", store);
      const res = await app.request("/dashboard", {
        headers: { Cookie: "al_session=valid-session-id" },
      });
      expect(res.status).toBe(200);
      expect(store.getSession).toHaveBeenCalledWith("valid-session-id");
    });

    it("rejects unknown session ID cookie when session store is provided", async () => {
      const store = mockSessionStore("valid-session-id");
      const app = createTestApp("test-key", store);
      const res = await app.request("/dashboard", {
        headers: { Cookie: "al_session=unknown-session-id", Accept: "application/json" },
      });
      expect(res.status).toBe(401);
    });

    it("rejects raw API key as cookie value when session store is provided", async () => {
      const store = mockSessionStore("valid-session-id");
      const app = createTestApp("test-key", store);
      // The raw API key should not authenticate — only opaque session IDs work
      const res = await app.request("/dashboard", {
        headers: { Cookie: "al_session=test-key", Accept: "application/json" },
      });
      expect(res.status).toBe(401);
    });

    it("POST /logout deletes session from store", async () => {
      const store = mockSessionStore("my-session");
      const app = createTestApp("test-key", store);
      const res = await app.request("/logout", {
        method: "POST",
        headers: { Cookie: "al_session=my-session" },
      });
      expect(res.status).toBe(302);
      expect(store.deleteSession).toHaveBeenCalledWith("my-session");
    });
  });
});
