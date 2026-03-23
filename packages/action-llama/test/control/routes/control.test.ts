import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { registerControlRoutes, type ControlRoutesDeps } from "../../../src/control/routes/control.js";
import { StatusTracker } from "../../../src/tui/status-tracker.js";

function setup(overrides?: Partial<ControlRoutesDeps>) {
  const statusTracker = new StatusTracker();
  statusTracker.registerAgent("agent-a", 2);
  statusTracker.registerAgent("agent-b", 1);
  statusTracker.setSchedulerInfo({
    mode: "docker",
    runtime: "local",
    gatewayPort: 8080,
    cronJobCount: 2,
    webhooksActive: false,
    webhookUrls: [],
    startedAt: new Date(),
    paused: false,
  });

  const deps: ControlRoutesDeps = {
    statusTracker,
    killInstance: vi.fn(async () => false),
    killAgent: vi.fn(async () => null),
    pauseScheduler: vi.fn(async () => {}),
    resumeScheduler: vi.fn(async () => {}),
    triggerAgent: vi.fn(async () => false),
    enableAgent: vi.fn(async () => false),
    disableAgent: vi.fn(async () => false),
    ...overrides,
  };

  const app = new Hono();
  registerControlRoutes(app, deps);
  return { app, deps, statusTracker };
}

describe("POST /control/agents/:name/pause", () => {
  it("pauses agent via disableAgent and returns 200", async () => {
    const { app } = setup({ disableAgent: vi.fn(async () => true) });
    const res = await app.request("/control/agents/agent-a/pause", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.message).toContain("agent-a");
    expect(body.message).toContain("paused");
  });

  it("returns 404 for unknown agent", async () => {
    const { app } = setup({ disableAgent: vi.fn(async () => false) });
    const res = await app.request("/control/agents/nope/pause", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("returns 503 when disableAgent not available", async () => {
    const { app } = setup({ disableAgent: undefined });
    const res = await app.request("/control/agents/agent-a/pause", { method: "POST" });
    expect(res.status).toBe(503);
  });
});

describe("POST /control/agents/:name/resume", () => {
  it("resumes agent via enableAgent and returns 200", async () => {
    const { app } = setup({ enableAgent: vi.fn(async () => true) });
    const res = await app.request("/control/agents/agent-a/resume", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.message).toContain("agent-a");
    expect(body.message).toContain("resumed");
  });

  it("returns 404 for unknown agent", async () => {
    const { app } = setup({ enableAgent: vi.fn(async () => false) });
    const res = await app.request("/control/agents/nope/resume", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("returns 503 when enableAgent not available", async () => {
    const { app } = setup({ enableAgent: undefined });
    const res = await app.request("/control/agents/agent-a/resume", { method: "POST" });
    expect(res.status).toBe(503);
  });
});

describe("POST /control/agents/:name/kill", () => {
  it("kills all instances and returns count", async () => {
    const { app } = setup({ killAgent: vi.fn(async () => ({ killed: 2 })) });
    const res = await app.request("/control/agents/agent-a/kill", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.killed).toBe(2);
    expect(body.message).toContain("2 instance(s)");
  });

  it("returns 200 with killed=0 when agent exists but nothing running", async () => {
    const { app } = setup({ killAgent: vi.fn(async () => ({ killed: 0 })) });
    const res = await app.request("/control/agents/agent-a/kill", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.killed).toBe(0);
  });

  it("returns 404 for unknown agent", async () => {
    const { app } = setup({ killAgent: vi.fn(async () => null) });
    const res = await app.request("/control/agents/nope/kill", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("returns 500 when killAgent throws", async () => {
    const { app } = setup({
      killAgent: vi.fn(async () => { throw new Error("runtime exploded"); }),
    });
    const res = await app.request("/control/agents/agent-a/kill", { method: "POST" });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("runtime exploded");
  });
});

describe("GET /control/status", () => {
  it("includes agents array in response", async () => {
    const { app } = setup();
    const res = await app.request("/control/status");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agents).toBeDefined();
    expect(body.agents).toHaveLength(2);
    expect(body.agents.map((a: any) => a.name).sort()).toEqual(["agent-a", "agent-b"]);
  });

  it("shows enabled state per agent", async () => {
    const { app, statusTracker } = setup();
    statusTracker.disableAgent("agent-b");

    const res = await app.request("/control/status");
    const body = await res.json();
    const agentA = body.agents.find((a: any) => a.name === "agent-a");
    const agentB = body.agents.find((a: any) => a.name === "agent-b");
    expect(agentA.enabled).toBe(true);
    expect(agentB.enabled).toBe(false);
  });
});

describe("POST /control/stop", () => {
  it("returns 200 when stopScheduler is available", async () => {
    const stopScheduler = vi.fn(async () => {});
    const { app } = setup({ stopScheduler });
    const res = await app.request("/control/stop", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.message).toContain("stopping");
  });

  it("returns 503 when stopScheduler is undefined", async () => {
    const { app } = setup({ stopScheduler: undefined });
    const res = await app.request("/control/stop", { method: "POST" });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain("Stop not available");
  });
});

describe("POST /control/pause (scheduler)", () => {
  it("pauses the scheduler", async () => {
    const pauseScheduler = vi.fn(async () => {});
    const { app } = setup({ pauseScheduler });
    const res = await app.request("/control/pause", { method: "POST" });
    expect(res.status).toBe(200);
    expect(pauseScheduler).toHaveBeenCalled();
  });
});

describe("POST /control/resume (scheduler)", () => {
  it("resumes the scheduler", async () => {
    const resumeScheduler = vi.fn(async () => {});
    const { app } = setup({ resumeScheduler });
    const res = await app.request("/control/resume", { method: "POST" });
    expect(res.status).toBe(200);
    expect(resumeScheduler).toHaveBeenCalled();
  });
});
