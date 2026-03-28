import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { registerSignalRoutes, type SignalContext } from "../../../src/execution/routes/signals.js";
import { ContainerRegistry } from "../../../src/execution/container-registry.js";

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function makeRegistry() {
  const registry = new ContainerRegistry();
  return registry;
}

function registerContainer(
  registry: ContainerRegistry,
  secret: string,
  agentName: string,
  instanceId = `${agentName}-1`
) {
  // Directly use the internal cache via register (sync for tests)
  registry["cache"].set(secret, {
    containerName: `al-${agentName}-abc`,
    agentName,
    instanceId,
  });
}

function makeApp(
  registry: ContainerRegistry,
  signalCtx?: SignalContext,
  statusTracker?: any,
  events?: any
) {
  const app = new Hono();
  registerSignalRoutes(app, registry, logger as any, statusTracker, signalCtx, events);
  return app;
}

async function post(app: Hono, path: string, body: Record<string, unknown>) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("registerSignalRoutes", () => {
  let registry: ContainerRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = makeRegistry();
    registerContainer(registry, "secret-a", "agent-alpha", "agent-alpha-1");
    registerContainer(registry, "secret-b", "agent-beta", "agent-beta-1");
  });

  describe("POST /signals/rerun", () => {
    it("returns 200 and calls schedulerRerun on success", async () => {
      const schedulerRerun = vi.fn();
      const ctx: SignalContext = {
        schedulerRerun,
        schedulerTrigger: vi.fn(),
      };
      const app = makeApp(registry, ctx);

      const res = await post(app, "/signals/rerun", { secret: "secret-a" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(schedulerRerun).toHaveBeenCalledWith("agent-alpha");
    });

    it("returns 400 for invalid JSON body", async () => {
      const app = makeApp(registry);
      const res = await app.request("/signals/rerun", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid JSON body");
    });

    it("returns 400 when secret is missing", async () => {
      const app = makeApp(registry);
      const res = await post(app, "/signals/rerun", {});
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("missing secret");
    });

    it("returns 403 for unrecognized secret", async () => {
      const app = makeApp(registry);
      const res = await post(app, "/signals/rerun", { secret: "unknown-secret" });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe("invalid secret");
    });

    it("emits signal event when events bus is provided", async () => {
      const events = { emit: vi.fn() };
      const app = makeApp(registry, undefined, undefined, events);
      await post(app, "/signals/rerun", { secret: "secret-a" });
      expect(events.emit).toHaveBeenCalledWith("signal", {
        agentName: "agent-alpha",
        instanceId: "agent-alpha-1",
        signal: "rerun",
      });
    });

    it("works without signalContext (does not throw)", async () => {
      const app = makeApp(registry); // no signalCtx
      const res = await post(app, "/signals/rerun", { secret: "secret-a" });
      expect(res.status).toBe(200);
    });
  });

  describe("POST /signals/status", () => {
    it("returns 200 and updates status tracker on success", async () => {
      const setAgentStatusText = vi.fn();
      const statusTracker = { setAgentStatusText };
      const app = makeApp(registry, undefined, statusTracker);

      const res = await post(app, "/signals/status", {
        secret: "secret-a",
        text: "working on PR #42",
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(setAgentStatusText).toHaveBeenCalledWith("agent-alpha", "working on PR #42");
    });

    it("returns 400 for invalid JSON body", async () => {
      const app = makeApp(registry);
      const res = await app.request("/signals/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{invalid",
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid JSON body");
    });

    it("returns 400 when secret is missing", async () => {
      const app = makeApp(registry);
      const res = await post(app, "/signals/status", { text: "hello" });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("missing secret");
    });

    it("returns 400 when text is missing", async () => {
      const app = makeApp(registry);
      const res = await post(app, "/signals/status", { secret: "secret-a" });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("missing text");
    });

    it("returns 403 for unrecognized secret", async () => {
      const app = makeApp(registry);
      const res = await post(app, "/signals/status", {
        secret: "bad-secret",
        text: "hello",
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe("invalid secret");
    });

    it("emits signal event when events bus is provided", async () => {
      const events = { emit: vi.fn() };
      const app = makeApp(registry, undefined, undefined, events);
      await post(app, "/signals/status", { secret: "secret-b", text: "running" });
      expect(events.emit).toHaveBeenCalledWith("signal", {
        agentName: "agent-beta",
        instanceId: "agent-beta-1",
        signal: "status",
      });
    });

    it("works without status tracker (does not throw)", async () => {
      const app = makeApp(registry); // no statusTracker
      const res = await post(app, "/signals/status", { secret: "secret-a", text: "idle" });
      expect(res.status).toBe(200);
    });
  });

  describe("POST /signals/trigger", () => {
    it("returns 200 and calls schedulerTrigger on success", async () => {
      const schedulerTrigger = vi.fn();
      const ctx: SignalContext = {
        schedulerRerun: vi.fn(),
        schedulerTrigger,
      };
      const app = makeApp(registry, ctx);

      const res = await post(app, "/signals/trigger", {
        secret: "secret-a",
        targetAgent: "agent-beta",
        context: "please help with task X",
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(schedulerTrigger).toHaveBeenCalledWith("agent-beta", "agent-alpha", "please help with task X");
    });

    it("returns 400 for invalid JSON body", async () => {
      const app = makeApp(registry);
      const res = await app.request("/signals/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "oops",
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid JSON body");
    });

    it("returns 400 when secret is missing", async () => {
      const app = makeApp(registry);
      const res = await post(app, "/signals/trigger", {
        targetAgent: "agent-beta",
        context: "ctx",
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("missing secret");
    });

    it("returns 400 when targetAgent is missing", async () => {
      const app = makeApp(registry);
      const res = await post(app, "/signals/trigger", {
        secret: "secret-a",
        context: "ctx",
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("missing targetAgent");
    });

    it("returns 400 when context is missing", async () => {
      const app = makeApp(registry);
      const res = await post(app, "/signals/trigger", {
        secret: "secret-a",
        targetAgent: "agent-beta",
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("missing context");
    });

    it("returns 403 for unrecognized secret", async () => {
      const app = makeApp(registry);
      const res = await post(app, "/signals/trigger", {
        secret: "bad",
        targetAgent: "agent-beta",
        context: "ctx",
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe("invalid secret");
    });

    it("emits signal event when events bus is provided", async () => {
      const events = { emit: vi.fn() };
      const app = makeApp(registry, undefined, undefined, events);
      await post(app, "/signals/trigger", {
        secret: "secret-a",
        targetAgent: "agent-beta",
        context: "trigger ctx",
      });
      expect(events.emit).toHaveBeenCalledWith("signal", {
        agentName: "agent-alpha",
        instanceId: "agent-alpha-1",
        signal: "trigger",
      });
    });

    it("works without signalContext (does not throw)", async () => {
      const app = makeApp(registry);
      const res = await post(app, "/signals/trigger", {
        secret: "secret-a",
        targetAgent: "agent-beta",
        context: "ctx",
      });
      expect(res.status).toBe(200);
    });
  });

  describe("POST /signals/return", () => {
    it("returns 200 and calls schedulerReturn on success", async () => {
      const schedulerReturn = vi.fn();
      const ctx: SignalContext = {
        schedulerRerun: vi.fn(),
        schedulerTrigger: vi.fn(),
        schedulerReturn,
      };
      const app = makeApp(registry, ctx);

      const res = await post(app, "/signals/return", {
        secret: "secret-a",
        value: "42",
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(schedulerReturn).toHaveBeenCalledWith("agent-alpha", "42");
    });

    it("returns 400 for invalid JSON body", async () => {
      const app = makeApp(registry);
      const res = await app.request("/signals/return", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{{bad",
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid JSON body");
    });

    it("returns 400 when secret is missing", async () => {
      const app = makeApp(registry);
      const res = await post(app, "/signals/return", { value: "result" });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("missing secret");
    });

    it("returns 400 when value is null", async () => {
      const app = makeApp(registry);
      const res = await post(app, "/signals/return", {
        secret: "secret-a",
        value: null,
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("missing value");
    });

    it("returns 403 for unrecognized secret", async () => {
      const app = makeApp(registry);
      const res = await post(app, "/signals/return", {
        secret: "unknown",
        value: "result",
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe("invalid secret");
    });

    it("emits signal event when events bus is provided", async () => {
      const events = { emit: vi.fn() };
      const app = makeApp(registry, undefined, undefined, events);
      await post(app, "/signals/return", { secret: "secret-b", value: "done" });
      expect(events.emit).toHaveBeenCalledWith("signal", {
        agentName: "agent-beta",
        instanceId: "agent-beta-1",
        signal: "return",
      });
    });

    it("works without schedulerReturn defined in signalContext", async () => {
      const ctx: SignalContext = {
        schedulerRerun: vi.fn(),
        schedulerTrigger: vi.fn(),
        // schedulerReturn not defined
      };
      const app = makeApp(registry, ctx);
      const res = await post(app, "/signals/return", { secret: "secret-a", value: "x" });
      expect(res.status).toBe(200);
    });

    it("converts numeric value to string when calling schedulerReturn", async () => {
      const schedulerReturn = vi.fn();
      const ctx: SignalContext = {
        schedulerRerun: vi.fn(),
        schedulerTrigger: vi.fn(),
        schedulerReturn,
      };
      const app = makeApp(registry, ctx);
      await post(app, "/signals/return", { secret: "secret-a", value: 123 });
      expect(schedulerReturn).toHaveBeenCalledWith("agent-alpha", "123");
    });
  });
});
