import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";
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
  function createApp(tracker = mockStatusTracker()) {
    const app = new Hono();
    registerDashboardDataRoutes(app, tracker);
    return app;
  }

  it("SSE status-stream includes proxy-compatibility headers", async () => {
    const app = createApp();
    const res = await app.request("/dashboard/api/status-stream");
    expect(res.headers.get("Cache-Control")).toBe("no-cache, no-transform");
    expect(res.headers.get("X-Accel-Buffering")).toBe("no");
    expect(res.headers.get("Connection")).toBe("keep-alive");
  });

  it("serves /dashboard/api/locks — returns empty locks when fetch fails", async () => {
    const app = createApp();
    const res = await app.request("/dashboard/api/locks");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("locks");
    expect(Array.isArray(data.locks)).toBe(true);
  });

  it("serves /dashboard/api/locks — returns data when fetch succeeds", async () => {
    // Mock global fetch to simulate a successful locks endpoint
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ locks: [{ id: "lock-1", resource: "github://test/repo" }] }),
    }) as any;

    try {
      const app = createApp();
      const res = await app.request("/dashboard/api/locks");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.locks).toHaveLength(1);
      expect(data.locks[0].id).toBe("lock-1");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("serves /dashboard/api/locks — falls back to empty locks when response not ok", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    }) as any;

    try {
      const app = createApp();
      const res = await app.request("/dashboard/api/locks");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ locks: [] });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("status-stream SSE payload includes invalidated items when available", async () => {
    const tracker = {
      ...mockStatusTracker(),
      flushInvalidations: () => ["agent-1", "agent-2"],
    } as any;
    const app = createApp(tracker);
    const res = await app.request("/dashboard/api/status-stream");
    // Read only the first chunk from the SSE stream with a timeout
    const reader = res.body!.getReader();
    const { value } = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 2000)),
    ]);
    reader.cancel();
    const text = new TextDecoder().decode(value);
    const dataLine = text.split("\n").find((l) => l.startsWith("data:"));
    expect(dataLine).toBeDefined();
    const payload = JSON.parse(dataLine!.replace("data:", "").trim());
    expect(payload.invalidated).toEqual(["agent-1", "agent-2"]);
  });

  it("status-stream SSE payload does not include invalidated when empty", async () => {
    const app = createApp();
    const res = await app.request("/dashboard/api/status-stream");
    // Read only the first chunk from the SSE stream
    const reader = res.body!.getReader();
    const { value } = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 2000)),
    ]);
    reader.cancel();
    const text = new TextDecoder().decode(value);
    const dataLine = text.split("\n").find((l) => l.startsWith("data:"));
    expect(dataLine).toBeDefined();
    const payload = JSON.parse(dataLine!.replace("data:", "").trim());
    expect(payload.invalidated).toBeUndefined();
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

describe("registerAuthApiRoutes — with session store", () => {
  const API_KEY = "session-key";

  function makeSessionStore() {
    return {
      createSession: vi.fn().mockResolvedValue("session-token-123"),
      deleteSession: vi.fn().mockResolvedValue(undefined),
    } as any;
  }

  it("POST /api/auth/login creates session and sets cookie from session store", async () => {
    const sessionStore = makeSessionStore();
    const app = new Hono();
    registerAuthApiRoutes(app, API_KEY, sessionStore);

    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: API_KEY }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(sessionStore.createSession).toHaveBeenCalledOnce();
    const cookie = res.headers.get("Set-Cookie") || "";
    expect(cookie).toContain("session-token-123");
  });

  it("POST /api/auth/login uses Secure flag for non-localhost", async () => {
    const sessionStore = makeSessionStore();
    const app = new Hono();
    registerAuthApiRoutes(app, API_KEY, sessionStore, "example.com");

    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: API_KEY }),
    });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("Set-Cookie") || "";
    expect(cookie).toContain("Secure");
  });

  it("POST /api/auth/logout deletes session from session store", async () => {
    const sessionStore = makeSessionStore();
    const app = new Hono();
    registerAuthApiRoutes(app, API_KEY, sessionStore);

    const res = await app.request("/api/auth/logout", {
      method: "POST",
      headers: { Cookie: "al_session=session-token-123" },
    });
    expect(res.status).toBe(200);
    expect(sessionStore.deleteSession).toHaveBeenCalledWith("session-token-123");
    const cookie = res.headers.get("Set-Cookie") || "";
    expect(cookie).toContain("Max-Age=0");
  });

  it("POST /api/auth/login succeeds without apiKey (open mode)", async () => {
    const app = new Hono();
    registerAuthApiRoutes(app); // no apiKey

    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });
});

