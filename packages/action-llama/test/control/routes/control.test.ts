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
    triggerAgent: vi.fn(async () => "Agent not found" as string),
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

describe("POST /control/trigger/:name", () => {
  it("triggers agent without prompt when no body", async () => {
    const triggerAgent = vi.fn(async () => ({ instanceId: "agent-a-abc123" }));
    const { app } = setup({ triggerAgent });
    const res = await app.request("/control/trigger/agent-a", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.instanceId).toBe("agent-a-abc123");
    expect(triggerAgent).toHaveBeenCalledWith("agent-a", undefined);
  });

  it("passes prompt from JSON body to triggerAgent", async () => {
    const triggerAgent = vi.fn(async () => ({ instanceId: "agent-a-abc123" }));
    const { app } = setup({ triggerAgent });
    const res = await app.request("/control/trigger/agent-a", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "review PR #42" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.instanceId).toBe("agent-a-abc123");
    expect(triggerAgent).toHaveBeenCalledWith("agent-a", "review PR #42");
  });

  it("ignores empty/whitespace prompt", async () => {
    const triggerAgent = vi.fn(async () => ({ instanceId: "agent-a-abc123" }));
    const { app } = setup({ triggerAgent });
    const res = await app.request("/control/trigger/agent-a", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "   " }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.instanceId).toBe("agent-a-abc123");
    expect(triggerAgent).toHaveBeenCalledWith("agent-a", undefined);
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

describe("GET /control/instances", () => {
  it("returns instances list when statusTracker is available", async () => {
    const { app } = setup();
    const res = await app.request("/control/instances");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.instances)).toBe(true);
  });

  it("returns 503 when statusTracker is not available", async () => {
    const { app } = setup({ statusTracker: undefined });
    const res = await app.request("/control/instances");
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain("Status tracker not available");
  });
});

describe("POST /control/kill/:instanceId", () => {
  it("kills instance and returns 200 on success", async () => {
    const killInstance = vi.fn(async () => true);
    const { app } = setup({ killInstance });
    const res = await app.request("/control/kill/inst-abc123", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.message).toContain("inst-abc123");
    expect(killInstance).toHaveBeenCalledWith("inst-abc123");
  });

  it("returns 404 when instance is not found", async () => {
    const { app } = setup({ killInstance: vi.fn(async () => false) });
    const res = await app.request("/control/kill/nonexistent", { method: "POST" });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("not found");
  });

  it("returns 500 when killInstance throws", async () => {
    const { app } = setup({ killInstance: vi.fn(async () => { throw new Error("kill failed"); }) });
    const res = await app.request("/control/kill/inst-err", { method: "POST" });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("kill failed");
  });
});

describe("POST /control/agents/:name/enable", () => {
  it("enables agent and returns 200 on success", async () => {
    const enableAgent = vi.fn(async () => true);
    const { app } = setup({ enableAgent });
    const res = await app.request("/control/agents/agent-a/enable", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.message).toContain("agent-a");
    expect(enableAgent).toHaveBeenCalledWith("agent-a");
  });

  it("returns 404 for unknown agent", async () => {
    const { app } = setup({ enableAgent: vi.fn(async () => false) });
    const res = await app.request("/control/agents/missing/enable", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("returns 503 when enableAgent not available", async () => {
    const { app } = setup({ enableAgent: undefined });
    const res = await app.request("/control/agents/agent-a/enable", { method: "POST" });
    expect(res.status).toBe(503);
  });

  it("returns 500 when enableAgent throws", async () => {
    const { app } = setup({ enableAgent: vi.fn(async () => { throw new Error("enable failed"); }) });
    const res = await app.request("/control/agents/agent-a/enable", { method: "POST" });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("enable failed");
  });
});

describe("POST /control/agents/:name/disable", () => {
  it("disables agent and returns 200 on success", async () => {
    const disableAgent = vi.fn(async () => true);
    const { app } = setup({ disableAgent });
    const res = await app.request("/control/agents/agent-a/disable", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.message).toContain("agent-a");
    expect(disableAgent).toHaveBeenCalledWith("agent-a");
  });

  it("returns 404 for unknown agent", async () => {
    const { app } = setup({ disableAgent: vi.fn(async () => false) });
    const res = await app.request("/control/agents/missing/disable", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("returns 503 when disableAgent not available", async () => {
    const { app } = setup({ disableAgent: undefined });
    const res = await app.request("/control/agents/agent-a/disable", { method: "POST" });
    expect(res.status).toBe(503);
  });
});

describe("POST /control/project/scale", () => {
  it("updates project scale and returns 200", async () => {
    const updateProjectScale = vi.fn(async () => true);
    const { app } = setup({ updateProjectScale });
    const res = await app.request("/control/project/scale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scale: 3 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.message).toContain("3");
    expect(updateProjectScale).toHaveBeenCalledWith(3);
  });

  it("returns 400 for invalid scale value", async () => {
    const updateProjectScale = vi.fn(async () => true);
    const { app } = setup({ updateProjectScale });
    const res = await app.request("/control/project/scale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scale: -1 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("positive integer");
  });

  it("returns 400 for scale of 0", async () => {
    const updateProjectScale = vi.fn(async () => true);
    const { app } = setup({ updateProjectScale });
    const res = await app.request("/control/project/scale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scale: 0 }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 503 when updateProjectScale not available", async () => {
    const { app } = setup({ updateProjectScale: undefined });
    const res = await app.request("/control/project/scale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scale: 2 }),
    });
    expect(res.status).toBe(503);
  });

  it("returns 500 when updateProjectScale returns false", async () => {
    const { app } = setup({ updateProjectScale: vi.fn(async () => false) });
    const res = await app.request("/control/project/scale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scale: 2 }),
    });
    expect(res.status).toBe(500);
  });
});

describe("POST /control/agents/:name/scale", () => {
  it("updates agent scale and returns 200", async () => {
    const updateAgentScale = vi.fn(async () => true);
    const { app } = setup({ updateAgentScale });
    const res = await app.request("/control/agents/agent-a/scale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scale: 2 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(updateAgentScale).toHaveBeenCalledWith("agent-a", 2);
  });

  it("returns 404 when agent not found (updateAgentScale returns false)", async () => {
    const { app } = setup({ updateAgentScale: vi.fn(async () => false) });
    const res = await app.request("/control/agents/missing/scale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scale: 2 }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid scale value", async () => {
    const { app } = setup({ updateAgentScale: vi.fn(async () => true) });
    const res = await app.request("/control/agents/agent-a/scale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scale: "bad" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 503 when updateAgentScale not available", async () => {
    const { app } = setup({ updateAgentScale: undefined });
    const res = await app.request("/control/agents/agent-a/scale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scale: 2 }),
    });
    expect(res.status).toBe(503);
  });
});

describe("GET /control/status with workQueue", () => {
  it("includes queue sizes when workQueue is provided", async () => {
    const workQueue = { size: vi.fn((agentName: string) => agentName === "agent-a" ? 3 : 0) };
    const { app } = setup({ workQueue });
    const res = await app.request("/control/status");
    const body = await res.json();
    expect(body.queueSizes).toBeDefined();
    expect(body.queueSizes["agent-a"]).toBe(3);
    expect(body.queueSizes["agent-b"]).toBe(0);
  });
});

describe("POST /control/trigger/:name error paths", () => {
  it("returns 409 when triggerAgent returns a string without 'not found'", async () => {
    const triggerAgent = vi.fn(async () => "Scheduler is paused");
    const { app } = setup({ triggerAgent });
    const res = await app.request("/control/trigger/agent-a", { method: "POST" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("paused");
  });

  it("returns 404 when triggerAgent result contains 'not found'", async () => {
    const triggerAgent = vi.fn(async () => "Agent \"missing\" not found");
    const { app } = setup({ triggerAgent });
    const res = await app.request("/control/trigger/missing", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("returns 503 when triggerAgent not available", async () => {
    const { app } = setup({ triggerAgent: undefined });
    const res = await app.request("/control/trigger/agent-a", { method: "POST" });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain("Trigger not available");
  });

  it("returns 500 when triggerAgent throws", async () => {
    const { app } = setup({ triggerAgent: vi.fn(async () => { throw new Error("trigger boom"); }) });
    const res = await app.request("/control/trigger/agent-a", { method: "POST" });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("trigger boom");
  });
});

describe("POST /control/agents/:name/kill error paths", () => {
  it("returns 500 when killAgent throws", async () => {
    const { app } = setup({ killAgent: vi.fn(async () => { throw new Error("kill error"); }) });
    const res = await app.request("/control/agents/agent-a/kill", { method: "POST" });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("kill error");
  });
});
