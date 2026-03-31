import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";

// Mock registerShutdownRoute and registerControlRoutes to avoid needing full deps
vi.mock("../../../src/execution/routes/shutdown.js", () => ({
  registerShutdownRoute: vi.fn(),
}));

vi.mock("../../../src/control/routes/control.js", () => ({
  registerControlRoutes: vi.fn(),
}));

import { registerSystemRoutes } from "../../../src/gateway/routes/system.js";
import { registerShutdownRoute } from "../../../src/execution/routes/shutdown.js";
import { registerControlRoutes } from "../../../src/control/routes/control.js";

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as any;

const mockContainerRegistry = {} as any;

describe("registerSystemRoutes", () => {
  it("registers health check route that returns { status: 'ok' }", async () => {
    const app = new Hono();
    registerSystemRoutes(app, {
      containerRegistry: mockContainerRegistry,
      logger: mockLogger,
    });

    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
  });

  it("uses provided killContainer function", async () => {
    const killFn = vi.fn().mockResolvedValue(undefined);
    const app = new Hono();

    registerSystemRoutes(app, {
      containerRegistry: mockContainerRegistry,
      killContainer: killFn,
      logger: mockLogger,
    });

    // registerShutdownRoute should have been called with the provided killFn
    expect(registerShutdownRoute).toHaveBeenCalledWith(
      app,
      mockContainerRegistry,
      killFn,
      mockLogger,
    );
  });

  it("uses no-op killContainer when not provided (fallback async () => {})", async () => {
    vi.mocked(registerShutdownRoute).mockReset();
    const app = new Hono();

    registerSystemRoutes(app, {
      containerRegistry: mockContainerRegistry,
      // killContainer not provided — should use fallback
      logger: mockLogger,
    });

    // registerShutdownRoute should have been called with the no-op fallback
    expect(registerShutdownRoute).toHaveBeenCalledWith(
      app,
      mockContainerRegistry,
      expect.any(Function),
      mockLogger,
    );

    // Verify the fallback is a no-op (doesn't throw)
    const fallbackFn = vi.mocked(registerShutdownRoute).mock.calls.at(-1)![2];
    await expect(fallbackFn("any-container")).resolves.toBeUndefined();
  });

  it("registers control routes when controlDeps is provided", async () => {
    vi.mocked(registerControlRoutes).mockReset();
    const app = new Hono();
    const controlDeps = { someControlDep: "value" } as any;

    registerSystemRoutes(app, {
      containerRegistry: mockContainerRegistry,
      logger: mockLogger,
      controlDeps,
    });

    expect(registerControlRoutes).toHaveBeenCalledWith(app, controlDeps);
  });

  it("does not register control routes when controlDeps is not provided", async () => {
    vi.mocked(registerControlRoutes).mockReset();
    const app = new Hono();

    registerSystemRoutes(app, {
      containerRegistry: mockContainerRegistry,
      logger: mockLogger,
      // No controlDeps
    });

    expect(registerControlRoutes).not.toHaveBeenCalled();
  });
});
