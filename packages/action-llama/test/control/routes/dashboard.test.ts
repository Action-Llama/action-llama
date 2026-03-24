import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { registerDashboardDataRoutes } from "../../../src/control/routes/dashboard.js";
import { registerAuthApiRoutes, registerDashboardApiRoutes } from "../../../src/control/routes/dashboard-api.js";
import { authMiddleware } from "../../../src/control/auth.js";

function mockStatusTracker() {
  return {
    getAllAgents: () => [
      { name: "test-agent", state: "idle", enabled: true, statusText: null },
    ],
    getSchedulerInfo: () => ({
      mode: "docker",
      projectName: "test-project",
      gatewayPort: 3000,
      cronJobCount: 1,
      webhooksActive: false,
      webhookUrls: [],
      startedAt: new Date().toISOString(),
      paused: false,
    }),
    getRecentLogs: () => [],
    getInstances: () => [],
    flushInvalidations: () => [],
    on: vi.fn(),
    removeListener: vi.fn(),
  } as any;
}

describe("dashboard data routes", () => {
  function createApp() {
    const app = new Hono();
    registerDashboardDataRoutes(app, mockStatusTracker());
    return app;
  }

  it("SSE status-stream includes proxy-compatibility headers", async () => {
    const app = createApp();
    const res = await app.request("/dashboard/api/status-stream");
    expect(res.headers.get("Cache-Control")).toBe("no-cache, no-transform");
    expect(res.headers.get("X-Accel-Buffering")).toBe("no");
    expect(res.headers.get("Connection")).toBe("keep-alive");
  });

  it("serves /dashboard/api/locks", async () => {
    const app = createApp();
    const res = await app.request("/dashboard/api/locks");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("locks");
  });
});

describe("dashboard JSON API routes", () => {
  const API_KEY = "test-key";

  function createApp() {
    const app = new Hono();
    const auth = authMiddleware(API_KEY);
    app.use("/api/dashboard/*", auth);
    app.use("/api/auth/check", auth);
    registerAuthApiRoutes(app, API_KEY);
    registerDashboardApiRoutes(app, mockStatusTracker());
    return app;
  }

  it("GET /api/dashboard/status returns agent list", async () => {
    const app = createApp();
    const res = await app.request("/api/dashboard/status", {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.agents).toHaveLength(1);
    expect(data.agents[0].name).toBe("test-agent");
    expect(data).toHaveProperty("schedulerInfo");
    expect(data).toHaveProperty("recentLogs");
  });

  it("GET /api/dashboard/status requires auth", async () => {
    const app = createApp();
    const res = await app.request("/api/dashboard/status", {
      headers: { Accept: "application/json" },
    });
    expect(res.status).toBe(401);
  });

  it("GET /api/dashboard/agents/:name returns agent detail", async () => {
    const app = createApp();
    const res = await app.request("/api/dashboard/agents/test-agent", {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.agent.name).toBe("test-agent");
  });

  it("GET /api/dashboard/config returns project config", async () => {
    const app = createApp();
    const res = await app.request("/api/dashboard/config", {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.projectName).toBe("test-project");
    expect(data).toHaveProperty("projectScale");
  });

  it("POST /api/auth/login returns success with correct key", async () => {
    const app = createApp();
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: API_KEY }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    const cookie = res.headers.get("Set-Cookie") || "";
    expect(cookie).toContain("al_session=");
    expect(cookie).toContain("HttpOnly");
  });

  it("POST /api/auth/login returns 401 with wrong key", async () => {
    const app = createApp();
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "wrong-key" }),
    });
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toContain("Invalid");
  });

  it("GET /api/auth/check returns authenticated when authed", async () => {
    const app = createApp();
    const res = await app.request("/api/auth/check", {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.authenticated).toBe(true);
  });

  it("GET /api/auth/check returns 401 when not authed", async () => {
    const app = createApp();
    const res = await app.request("/api/auth/check", {
      headers: { Accept: "application/json" },
    });
    expect(res.status).toBe(401);
  });

  it("POST /api/auth/logout clears session cookie", async () => {
    const app = createApp();
    const res = await app.request("/api/auth/logout", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("Set-Cookie") || "";
    expect(cookie).toContain("Max-Age=0");
  });
});
