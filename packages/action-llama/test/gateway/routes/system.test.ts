import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";

vi.mock("../../../src/control/routes/control.js", () => ({
  registerControlRoutes: vi.fn(),
}));

import { registerSystemRoutes } from "../../../src/gateway/routes/system.js";
import { registerControlRoutes } from "../../../src/control/routes/control.js";

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as any;

describe("registerSystemRoutes", () => {
  it("registers health check route that returns { status: 'ok' }", async () => {
    const app = new Hono();
    registerSystemRoutes(app, {
      logger: mockLogger,
    });

    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
  });

  it("registers control routes when controlDeps is provided", async () => {
    vi.mocked(registerControlRoutes).mockReset();
    const app = new Hono();
    const controlDeps = { someControlDep: "value" } as any;

    registerSystemRoutes(app, {
      logger: mockLogger,
      controlDeps,
    });

    expect(registerControlRoutes).toHaveBeenCalledWith(app, controlDeps);
  });

  it("does not register control routes when controlDeps is not provided", async () => {
    vi.mocked(registerControlRoutes).mockReset();
    const app = new Hono();

    registerSystemRoutes(app, {
      logger: mockLogger,
    });

    expect(registerControlRoutes).not.toHaveBeenCalled();
  });
});
