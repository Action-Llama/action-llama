import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { registerLogRoute } from "../../../src/gateway/routes/logs.js";
import type { ContainerRegistration } from "../../../src/gateway/types.js";

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function createTestApp(registry: Map<string, ContainerRegistration>): Hono {
  const app = new Hono();
  registerLogRoute(app, registry, logger as any);
  return app;
}

describe("POST /logs/:secret", () => {
  it("forwards log lines to onLogLine callback", async () => {
    const lines: string[] = [];
    const registry = new Map<string, ContainerRegistration>();
    registry.set("test-secret", {
      containerName: "al-dev-1234", agentName: "dev",
      onLogLine: (line) => lines.push(line),
    });

    const app = createTestApp(registry);
    const logLine1 = JSON.stringify({ _log: true, level: "info", msg: "hello", ts: 1 });
    const logLine2 = JSON.stringify({ _log: true, level: "info", msg: "world", ts: 2 });

    const res = await app.request("/logs/test-secret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: `${logLine1}\n${logLine2}`,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.forwarded).toBe(2);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(logLine1);
    expect(lines[1]).toBe(logLine2);
  });

  it("returns 403 for an invalid secret", async () => {
    const registry = new Map<string, ContainerRegistration>();
    const app = createTestApp(registry);
    const res = await app.request("/logs/bad-secret", {
      method: "POST",
      body: "test",
    });
    expect(res.status).toBe(403);
  });

  it("returns ok with forwarded=0 when no onLogLine callback", async () => {
    const registry = new Map<string, ContainerRegistration>();
    registry.set("test-secret", { containerName: "al-dev-1234" });

    const app = createTestApp(registry);
    const res = await app.request("/logs/test-secret", {
      method: "POST",
      body: "some log line",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.forwarded).toBe(0);
  });

  it("skips empty lines", async () => {
    const lines: string[] = [];
    const registry = new Map<string, ContainerRegistration>();
    registry.set("test-secret", {
      containerName: "al-dev-1234", agentName: "dev",
      onLogLine: (line) => lines.push(line),
    });

    const app = createTestApp(registry);
    const res = await app.request("/logs/test-secret", {
      method: "POST",
      body: "line1\n\n\nline2\n",
    });
    const body = await res.json();
    expect(body.forwarded).toBe(2);
    expect(lines).toEqual(["line1", "line2"]);
  });
});
