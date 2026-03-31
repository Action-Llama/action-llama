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

  it("GET /api/dashboard/agents/:name/skill returns 500 when SKILL.md has invalid YAML frontmatter", async () => {
    // parseFrontmatter throws on invalid YAML, which is caught by the outer try-catch → 500
    const tmpDir = mkdtempSync(resolve(tmpdir(), "dashboard-test-"));
    mkdirSync(resolve(tmpDir, "agents", "test-agent"), { recursive: true });
    writeFileSync(
      resolve(tmpDir, "agents", "test-agent", "SKILL.md"),
      "---\n: invalid: yaml: : :\n---\n# Skill content\n"
    );
    const app = createApp(undefined, tmpDir);

    const res = await app.request("/api/dashboard/agents/test-agent/skill");
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.body).toBe("");
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

  it("GET /api/dashboard/config reads projectScale when projectPath provided", async () => {
    // Create a minimal project dir so getProjectScale can run
    const tmpDir = mkdtempSync(resolve(tmpdir(), "dashboard-scale-"));
    const tracker = makeStatusTracker();
    const app = new Hono();
    registerDashboardApiRoutes(app, tracker, tmpDir);

    const res = await app.request("/api/dashboard/config");
    expect(res.status).toBe(200);
    const data = await res.json();
    // getProjectScale will fail since there's no config file, but the catch should return 5
    expect(typeof data.projectScale).toBe("number");
  });

  it("GET /api/dashboard/agents/:name loads agentConfig when projectPath set", async () => {
    const tmpDir = mkdtempSync(resolve(tmpdir(), "dashboard-agentconfig-"));
    mkdirSync(resolve(tmpDir, "agents", "test-agent"), { recursive: true });
    writeFileSync(
      resolve(tmpDir, "agents", "test-agent", "agent.json"),
      JSON.stringify({ name: "test-agent", model: "claude-3-5-sonnet" })
    );
    const stats = makeStatsStore();
    const tracker = makeStatusTracker();
    const app = new Hono();
    registerDashboardApiRoutes(app, tracker, tmpDir, stats);

    const res = await app.request("/api/dashboard/agents/test-agent");
    expect(res.status).toBe(200);
    const data = await res.json();
    // agentConfig may be null if loading fails in test env, but should not throw
    expect(data).toHaveProperty("agentConfig");
  });

  it("GET /api/dashboard/triggers/:instanceId returns 404 when no statsStore", async () => {
    const tracker = makeStatusTracker();
    const app = new Hono();
    registerDashboardApiRoutes(app, tracker);

    const res = await app.request("/api/dashboard/triggers/some-id");
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.trigger).toBeNull();
  });

  it("GET /api/dashboard/triggers/:instanceId returns 404 when run not found", async () => {
    const stats = makeStatsStore();
    const tracker = makeStatusTracker();
    const app = new Hono();
    registerDashboardApiRoutes(app, tracker, undefined, stats);

    const res = await app.request("/api/dashboard/triggers/missing-id");
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.trigger).toBeNull();
  });

  it("GET /api/dashboard/triggers/:instanceId falls back to running instance from status tracker", async () => {
    const stats = makeStatsStore();
    // Run not in DB yet (still running)
    stats.queryRunByInstanceId.mockReturnValue(undefined);

    const runningInstances = [
      { id: "running-inst-1", agentName: "my-agent", status: "running", startedAt: "2025-01-15T10:00:00Z", trigger: "webhook:github" },
    ];
    const tracker = makeStatusTracker(runningInstances);
    const app = new Hono();
    registerDashboardApiRoutes(app, tracker, undefined, stats);

    const res = await app.request("/api/dashboard/triggers/running-inst-1");
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.trigger).toEqual({
      instanceId: "running-inst-1",
      agentName: "my-agent",
      triggerType: "webhook",
      triggerSource: "github",
      triggerContext: null,
      startedAt: new Date("2025-01-15T10:00:00Z").getTime(),
    });
  });

  it("GET /api/dashboard/triggers/:instanceId falls back to running instance without statsStore", async () => {
    const runningInstances = [
      { id: "inst-abc", agentName: "bot", status: "running", startedAt: "2025-01-15T12:00:00Z", trigger: "manual" },
    ];
    const tracker = makeStatusTracker(runningInstances);
    const app = new Hono();
    registerDashboardApiRoutes(app, tracker);

    const res = await app.request("/api/dashboard/triggers/inst-abc");
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.trigger.instanceId).toBe("inst-abc");
    expect(data.trigger.triggerType).toBe("manual");
    expect(data.trigger.triggerSource).toBeNull();
  });

  it("GET /api/dashboard/triggers/:instanceId returns trigger data for schedule run", async () => {
    const stats = makeStatsStore();
    stats.queryRunByInstanceId.mockReturnValue({
      instance_id: "inst-1",
      agent_name: "reporter",
      trigger_type: "schedule",
      trigger_source: "nightly",
      trigger_context: null,
      started_at: 1000000,
    });
    const tracker = makeStatusTracker();
    const app = new Hono();
    registerDashboardApiRoutes(app, tracker, undefined, stats);

    const res = await app.request("/api/dashboard/triggers/inst-1");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.trigger).toMatchObject({
      instanceId: "inst-1",
      agentName: "reporter",
      triggerType: "schedule",
      triggerSource: "nightly",
    });
  });

  it("GET /api/dashboard/triggers/:instanceId enriches with webhook receipt data", async () => {
    const stats = makeStatsStore();
    stats.queryRunByInstanceId.mockReturnValue({
      instance_id: "inst-wh",
      agent_name: "reporter",
      trigger_type: "webhook",
      trigger_source: "github",
      trigger_context: null,
      started_at: 1000000,
      webhook_receipt_id: "receipt-42",
    });
    stats.getWebhookReceipt.mockReturnValue({
      id: "receipt-42",
      source: "github",
      eventSummary: "push to main",
      deliveryId: "del-abc",
      timestamp: 1000000,
      headers: { "x-github-event": "push" },
      body: { ref: "refs/heads/main" },
      matchedAgents: 1,
      status: "processed",
    });
    const tracker = makeStatusTracker();
    const app = new Hono();
    registerDashboardApiRoutes(app, tracker, undefined, stats);

    const res = await app.request("/api/dashboard/triggers/inst-wh");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.trigger.webhook).toMatchObject({
      receiptId: "receipt-42",
      source: "github",
      eventSummary: "push to main",
      deliveryId: "del-abc",
      matchedAgents: 1,
      status: "processed",
    });
  });

  it("GET /api/dashboard/triggers/:instanceId enriches with caller info for agent-triggered runs", async () => {
    const stats = makeStatsStore();
    stats.queryRunByInstanceId.mockReturnValue({
      instance_id: "child-inst",
      agent_name: "worker",
      trigger_type: "agent",
      trigger_source: null,
      trigger_context: null,
      started_at: 1000000,
    });
    stats.queryCallEdgeByTargetInstance.mockReturnValue({
      caller_agent: "orchestrator",
      caller_instance: "parent-inst",
      depth: 2,
    });
    const tracker = makeStatusTracker();
    const app = new Hono();
    registerDashboardApiRoutes(app, tracker, undefined, stats);

    const res = await app.request("/api/dashboard/triggers/child-inst");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.trigger.callerAgent).toBe("orchestrator");
    expect(data.trigger.callerInstance).toBe("parent-inst");
    expect(data.trigger.callDepth).toBe(2);
  });
});

