import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { registerShutdownRoute } from "../../../src/gateway/routes/shutdown.js";
import type { ContainerRegistration } from "../../../src/gateway/types.js";

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function createTestApp(
  registry: Map<string, ContainerRegistration>,
  killFn: (name: string) => Promise<void>
): Hono {
  const app = new Hono();
  registerShutdownRoute(app, registry, killFn, logger as any);
  return app;
}

describe("POST /shutdown", () => {
  it("kills container and returns success for valid secret", async () => {
    const killFn = vi.fn().mockResolvedValue(undefined);
    const registry = new Map<string, ContainerRegistration>();
    registry.set("test-secret", { containerName: "al-dev-1234", agentName: "dev" });

    const app = createTestApp(registry, killFn);
    const res = await app.request("/shutdown", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: "test-secret", reason: "test" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.killed).toBe(true);
    expect(body.container).toBe("al-dev-1234");
    expect(killFn).toHaveBeenCalledWith("al-dev-1234");
    // Secret should be removed from registry
    expect(registry.has("test-secret")).toBe(false);
  });

  it("returns 403 for invalid secret", async () => {
    const killFn = vi.fn();
    const registry = new Map<string, ContainerRegistration>();

    const app = createTestApp(registry, killFn);
    const res = await app.request("/shutdown", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: "bad-secret" }),
    });
    expect(res.status).toBe(403);
    expect(killFn).not.toHaveBeenCalled();
  });

  it("returns 400 for missing secret", async () => {
    const killFn = vi.fn();
    const registry = new Map<string, ContainerRegistration>();

    const app = createTestApp(registry, killFn);
    const res = await app.request("/shutdown", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "no secret" }),
    });
    expect(res.status).toBe(400);
  });
});
