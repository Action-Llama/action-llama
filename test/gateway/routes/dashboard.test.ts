import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { registerDashboardRoutes } from "../../../src/gateway/routes/dashboard.js";

function mockStatusTracker() {
  return {
    getAllAgents: () => [],
    getSchedulerInfo: () => null,
    getRecentLogs: () => [],
    on: vi.fn(),
    removeListener: vi.fn(),
  } as any;
}

function createTestApp(secret?: string) {
  if (secret) {
    process.env.AL_DASHBOARD_SECRET = secret;
  } else {
    delete process.env.AL_DASHBOARD_SECRET;
  }
  const app = new Hono();
  registerDashboardRoutes(app, mockStatusTracker());
  return app;
}

function basicAuth(password: string, username = "admin"): string {
  return "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
}

describe("dashboard basic auth", () => {
  const savedEnv = process.env.AL_DASHBOARD_SECRET;

  afterEach(() => {
    if (savedEnv !== undefined) {
      process.env.AL_DASHBOARD_SECRET = savedEnv;
    } else {
      delete process.env.AL_DASHBOARD_SECRET;
    }
  });

  it("serves dashboard without auth when env var is not set", async () => {
    const app = createTestApp();
    const res = await app.request("/dashboard");
    expect(res.status).toBe(200);
  });

  it("returns 401 when secret is set and no auth provided", async () => {
    const app = createTestApp("my-secret");
    const res = await app.request("/dashboard");
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain("Basic");
  });

  it("returns 401 for wrong password", async () => {
    const app = createTestApp("my-secret");
    const res = await app.request("/dashboard", {
      headers: { Authorization: basicAuth("wrong-password") },
    });
    expect(res.status).toBe(401);
  });

  it("allows access with correct password", async () => {
    const app = createTestApp("my-secret");
    const res = await app.request("/dashboard", {
      headers: { Authorization: basicAuth("my-secret") },
    });
    expect(res.status).toBe(200);
  });

  it("accepts any username with correct password", async () => {
    const app = createTestApp("my-secret");
    const res = await app.request("/dashboard", {
      headers: { Authorization: basicAuth("my-secret", "whoever") },
    });
    expect(res.status).toBe(200);
  });

  it("protects sub-routes under /dashboard/", async () => {
    const app = createTestApp("my-secret");

    const res = await app.request("/dashboard/agents/dev/logs");
    expect(res.status).toBe(401);

    const authedRes = await app.request("/dashboard/agents/dev/logs", {
      headers: { Authorization: basicAuth("my-secret") },
    });
    expect(authedRes.status).toBe(200);
  });
});