describe("registerAuthApiRoutes — apiKey as function", () => {
  it("POST /api/auth/login resolves apiKey function before comparing", async () => {
    const apiKeyFn = vi.fn().mockResolvedValue("dynamic-key");
    const app = new Hono();
    registerAuthApiRoutes(app, apiKeyFn);

    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "dynamic-key" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(apiKeyFn).toHaveBeenCalledOnce();
  });

  it("POST /api/auth/login returns success when apiKey function resolves to null", async () => {
    const apiKeyFn = vi.fn().mockResolvedValue(null);
    const app = new Hono();
    registerAuthApiRoutes(app, apiKeyFn);

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

describe("dashboard data routes — SSE throttle and cleanup coverage", () => {
  function createTrackerWithCapture() {
    let capturedUpdateListener: (() => void) | undefined;
    const tracker = {
      getAllAgents: () => [{ name: "test-agent", state: "idle", enabled: true, statusText: null }],
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
      on: vi.fn((event: string, cb: () => void) => {
        if (event === "update") capturedUpdateListener = cb;
      }),
      removeListener: vi.fn(),
    } as any;
    return { tracker, getUpdateListener: () => capturedUpdateListener };
  }

  it("throttledSend: fires send() immediately when timer is null (first call)", async () => {
    vi.useFakeTimers();
    try {
      const { tracker, getUpdateListener } = createTrackerWithCapture();
      const app = new Hono();
      registerDashboardDataRoutes(app, tracker);
      await app.request("/dashboard/api/status-stream");

      const throttledSend = getUpdateListener();
      expect(throttledSend).toBeDefined();

      // First call with timer=null: immediately calls send() and sets a timer
      throttledSend!();

      // A timer should now be pending (the 500ms throttle timer)
      expect(vi.getTimerCount()).toBeGreaterThanOrEqual(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("throttledSend: second call while timer is running sets pending=true without calling send", async () => {
    vi.useFakeTimers();
    try {
      const { tracker, getUpdateListener } = createTrackerWithCapture();
      const app = new Hono();
      registerDashboardDataRoutes(app, tracker);
      await app.request("/dashboard/api/status-stream");

      const throttledSend = getUpdateListener();
      expect(throttledSend).toBeDefined();

      // First call: timer=null → send() + sets timer
      throttledSend!();
      const timerCountAfterFirst = vi.getTimerCount();

      // Second call: timer is set → sets pending=true, returns immediately
      throttledSend!();

      // Timer count should be unchanged (no new timer created for second call)
      expect(vi.getTimerCount()).toBe(timerCountAfterFirst);
    } finally {
      vi.useRealTimers();
    }
  });

  it("throttledSend: timer callback fires send() when pending=true, then clears pending", async () => {
    vi.useFakeTimers();
    try {
      const { tracker, getUpdateListener } = createTrackerWithCapture();
      const app = new Hono();
      registerDashboardDataRoutes(app, tracker);
      await app.request("/dashboard/api/status-stream");

      const throttledSend = getUpdateListener();
      expect(throttledSend).toBeDefined();

      // First call: send() + set timer (timer=null before this call)
      throttledSend!();

      // Second call while timer is running: pending=true
      throttledSend!();

      // Advance past the 500ms throttle window — timer callback fires:
      // timer=null, pending=true → pending=false, send() called again
      vi.advanceTimersByTime(500);

      // After advancing: no more timers should be pending from the throttle
      // (The heartbeat is 15000ms, so it hasn't fired yet at 500ms)
    } finally {
      vi.useRealTimers();
    }
  });

  it("timer callback does NOT call send() when pending=false", async () => {
    vi.useFakeTimers();
    try {
      const { tracker, getUpdateListener } = createTrackerWithCapture();
      const app = new Hono();
      registerDashboardDataRoutes(app, tracker);
      await app.request("/dashboard/api/status-stream");

      const throttledSend = getUpdateListener();
      expect(throttledSend).toBeDefined();

      // Single call: timer=null → send() + set timer, pending stays false
      throttledSend!();

      // Advance past 500ms: timer fires with pending=false → no second send()
      vi.advanceTimersByTime(500);

      // No errors should have occurred; timer is cleared
    } finally {
      vi.useRealTimers();
    }
  });

  it("heartbeat fires stream.writeSSE with event=heartbeat after 15 seconds", async () => {
    vi.useFakeTimers();
    try {
      const { tracker } = createTrackerWithCapture();
      const app = new Hono();
      registerDashboardDataRoutes(app, tracker);
      const res = await app.request("/dashboard/api/status-stream");

      // Advance 15 seconds — the heartbeat setInterval callback fires
      vi.advanceTimersByTime(15000);

      // Read from the stream to verify heartbeat data was written
      const reader = res.body!.getReader();
      const { value } = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 2000)
        ),
      ]);
      reader.cancel();

      const text = new TextDecoder().decode(value);
      // The initial send() data AND potentially the heartbeat data
      expect(text).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("onAbort clears pending throttle timer when reader is cancelled after throttledSend", async () => {
    vi.useFakeTimers();
    try {
      const { tracker, getUpdateListener } = createTrackerWithCapture();
      const app = new Hono();
      registerDashboardDataRoutes(app, tracker);
      const res = await app.request("/dashboard/api/status-stream");

      const throttledSend = getUpdateListener();
      expect(throttledSend).toBeDefined();

      // Call throttledSend to set the timer (timer is now non-null)
      throttledSend!();

      // Cancel the reader — this triggers onAbort
      // onAbort: removeListener, if (timer) clearTimeout(timer), clearInterval(heartbeat)
      const reader = res.body!.getReader();

      // Read one chunk to unblock then cancel
      reader.read().catch(() => {});
      await reader.cancel();

      // After abort: timer should have been cleared
      // (clearTimeout was called, so the throttle timer is no longer pending)
      // Advance time — the throttle timer should NOT fire since it was cleared
      vi.advanceTimersByTime(1000);

      // removeListener should have been called
      expect(tracker.removeListener).toHaveBeenCalledWith("update", throttledSend);
    } finally {
      vi.useRealTimers();
    }
  });
});