describe("registerDashboardApiRoutes — extended coverage", () => {
  const API_KEY = "test-key";

  function makeStatsStore() {
    return {
      queryAgentSummary: vi.fn().mockReturnValue([]),
      countRunsByAgent: vi.fn().mockReturnValue(0),
      queryRunByInstanceId: vi.fn().mockReturnValue(null),
      queryCallEdgeByTargetInstance: vi.fn().mockReturnValue(null),
      getWebhookReceipt: vi.fn().mockReturnValue(null),
    } as any;
  }

  function makeStatusTracker(instances: any[] = []) {
    return {
      getAllAgents: vi.fn().mockReturnValue([
        { name: "test-agent", state: "idle", enabled: true, statusText: null },
      ]),
      getSchedulerInfo: vi.fn().mockReturnValue({ projectName: "my-project", gatewayPort: 3000, webhooksActive: false }),
      getRecentLogs: vi.fn().mockReturnValue([]),
      getInstances: vi.fn().mockReturnValue(instances),
    } as any;
  }

  function createApp(statsStore?: any, projectPath?: string, instances: any[] = []) {
    const app = new Hono();
    registerDashboardApiRoutes(app, makeStatusTracker(instances), projectPath, statsStore);
    return app;
  }

  it("GET /api/dashboard/agents/:name includes summary from stats store", async () => {
    const stats = makeStatsStore();
    stats.queryAgentSummary.mockReturnValue([{ agentName: "test-agent", totalRuns: 5 }]);
    stats.countRunsByAgent.mockReturnValue(5);
    const app = createApp(stats);

    const res = await app.request("/api/dashboard/agents/test-agent");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.summary).toMatchObject({ agentName: "test-agent", totalRuns: 5 });
    expect(data.totalHistorical).toBe(5);
  });

  it("GET /api/dashboard/agents/:name returns null summary when no stats store", async () => {
    const app = createApp();

    const res = await app.request("/api/dashboard/agents/test-agent");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.summary).toBeNull();
    expect(data.totalHistorical).toBe(0);
  });

  it("GET /api/dashboard/agents/:name includes running instances", async () => {
    const instances = [
      { id: "inst-1", agentName: "test-agent", status: "running" },
      { id: "inst-2", agentName: "other-agent", status: "running" },
    ];
    const app = createApp(undefined, undefined, instances);

    const res = await app.request("/api/dashboard/agents/test-agent");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.runningInstances).toHaveLength(1);
    expect(data.runningInstances[0].id).toBe("inst-1");
  });

  it("GET /api/dashboard/agents/:name/instances/:id returns null run and no running instance", async () => {
    const stats = makeStatsStore();
    const app = createApp(stats);

    const res = await app.request("/api/dashboard/agents/test-agent/instances/nonexistent");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.run).toBeNull();
    expect(data.runningInstance).toBeNull();
    expect(data.parentEdge).toBeUndefined();
    expect(data.webhookReceipt).toBeUndefined();
  });

  it("GET /api/dashboard/agents/:name/instances/:id returns running instance", async () => {
    const instances = [{ id: "inst-1", agentName: "test-agent", status: "running" }];
    const app = createApp(undefined, undefined, instances);

    const res = await app.request("/api/dashboard/agents/test-agent/instances/inst-1");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.runningInstance.id).toBe("inst-1");
  });

  it("GET /api/dashboard/agents/:name/instances/:id includes parent edge for agent-triggered runs", async () => {
    const stats = makeStatsStore();
    stats.queryRunByInstanceId.mockReturnValue({
      instance_id: "child-inst",
      trigger_type: "agent",
    });
    stats.queryCallEdgeByTargetInstance.mockReturnValue({
      caller_agent: "orchestrator",
      caller_instance: "parent-inst",
    });
    const app = createApp(stats);

    const res = await app.request("/api/dashboard/agents/test-agent/instances/child-inst");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.parentEdge).toMatchObject({
      caller_agent: "orchestrator",
      caller_instance: "parent-inst",
    });
  });

  it("GET /api/dashboard/agents/:name/instances/:id includes webhook receipt for webhook-triggered runs", async () => {
    const stats = makeStatsStore();
    stats.queryRunByInstanceId.mockReturnValue({
      instance_id: "webhook-inst",
      trigger_type: "webhook",
      webhook_receipt_id: "receipt-123",
    });
    stats.getWebhookReceipt.mockReturnValue({
      source: "github",
      eventSummary: "push to main",
      deliveryId: "del-abc",
    });
    const app = createApp(stats);

    const res = await app.request("/api/dashboard/agents/test-agent/instances/webhook-inst");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.webhookReceipt).toMatchObject({
      source: "github",
      eventSummary: "push to main",
      deliveryId: "del-abc",
    });
  });

  it("GET /api/dashboard/agents/:name/skill returns 404 when no projectPath", async () => {
    const app = createApp();

    const res = await app.request("/api/dashboard/agents/test-agent/skill");
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.body).toBe("");
  });

  it("GET /api/dashboard/agents/:name/skill returns 404 when SKILL.md not found", async () => {
    const tmpDir = mkdtempSync(resolve(tmpdir(), "dashboard-test-"));
    const app = createApp(undefined, tmpDir);

    const res = await app.request("/api/dashboard/agents/test-agent/skill");
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.body).toBe("");
  });

  it("GET /api/dashboard/agents/:name/skill returns body when SKILL.md exists", async () => {
    const tmpDir = mkdtempSync(resolve(tmpdir(), "dashboard-test-"));
    mkdirSync(resolve(tmpDir, "agents", "test-agent"), { recursive: true });
    writeFileSync(resolve(tmpDir, "agents", "test-agent", "SKILL.md"), "---\ntitle: Test\n---\n# Hello Skill\n");
    const app = createApp(undefined, tmpDir);

    const res = await app.request("/api/dashboard/agents/test-agent/skill");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.body).toContain("Hello Skill");
  });

  it("GET /api/dashboard/config returns project name and scale", async () => {
    const app = createApp();

    const res = await app.request("/api/dashboard/config");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.projectName).toBe("my-project");
    expect(typeof data.projectScale).toBe("number");
    expect(data.gatewayPort).toBe(3000);
  });
});
